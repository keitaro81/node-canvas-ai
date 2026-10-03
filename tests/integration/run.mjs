#!/usr/bin/env node
// 統合テスト（再実行可能）。本番/ステージングの実 DB・実 Edge に対して、
// L2 テナント分離（クロステナント署名の遮断）とチーム管理エンドポイントの認可を検証する。
//
// ⚠️ 実行すると対象 DB に一時ユーザー/チーム/WF を作成し、最後に必ず削除する（finally で cleanup）。
// 対象は VITE_SUPABASE_URL が指す環境（.env.local = 本番）。APP_URL で Edge のベースを上書き可能。
//
// 使い方: npm run test:integration
// 必要 env（.env.local から自動読込）: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// 生成 API は叩かない（コストなし）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── .env.local を読む（既に process.env にあればそちら優先）──
function loadEnv() {
  try {
    const txt = readFileSync(resolve(__dirname, '../../.env.local'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* .env.local 無しでも process.env にあれば動く */ }
}
loadEnv()

const URL_BASE = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL = process.env.APP_URL || 'https://node-canvas-ai.vercel.app'

if (!URL_BASE || !ANON || !SRK) {
  console.error('❌ 必要な env が不足（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY）')
  process.exit(2)
}

// ── HTTP ヘルパー ──
const adminHeaders = { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json' }
const rest = (path, init = {}) => fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...adminHeaders, ...(init.headers || {}) } })
const auth = (path, init = {}) => fetch(`${URL_BASE}/auth/v1/${path}`, { ...init, headers: { ...adminHeaders, ...(init.headers || {}) } })

async function createUser(email, password) {
  const r = await auth('admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) })
  const j = await r.json()
  if (!j.id) throw new Error(`createUser failed: ${JSON.stringify(j)}`)
  return j.id
}
async function jwtFor(email, password) {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`token failed: ${JSON.stringify(j)}`)
  return j.access_token
}
async function createTeam(name) {
  const r = await rest('teams', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name }) })
  return (await r.json())[0].id
}
async function addMember(teamId, userId, role) {
  await rest('team_members', { method: 'POST', body: JSON.stringify({ team_id: teamId, user_id: userId, role }) })
}

// ── アサート ──
let pass = 0, fail = 0
function check(desc, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${desc}`) }
  else { fail++; console.log(`  ❌ ${desc}${detail ? `  — ${detail}` : ''}`) }
}

const TAG = `itest-${Math.random().toString(36).slice(2, 8)}`
const created = { users: [], teams: [], projects: [], workflows: [], batchJobs: [], batchObjects: [] }

async function main() {
  console.log(`\n統合テスト対象: ${URL_BASE}  (Edge: ${APP_URL})`)
  console.log(`⚠️ 一時データ(${TAG}-*)を作成→最後に削除します\n`)

  const pw = `It-${Math.random().toString(36).slice(2)}-9A`
  const emA = `${TAG}-a@example.com`, emB = `${TAG}-b@example.com`
  const aId = await createUser(emA, pw); created.users.push(aId)
  const bId = await createUser(emB, pw); created.users.push(bId)
  const teamA = await createTeam(`${TAG} A`); created.teams.push(teamA)
  const teamB = await createTeam(`${TAG} B`); created.teams.push(teamB)
  await addMember(teamA, aId, 'owner')
  await addMember(teamB, bId, 'owner')
  const jwtB = await jwtFor(emB, pw)

  // ───────────────────────────────────────────────
  // Group A: L2 ストレージ RLS カットオーバー（テナント外は他人の私有オブジェクトを署名できない）
  // ───────────────────────────────────────────────
  console.log('Group A: L2 ストレージ RLS（クロステナント直署名の遮断）')
  const gen = await (await rest(`generations?select=output_url&output_url=ilike.*generated-images*&limit=1`)).json()
  if (!gen.length) {
    console.log('  ⚠️ SKIP: generated-images の既存オブジェクトが無い（対象環境にデータなし）')
  } else {
    const outUrl = gen[0].output_url
    const marker = ['/object/public/', '/object/sign/'].map((m) => outUrl.indexOf(m)).find((i) => i !== -1)
    const rel = outUrl.slice(marker + '/object/public/'.length).split('?')[0]
    const bucket = rel.slice(0, rel.indexOf('/'))
    const objPath = rel.slice(rel.indexOf('/') + 1)
    // 攻撃: テナント外 B が直接署名 → RLS で行が見えず 400/404（署名させない）
    const atkRes = await fetch(`${URL_BASE}/storage/v1/object/sign/${bucket}/${objPath}`, {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwtB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 }),
    })
    check('テナント外ユーザーは他人の私有オブジェクトを署名できない（非200）', atkRes.status !== 200, `status=${atkRes.status}`)
    // 対照: service role なら署名できる（パスが有効＝上の拒否が本物である証明）
    const ctlRes = await fetch(`${URL_BASE}/storage/v1/object/sign/${bucket}/${objPath}`, {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ expiresIn: 60 }),
    })
    check('対照: service role は同じパスを署名できる（拒否が RLS 由来である裏付け）', ctlRes.status === 200, `status=${ctlRes.status}`)
  }

  // ───────────────────────────────────────────────
  // Group B: team/manage エンドポイントの認可
  // ───────────────────────────────────────────────
  console.log('Group B: team/manage 認可')
  const manage = (body, token) => fetch(`${APP_URL}/api/team/manage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  // 招待を発行（preview 用）
  const inv = await (await rest('team_invites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ team_id: teamB, created_by: bId }) })).json()
  const token = inv[0].token
  check('preview(未認証) は 200 でチーム名を返す', (await (await manage({ action: 'preview', token })).json()).teamName?.includes(TAG), '')
  check('list は未認証だと 403', (await manage({ action: 'list' })).status === 403)
  check('無効トークンの preview は 410', (await manage({ action: 'preview', token: 'deadbeef'.repeat(6) })).status === 410)
  const suRes = await manage({ action: 'signup', token, email: 'not-an-email', password: 'short' })
  check('signup はメール形式不正を 400 で弾く', suRes.status === 400, `status=${suRes.status}`)

  // ───────────────────────────────────────────────
  // Group C: sign-media エンドポイントのクロステナント認可（Mode 1）
  // ───────────────────────────────────────────────
  console.log('Group C: sign-media クロステナント認可（Mode 1 workflowId）')
  const proj = await (await rest('projects', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ user_id: aId, name: `${TAG} pj` }) })).json()
  created.projects.push(proj[0].id)
  const wf = await (await rest('workflows', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ project_id: proj[0].id, name: `${TAG} wf`, canvas_data: { nodes: [], edges: [] }, team_id: teamA, visibility: 'private', is_public: false }) })).json()
  created.workflows.push(wf[0].id)
  const signMedia = (body, token) => fetch(`${APP_URL}/api/storage/sign-media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  })
  const jwtA = await jwtFor(emA, pw)
  check('テナント外 B は A の private WF を sign-media できない（403）', (await signMedia({ workflowId: wf[0].id }, jwtB)).status === 403)
  check('所有者 A は自分の WF に 200（map を返す）', (await signMedia({ workflowId: wf[0].id }, jwtA)).status === 200)
  check('sign-media は未認証だと 403', (await signMedia({ workflowId: wf[0].id }, '')).status === 403)

  // ───────────────────────────────────────────────
  // Group D: 削除/離脱でのクリーンな共有解除（案A）
  //   member M の team 共有 WF は、owner が M を削除すると private に戻る（旧チームから不可視化）。
  // ───────────────────────────────────────────────
  console.log('Group D: 削除時に本人の team 共有 WF が private に戻る（案A）')
  const emM = `${TAG}-m@example.com`
  const mId = await createUser(emM, pw); created.users.push(mId)
  await addMember(teamA, mId, 'member')
  const mProj = await (await rest('projects', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ user_id: mId, name: `${TAG} m-pj` }) })).json()
  created.projects.push(mProj[0].id)
  const mWf = await (await rest('workflows', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ project_id: mProj[0].id, name: `${TAG} m-wf`, canvas_data: { nodes: [], edges: [] }, team_id: teamA, visibility: 'team', is_public: false }) })).json()
  created.workflows.push(mWf[0].id)
  const before = await (await rest(`workflows?select=visibility,team_id&id=eq.${mWf[0].id}`)).json()
  check('前提: M の WF は team 共有', before[0]?.visibility === 'team', JSON.stringify(before[0]))
  const rmRes = await manage({ action: 'remove', userId: mId }, jwtA)
  check('remove は 200', rmRes.status === 200, `status=${rmRes.status}`)
  const after = await (await rest(`workflows?select=visibility,team_id&id=eq.${mWf[0].id}`)).json()
  check('削除後: M の WF は private に戻る（旧チームから不可視）', after[0]?.visibility === 'private', JSON.stringify(after[0]))
  check('削除後: M の WF の team_id が旧チームでない（新個人チームへ追従）', after[0]?.team_id && after[0].team_id !== teamA, JSON.stringify(after[0]))
  const mMem = await (await rest(`team_members?select=team_id&user_id=eq.${mId}`)).json()
  check('削除後: M は元チームのメンバーではない', mMem[0]?.team_id && mMem[0].team_id !== teamA, JSON.stringify(mMem[0]))

  // ───────────────────────────────────────────────
  // Group E: 運営コンソールの認可（非運営は admin エンドポイントを叩けない）
  //   ※ 肯定系（provision 成功）は本番 ADMIN_USER_IDS にテストユーザーを載せられないため対象外。
  //   非運営が 403 で弾かれること＝スーパーユーザー面のゲートを固定する。
  // ───────────────────────────────────────────────
  console.log('Group E: 運営コンソール認可（非運営は 403）')
  const adminApi = (body, token) => fetch(`${APP_URL}/api/admin/manage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  check('非運営(A) の admin list は 403', (await adminApi({ action: 'list' }, jwtA)).status === 403)
  check('非運営(A) の admin provision は 403（アカウント作成させない）',
    (await adminApi({ action: 'provision', teamName: `${TAG} 不正`, ownerEmail: `${TAG}-evil@example.com` }, jwtA)).status === 403)
  check('admin エンドポイントは未認証だと 403', (await adminApi({ action: 'list' }, '')).status === 403)

  // ───────────────────────────────────────────────
  // Group F: 撮影後工程 基盤（migration 0011）
  //   batch_* の RLS（非所属は不可視）／batch バケットの RLS（他チームのフォルダはアップロード・署名不可）／
  //   apply_batch_task_result の冪等（同内容2回で件数は1回分）／review_batch_item の所属チェック。
  //   0011 未適用なら SKIP（ハーネスを緑に保つ）。
  // ───────────────────────────────────────────────
  console.log('Group F: バッチ基盤（RLS・batch バケット・集約RPCの冪等）')
  const probe = await rest('batch_jobs?select=id&limit=1')
  if (probe.status >= 400) {
    console.log('  ⚠️ SKIP: migration 0011 未適用（batch_jobs が無い）')
  } else {
    const userRest = (path, jwt, init = {}) => fetch(`${URL_BASE}/rest/v1/${path}`, {
      ...init, headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    // setup: teamA にジョブ / アイテム / 投入済みタスク（service role）
    const job = await (await rest('batch_jobs', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ team_id: teamA, created_by: aId, name: `${TAG} job`, workflow_snapshot: {}, status: 'submitted', item_count: 1, task_count: 1 }) })).json()
    const jobId = job[0].id; created.batchJobs.push(jobId)
    const item = await (await rest('batch_items', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ job_id: jobId, team_id: teamA, sort_order: 0, original_filename: 'a.jpg', sku: `${TAG}-SKU`, status: 'processing' }) })).json()
    const itemId = item[0].id
    const task = await (await rest('batch_tasks', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ job_id: jobId, item_id: itemId, team_id: teamA, node_id: 'rb1', endpoint: 'fal-ai/bria/background/remove', status: 'submitted', fal_request_id: `${TAG}-req-1`, submitted_at: new Date().toISOString() }) })).json()
    const taskId = task[0].id

    // RLS: 非所属 B には見えない／所属 A には見える
    const bRows = await (await userRest(`batch_jobs?select=id&id=eq.${jobId}`, jwtB)).json()
    check('非所属ユーザーは他チームの batch_jobs を読めない（RLS）', Array.isArray(bRows) && bRows.length === 0, JSON.stringify(bRows).slice(0, 80))
    const aRows = await (await userRest(`batch_jobs?select=id&id=eq.${jobId}`, jwtA)).json()
    check('所属ユーザーは自チームの batch_jobs を読める', Array.isArray(aRows) && aRows.length === 1)

    // batch バケット RLS: A はアップロード/署名可、B は不可
    const objPath = `${teamA}/${jobId}/${itemId}/original.txt`
    const put = (jwt) => fetch(`${URL_BASE}/storage/v1/object/batch/${objPath}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'text/plain' }, body: 'x' })
    const sign = (jwt) => fetch(`${URL_BASE}/storage/v1/object/sign/batch/${objPath}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) })
    const upB = await put(jwtB)
    check('非所属ユーザーは他チームのフォルダへアップロードできない', upB.status !== 200, `status=${upB.status}`)
    const upA = await put(jwtA)
    check('所属ユーザーは自チームのフォルダへアップロードできる', upA.status === 200, `status=${upA.status}`)
    if (upA.status === 200) created.batchObjects.push(objPath)
    check('非所属ユーザーは他チームの batch オブジェクトを署名できない', (await sign(jwtB)).status !== 200)
    check('所属ユーザーは自チームの batch オブジェクトを署名できる', (await sign(jwtA)).status === 200)

    // 集約RPC: 1回目 true・2回目 false・件数は1回分・アイテム ready・ジョブ completed
    const rpc = (body) => rest('rpc/apply_batch_task_result', { method: 'POST', body: JSON.stringify(body) })
    const r1 = await (await rpc({ p_task_id: taskId, p_outcome: 'completed', p_result_path: objPath, p_cost_usd: 0.018 })).json()
    check('apply_batch_task_result 1回目は true（状態が変わった）', r1 === true, JSON.stringify(r1))
    const r2 = await (await rpc({ p_task_id: taskId, p_outcome: 'completed', p_result_path: objPath, p_cost_usd: 0.018 })).json()
    check('同内容で2回目は false（何もしない＝冪等）', r2 === false, JSON.stringify(r2))
    const j = await (await rest(`batch_jobs?select=completed_tasks,failed_tasks,status,actual_cost_usd&id=eq.${jobId}`)).json()
    check('完了タスク数は1回分だけ増える', j[0]?.completed_tasks === 1, JSON.stringify(j[0]))
    check('全タスク終了でジョブが completed', j[0]?.status === 'completed', JSON.stringify(j[0]))
    const it = await (await rest(`batch_items?select=status&id=eq.${itemId}`)).json()
    check('アイテムが ready になる', it[0]?.status === 'ready', JSON.stringify(it[0]))

    // クライアント書込 RPC の所属チェック
    const revB = await userRest('rpc/review_batch_item', jwtB, { method: 'POST', body: JSON.stringify({ p_item_id: itemId, p_review: 'ok' }) })
    check('非所属ユーザーは review_batch_item できない', revB.status >= 400, `status=${revB.status}`)
    const revA = await userRest('rpc/review_batch_item', jwtA, { method: 'POST', body: JSON.stringify({ p_item_id: itemId, p_review: 'ok' }) })
    check('所属ユーザーは review_batch_item できる', revA.status < 300, `status=${revA.status}`)
    const rv = await (await rest(`batch_items?select=review,reviewed_by&id=eq.${itemId}`)).json()
    check('review=ok・reviewed_by=本人 が記録される', rv[0]?.review === 'ok' && rv[0]?.reviewed_by === aId, JSON.stringify(rv[0]))
  }

  // ───────────────────────────────────────────────
  // Group G: フェーズ B — 「チームの編集を許可」と編集ロック（0017）
  // ───────────────────────────────────────────────
  console.log('Group G: チーム編集と編集ロック（0017）')
  const probeG = await rest('workflow_edit_locks?select=workflow_id&limit=1')
  if (probeG.status >= 400) {
    console.log('  ⚠️ SKIP: migration 0017 未適用（workflow_edit_locks が無い）')
  } else {
    const emM = `${TAG}-g@example.com`   // Group F が -m を使うので別名
    const mId = await createUser(emM, pw); created.users.push(mId)
    await addMember(teamA, mId, 'member')                 // A と同じチームのメンバー。B は別チーム
    const jwtM = await jwtFor(emM, pw)
    const jwtOwner = await jwtFor(emA, pw)
    const uRest = (path, jwt, init = {}) => fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } })
    const rpcU = async (name, jwt, body) => { const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json().catch(() => null) }
    const rowsOf = async (r) => { if (!r.ok) return null; try { const j = await r.json(); return Array.isArray(j) ? j : [] } catch { return [] } }
    const patch = (jwt, body, extra = '') => uRest(`workflows?id=eq.${wfG}${extra}`, jwt, { method: 'PATCH', body: JSON.stringify(body) })
    const canvasG = (n) => ({ nodes: [{ id: 'n1', data: { type: 'text', params: { text: `v${n}` } } }], edges: [] })
    const projG = await (await rest('projects', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: `${TAG} G project`, user_id: aId }) })).json()
    created.projects.push(projG[0].id)
    const wfRow = await (await rest('workflows', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ project_id: projG[0].id, name: `${TAG} G wf`, canvas_data: canvasG(0), visibility: 'team', team_id: teamA }) })).json()
    const wfG = wfRow[0].id; created.workflows.push(wfG)

    // 許可 OFF（既定）: メンバーは保存も許可の変更もできない（RLS で 0 行）
    const g1 = await rowsOf(await patch(jwtM, { canvas_data: canvasG(1) }))
    const g2 = await rowsOf(await patch(jwtM, { team_edit: true }))
    const ce0 = await rpcU('can_edit_workflow', jwtM, { p_workflow_id: wfG })
    check(`許可 OFF: メンバーは保存も許可の変更もできない（更新 ${g1?.length} / ${g2?.length} 行・can_edit=${ce0}）`, g1?.length === 0 && g2?.length === 0 && ce0 === false)
    // 所有者が ON → 同じチームは編集可、別チームは不可
    const g3 = await rowsOf(await patch(jwtOwner, { team_edit: true }))
    const ce1 = await rpcU('can_edit_workflow', jwtM, { p_workflow_id: wfG })
    const ceB = await rpcU('can_edit_workflow', jwtB, { p_workflow_id: wfG })
    check(`所有者は ON にできる（team_edit=${g3?.[0]?.team_edit}）。同じチームのメンバーは編集可・別チームは不可（${ce1} / ${ceB}）`, g3?.[0]?.team_edit === true && ce1 === true && ceB === false)
    // ロック無しの保存は拒否（メンバーも所有者も）
    const g4 = await patch(jwtM, { canvas_data: canvasG(2) }); const g4t = await g4.text()
    const g5 = await patch(jwtOwner, { canvas_data: canvasG(2) }); const g5t = await g5.text()
    check(`ロック無しでは保存できない（メンバー ${g4.status}・所有者 ${g5.status}・workflow_edit_lock_required）`, g4.status >= 400 && g4t.includes('workflow_edit_lock_required') && g5.status >= 400 && g5t.includes('workflow_edit_lock_required'))
    // メンバーがロックを取って保存 → 版が進む
    const l1 = await rpcU('acquire_workflow_edit_lock', jwtM, { p_workflow_id: wfG, p_session_id: 'm1' })
    const g6 = await rowsOf(await patch(jwtM, { canvas_data: canvasG(3) }))
    check(`メンバーはロックを取れ（ok=${l1?.ok}）、持っている間は保存できる（canvas_version=${g6?.[0]?.canvas_version}）`, l1?.ok === true && g6?.[0]?.canvas_version === 1)
    // 設定・名前は変えられない（トリガ）
    const g7 = await patch(jwtM, { name: 'renamed by member' }); const g7t = await g7.text()
    const g8 = await patch(jwtM, { team_edit: false }); const g8t = await g8.text()
    check(`メンバーは名前・共有設定を変えられない（${g7.status} / ${g8.status}・shared_edit_settings_forbidden）`, g7.status >= 400 && g7t.includes('shared_edit_settings_forbidden') && g8.status >= 400 && g8t.includes('shared_edit_settings_forbidden'))
    // 所有者でも、メンバーが持っている間は取れない・保存できない。heartbeat は奪わない。別チームは forbidden
    const l2 = await rpcU('acquire_workflow_edit_lock', jwtOwner, { p_workflow_id: wfG, p_session_id: 'a1' })
    const l2h = await rpcU('acquire_workflow_edit_lock', jwtOwner, { p_workflow_id: wfG, p_session_id: 'a1', p_heartbeat: true })
    const g9 = await patch(jwtOwner, { canvas_data: canvasG(4) })
    const lB = await rpcU('acquire_workflow_edit_lock', jwtB, { p_workflow_id: wfG, p_session_id: 'b1' })
    check(`メンバーが編集中は所有者も取れない・保存できない（${l2?.reason} / ${l2h?.reason} / 保存 ${g9.status}・holder=${l2?.holder_email}）。別チームは ${lB?.reason}`,
      l2?.ok === false && l2?.reason === 'held' && l2?.holder_email === emM && l2h?.ok === false && g9.status >= 400 && lB?.reason === 'forbidden')
    // ロック行は同じチームに見え、別チームには見えない
    const lmRows = await rowsOf(await uRest(`workflow_edit_locks?select=user_email&workflow_id=eq.${wfG}`, jwtOwner))
    const lbRows = await rowsOf(await uRest(`workflow_edit_locks?select=user_email&workflow_id=eq.${wfG}`, jwtB))
    check(`ロック行は同じチームに見え（${lmRows?.[0]?.user_email}）、別チームには見えない（${lbRows?.length} 行）`, lmRows?.[0]?.user_email === emM && lbRows?.length === 0)
    // 同じ人の別タブは引き継ぐ。古いタブの heartbeat は held / same_user
    const l3 = await rpcU('acquire_workflow_edit_lock', jwtM, { p_workflow_id: wfG, p_session_id: 'm2' })
    const l3h = await rpcU('acquire_workflow_edit_lock', jwtM, { p_workflow_id: wfG, p_session_id: 'm1', p_heartbeat: true })
    check(`同じ人の別タブは引き継ぐ（took_over=${l3?.took_over}）。古いタブの heartbeat は ${l3h?.reason}/same_user=${l3h?.same_user}`, l3?.ok === true && l3?.took_over === true && l3h?.ok === false && l3h?.reason === 'held' && l3h?.same_user === true)
    // 90 秒更新が無いロックは引き継げる
    await rest(`workflow_edit_locks?workflow_id=eq.${wfG}`, { method: 'PATCH', body: JSON.stringify({ heartbeat_at: new Date(Date.now() - 120_000).toISOString() }) })
    const l4 = await rpcU('acquire_workflow_edit_lock', jwtOwner, { p_workflow_id: wfG, p_session_id: 'a1' })
    check(`90 秒更新が無いロックは引き継げる（ok=${l4?.ok}・took_over=${l4?.took_over}）`, l4?.ok === true && l4?.took_over === true)
    // 版を確かめる保存: 古い版では 0 行、今の版なら保存されて版が進む
    const cur = (await (await rest(`workflows?select=canvas_version&id=eq.${wfG}`)).json())[0]?.canvas_version
    const g10 = await rowsOf(await patch(jwtOwner, { canvas_data: canvasG(5) }, `&canvas_version=eq.${cur - 1}`))
    const g11 = await rowsOf(await patch(jwtOwner, { canvas_data: canvasG(5) }, `&canvas_version=eq.${cur}`))
    check(`版を確かめる保存: 古い版は 0 行、今の版は保存されて版が進む（${cur} → ${g11?.[0]?.canvas_version}）`, g10?.length === 0 && g11?.[0]?.canvas_version === cur + 1)
    // 解放 → 行が消える
    const rel = await rpcU('release_workflow_edit_lock', jwtOwner, { p_workflow_id: wfG, p_session_id: 'a1' })
    const leftLocks = await (await rest(`workflow_edit_locks?select=workflow_id&workflow_id=eq.${wfG}`)).json()
    check(`解放できる（${rel}・残 ${leftLocks.length} 行）`, rel === true && leftLocks.length === 0)
    // 所有者が OFF に戻す → メンバーは再び保存不可。所有者はロック無しで保存できる
    await patch(jwtOwner, { team_edit: false })
    const g12 = await rowsOf(await patch(jwtM, { canvas_data: canvasG(6) }))
    const g13 = await rowsOf(await patch(jwtOwner, { canvas_data: canvasG(6) }))
    check(`許可を OFF に戻すとメンバーは保存できず（${g12?.length} 行）、所有者はロック無しで保存できる（version=${g13?.[0]?.canvas_version}）`, g12?.length === 0 && g13?.[0]?.canvas_version === cur + 2)
  }
}

async function cleanup() {
  console.log('\ncleanup...')
  for (const p of created.batchObjects) await fetch(`${URL_BASE}/storage/v1/object/batch`, { method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ prefixes: [p] }) })
  for (const id of created.batchJobs) await rest(`batch_jobs?id=eq.${id}`, { method: 'DELETE' })  // items/tasks/outputs は cascade
  for (const id of created.workflows) await rest(`workflows?id=eq.${id}`, { method: 'DELETE' })
  for (const id of created.projects) await rest(`projects?id=eq.${id}`, { method: 'DELETE' })
  for (const id of created.users) await auth(`admin/users/${id}`, { method: 'DELETE' })
  for (const id of created.teams) await rest(`teams?id=eq.${id}`, { method: 'DELETE' })
  // remove/leave がサーバー側で作る個人チーム（"<email> (個人)"）も TAG 一致で掃除
  const strays = await (await rest(`teams?select=id&name=ilike.*${TAG}*`)).json()
  for (const t of strays) await rest(`teams?id=eq.${t.id}`, { method: 'DELETE' })
  const left = await (await rest(`teams?select=id&name=ilike.*${TAG}*`)).json()
  console.log(`  残 ${TAG}: teams=${left.length}`)
}

let exitCode = 0
try {
  await main()
} catch (e) {
  console.error('\n💥 実行エラー:', e.message)
  exitCode = 2
} finally {
  await cleanup().catch((e) => console.error('cleanup エラー:', e.message))
}
console.log(`\n${fail === 0 && exitCode === 0 ? '✅ 統合テスト PASS' : '❌ 統合テスト FAIL'}: ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? exitCode : 1)
