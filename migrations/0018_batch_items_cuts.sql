-- 0018: 商品訴求動画（2026-10-13）— 1 アイテム = 1 SKU に複数の着用カット（役割ごと）を持たせる
--   cuts: [{ "role": "front" | "right" | "left" | "back" | "detail" | "full", "path": "<batch バケット内パス>", "width": int, "height": int, "name": "<元ファイル名>" }, ...]
--   投入時（batch-submit）に interactive の一時パスからジョブ階層（<team>/<job>/<item>/cut-<role>.<ext>）へコピーして path を書き換える。
--   RLS / 既存のポリシーは変更なし（batch_items の行単位の権限に従う）。
alter table public.batch_items add column if not exists cuts jsonb;
comment on column public.batch_items.cuts is '商品動画: 役割ごとの着用カット（jsonb 配列）。切り抜きのジョブでは null';
