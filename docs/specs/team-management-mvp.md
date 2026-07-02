# チームメンバーシップ管理 MVP — 仕様書

**Status:** Draft / 2026-06-23
**前提:** L2 テナント分離（本番稼働中）の上に乗る。`docs` 配下の他資料と独立。
**関連メモリ:** team-management-mvp / l2-tenant-isolation / team-quota-design

---

## 1. Problem Statement

L2 でワークフロー可視性 `team` と署名のチーム境界制限を実装したが、**チームにメンバーを追加する手段が無い**。全ユーザーが「個人1人チーム」のままなので `team` 共有が実質機能しない。複数支店・各支店数名で使う見込みの toB 顧客がいる今、**「招待して同じチームで共有・利用する」ループが成立しないことが導入のブロッカー**。

## 2. Goals

1. owner が他ユーザーをチームに参加させられる（招待リンク経由）＝ Team 共有が実際に機能
2. 支店単位でワークスペース・クォータが分離（**team=支店**、既存 L2 を再利用）
3. 消費量と作成者がメンバー別に見える
4. 将来「個人別キャップ」へ安価に拡張できる土台（データを user_id 単位で取る）
5. ピロット顧客が 2人以上で同一チームを使える状態で評価開始できる

## 3. Non-Goals（契約確定まで／別イニシアチブ）

- 個人別クォータ上限の判定・設定UI（支店別キャップで足りる可能性大・データだけ先に取る）
- 全社（支店横断）ロールアップ／HQ管理画面
- メール招待（magic link）・SSO・監査ログ等の高度なセキュリティ
- 支店間アセット共有（cross-team visibility）
- 3段以上のロール／細粒度権限

## 4. 確定した設計判断（ブレスト 2026-06-23）

| # | 判断 |
|---|---|
| 1 | **1ユーザー = 1チーム固定**（複数所属なし）。組織メンバーは組織メールで新規アカウント＝移行問題なし |
| 2 | **team = 支店**（≠企業）。企業概念はシステムに無い。支店は独立（cross-branch 共有なし・将来再検討） |
| 3 | **招待 = 共有リンク方式（opt-in）**。owner 発行→クリックで参加。メール基盤不要 |
| 4 | **ロール owner / member の2段。owner 複数可**。owner だけが招待/削除。最後の owner ガード必須 |
| 5 | **退会/削除 = 新規個人チームへ戻す**。資産は user 所有なので失われない |
| 6 | **クォータ = 支店別キャップ**（既存チーム別クォータ再利用）。`usage_counters` は **当初設計から user_id 粒度**＝個人別可視化/将来の個人別キャップのデータは既にある（DB変更不要） |
| 7 | **作成者追跡** = `generations.user_id` で作成者バッジ＋フィルタ |

---

## 5. データモデル変更（migration 0010・非破壊先行）

### 5.1 `team_members`（変更なし＝既存利用）
- `role`(owner/admin/member) は **0001 で既存**。0002 で個人チーム本人は `role='owner'` 済み（現データ4人全員 owner）→ **追加・backfill 不要**。
- PK は (team_id,user_id) で複数所属可だが、本機能は1チーム固定 → **0010 で `unique(user_id)` を追加して enforce**。
- 参加＝この唯一行の `team_id` を張り替える（update）。

### 5.2 `team_invites`（新規）
```sql
create table team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),  -- 48hex=192bit・URL安全
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz
);
create index on team_invites(token);
-- 1チーム1アクティブリンク（再発行＝旧 revoke→新 insert）
create unique index team_invites_one_active on team_invites(team_id) where revoked_at is null;
```
- 有効条件：`revoked_at is null AND expires_at > now()`。再利用可・opt-in。

### 5.3 `usage_counters`（変更なし＝既に user_id 粒度）
- **0001 で PK `(team_id,user_id,period,kind)`＝既に user_id 粒度**。`increment_usage_counter`(0003) も user_id 単位。当初設計者が将来の個人上限の保険として作っていた。
- **支店キャップ判定**：`sum(count) where team_id and kind and period`（既存どおり team 合算）。
- **個人別可視化**：`group by user_id`（データは既にある＝P1 のビューを足すだけ）。
- 将来の**個人別キャップ**：`team_members` に上限列＋判定を足すだけ。**データ層は不要**。

### 5.4 `teams`
- 表示用 `name`（無ければ追加）。支店名を入れる。

---

## 6. 招待＆メンバーシップ フロー詳細設計（実装直前レベル）

### 6.1 中核オペレーション：「ユーザーがチーム T に参加」
1ユーザー1チーム固定なので、参加＝**`team_members` の唯一行の `team_id` を T に張り替える**（role=member）。これが全ての心臓。

### 6.2 エンドポイント（すべて Edge / service role・`withSentry`・dev middleware ミラー）

| エンドポイント | 権限 | 動作 |
|---|---|---|
| `POST /api/team/invite` | owner | 旧リンク revoke → 新 `team_invites` 発行。`{ url, token, expiresAt }` を返す |
| `POST /api/team/join` | 認証済み（誰でも・token が鍵） | token 検証→呼出者を T へ張替。下記6.3 |
| `POST /api/team/leave` | 本人 | 本人を新個人チームへ戻す（6.4） |
| `POST /api/team/remove` | owner | `{ userId }` を新個人チームへ戻す。owner/最後のownerガード |
| `POST /api/team/role` | owner | `{ userId, role }` 昇格/降格。最後のownerガード |

**なぜ RLS でなくエンドポイントか**：参加は「他チームからの移動＋token 検証」で RLS では安全に表現できない。member 行の書込（移動/削除/role）は cross-user で service role が安全。

### 6.3 `POST /api/team/join` ロジック
```
input: { token }
1. JWT 検証 → userId
2. service role で invite を token 引き（team_id, expires_at, revoked_at）
3. 検証: 存在 && revoked_at is null && expires_at > now()  → 不可なら 410 {reason}
4. 既に T のメンバー → 冪等 200（teamName 返す）
5. ガード: 呼出者が「他メンバーのいるチームの最後の owner」なら 409
          （= 自分が抜けるとそのチームが owner 不在になる。個人1人チームなら無関係＝素通り）
6. 移動: update team_members set team_id=T, role='member' where user_id=userId
7. 掃除: 旧チームが空なら delete（個人チームのみ・任意）
8. 200 { teamId, teamName }
```
- 旧チームに残した自分のワークフロー（team_id=旧）は **本人所有なのでアクセス維持**。ただし「参加前WFを T に team 共有」は team_id がズレる → Open Q（MVPは割り切り）。

### 6.4 退会/削除の「新個人チーム生成」
```
create team (name='My Workspace', 既定クォータ)
update team_members set team_id=新team, role='owner' where user_id=target
```
- サインアップ時の個人チーム自動作成ロジックを再利用。

### 6.5 RLS

| 対象 | SELECT | 書込 |
|---|---|---|
| `team_invites` | **owner のみ**（`team_id in (select team_id from team_members where user_id=auth.uid() and role='owner')`） | owner のみ（or エンドポイント） |
| `team_members` | 同チーム（`is_team_member(team_id)`）＝一覧 | **クライアント書込なし**。移動/削除/role は全てエンドポイント（service role） |
| `usage_counters` | 同チーム（`is_team_member(team_id)`） | service role 加算のみ |

- **token での invite 直 SELECT はクライアントに開けない**（owner だけが SELECT 可）。join は service role が読む → token からチーム列挙する攻撃を防止。

### 6.6 セキュリティ考慮
- token は 192bit・推測不能。総当り非現実的。
- 誰でもリンクで参加可 → **期限(7日)＋失効/再発行**で緩和。owner 承認は P2。
- 参加でクォータプールが変わる＝本人がクリックで同意。
- join に軽いレート制限（任意・token 強度で実害小）。

---

## 7. 主要画面

1. **チーム設定**（`/team/settings`）：支店名・自分のロール・招待リンク（コピー/再発行）・メンバー一覧
2. **メンバー一覧**：名前/メール・role バッジ・各自の今月消費・owner のみ「削除」「owner 昇格/降格」
3. **参加ページ**（`/join/:token`）：「{支店名} に参加しますか？」→参加/キャンセル（未ログインはログイン→復帰）
4. **使用状況**（設定内 or `/team/usage`）：チーム今月消費 vs 上限＋メンバー別内訳（P1）
5. **作成者表示**：History/Community/Team WF に「作成者: {member}」バッジ＋フィルタ（P1）

---

## 8. P0 実装計画（着手順・依存）

```
0010 migration ──┬─→ ② counter user_id 化（server）
（非破壊・両DB）  └─→ ③ membership エンドポイント群（server）
                          │
                          ├─→ ④ チーム設定＋メンバー一覧UI
                          ├─→ ⑤ 参加ページ /join/:token
                          └─→ ⑥ 招待リンク発行/コピーUI
                                      │
                                      └─→ ⑦ 2アカウント結合テスト
```

1. **migration 0010**（非破壊・`migrations/0010_team_membership.sql`）：**team_invites＋RLS(owner SELECT)** ＋ **team_members に `unique(user_id)`**（1チーム固定 enforce）。※role・usage_counters の user_id・teams.name・既存 SELECT RLS は当初設計で既にあり追加不要。staging＋本番 両DB先行適用。
2. ~~counter user_id 化~~ **不要**（0001/0003 で既に user_id 粒度・cap は team SUM）。生成時の増分が正しい team_id/user_id を渡しているかの**確認のみ**。← 1
3. **membership エンドポイント**（server）：invite/join/leave/remove/role（Edge＋dev middleware＋withSentry＋最後の owner ガード＋新個人チーム helper）。← 1
4. **チーム設定＋メンバー一覧UI**（client）：← 3
5. **参加ページ** `/join/:token`（client・未認証誘導）：← 3
6. **招待リンク UI**（client・発行/コピー/再発行）：← 3
7. **2アカウント結合テスト**：owner 招待→member 参加→team WF 閲覧→消費が team プール計上→owner 削除→member は個人チーム復帰＋自分の資産は維持。← 4,5,6

ロールアウトは L2 同型（スキーマ非破壊先行→コードデプロイ→検証）。

## 9. 受け入れ条件（抜粋）

- Given owner 発行リンク, When 別ユーザーが「参加」, Then 所属が T になり team 共有 WF が開ける
- Given 失効/期限切れリンク, When 開く, Then 「無効な招待」表示で参加しない
- Given member を owner が削除, Then 新個人チームへ移り、**自作の画像/WF は閲覧維持**・team WF は不可
- Given owner が1人, When 離脱/降格, Then ブロック＋理由表示
- Given メンバー3人が生成, When owner が使用状況閲覧, Then team 合算＋メンバー別内訳（P1）
- Given 支店キャップ到達, When 生成, Then 既存どおりサーバー拒否（合算判定）

## 10. P1 / P2

- **P1**：使用状況ビュー（メンバー別内訳）/ 作成者バッジ＋フィルタ / role 昇格降格UI / 招待リンク有効期限UI
- **P2**：個人別キャップ（土台はP0で確保）/ 全社ロールアップ / メール招待・SSO / 支店間アセット共有

## 11. Open Questions

- **(eng)** 参加時、対象ユーザーの**既存WFの team_id** はどうする（本人所有でアクセスは保たれるが参加前WFの team 共有先がズレる）→ MVP は「参加前WFは個人のまま、共有したければ作り直し」で割り切り？
- **(stakeholder)** 支店チームの**クォータ上限値**は誰がどう設定（当面手動 `teams.quota_*`）。シート連動/課金は別
- **(eng)** 空の個人チームは削除 or 放置（孤児クリーンアップ）
- **(product)** 招待リンク 1チーム1本（再利用）で良いか、使い切りか
- **(product)** 参加に owner 承認を挟むか（MVP は即参加）

## 12. リスク

- **チーム移動の意味論**：参加＝旧チーム離脱。1人チーム前提なら影響小。組織メール新規前提で実害小と判断。
- **招待リンク漏洩**：誰でも参加可 → 期限＋失効/再発行（P1）、必要なら owner 承認（P2）。
- **共有プール負荷**：人が増えると上限到達 → 支店チームの上限を運用で適切設定（Open Q）。
- **counter 主キー変更**：既存 user_id=null との整合 → 合算は null 含めて SUM、新規のみ user_id 付与で吸収。
