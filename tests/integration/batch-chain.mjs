#!/usr/bin/env node
// フェーズ C(a) の受入テスト（API だけで実行）: AI 処理 2 段の連鎖。本番 DB に一時ユーザー/チーム/ジョブを作り、最後に必ず削除する。
//   ③ 写真 → Image Generation（レタッチ）→ Remove Background → Product Layout（ec_white）
//   ④ 切り抜き → Image Generation（合成）→ 結果
//   APP_URL=https://node-canvas-ai.vercel.app（既定・Webhook で後段が自動投入）/ APP_URL=http://localhost:5173（dev・照合で後段を投入）
//   ITEMS=2（既定）。fal のコスト ≈ 写真 1 枚あたり Nano Banana 2 編集 ×2（$0.078）+ BiRefNet（$0.002）
// 使い方: npm run test:batch:chain
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
for (const line of readFileSync(resolve(__dirname, '../../.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const URL_BASE = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY, SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP = process.env.APP_URL || 'https://node-canvas-ai.vercel.app'
const IS_DEV = APP.includes('localhost')
const API = IS_DEV ? `${APP}/dev-proxy/batch` : `${APP}/api/batch`
const ITEMS = Number(process.env.ITEMS || 2)
const TESTSET = resolve(__dirname, '../../testset/cutout')
const adminHeaders = { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json' }
const rest = (p, init = {}) => fetch(`${URL_BASE}/rest/v1/${p}`, { ...init, headers: { ...adminHeaders, ...(init.headers || {}) } })
const auth = (p, init = {}) => fetch(`${URL_BASE}/auth/v1/${p}`, { ...init, headers: { ...adminHeaders, ...(init.headers || {}) } })
const TAG = `chain-${Math.random().toString(36).slice(2, 8)}`
const created = { users: [], teams: [], jobs: [], objects: [] }
let pass = 0, fail = 0
const check = (d, c, detail = '') => { if (c) { pass++; console.log(`  ✅ ${d}`) } else { fail++; console.log(`  ❌ ${d} — ${detail}`) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (jwt, action, body) => { const r = await fetch(`${API}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
const userRest = (jwt, p) => fetch(`${URL_BASE}/rest/v1/${p}`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } }).then((r) => r.json())

async function mkUser(suffix) {
  const email = `${TAG}-${suffix}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`
  const cu = await (await auth('admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) })).json()
  if (!cu.id) throw new Error(`createUser failed: ${JSON.stringify(cu)}`)
  created.users.push(cu.id)
  const team = await (await rest('teams', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: `${TAG} ${suffix}` }) })).json()
  const teamId = team[0].id; created.teams.push(teamId)
  await rest('team_members', { method: 'POST', body: JSON.stringify({ team_id: teamId, user_id: cu.id, role: 'owner' }) })
  const tk = await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()
  return { id: cu.id, teamId, jwt: tk.access_token }
}
async function uploadOriginals(A, n) {
  const files = readdirSync(TESTSET).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !f.startsWith('.')).sort()
  const items = []
  for (let i = 0; i < n; i++) {
    const f = files[i % files.length]; const ext = f.split('.').pop().toLowerCase().replace('jpeg', 'jpg')
    const name = `SKU-${String(i + 1).padStart(3, '0')}_front.${ext}`; const path = `${A.teamId}/interactive/node-test/items/${TAG}-${i + 1}-${name}`
    const up = await fetch(`${URL_BASE}/storage/v1/object/batch/${path}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${A.jwt}`, 'Content-Type': ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' }, body: readFileSync(resolve(TESTSET, f)) })
    if (!up.ok) throw new Error(`upload failed ${up.status}: ${await up.text()}`)
    created.objects.push(path)
    items.push({ index: i + 1, originalName: name, sku: `SKU-${String(i + 1).padStart(3, '0')}`, interactivePath: path })
  }
  return items
}
const RB = { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '1024x1024', alphaThreshold: 8, featherPx: 0 }
const RETOUCH_PROMPT = 'Gently retouch this product photo: even out the lighting and remove dust, keep the product shape, colors and background unchanged'
const COMPOSE_PROMPT = 'Place this product in a bright minimal studio scene for a social media post, keep the product exactly as is'
// ③ 写真 → レタッチ（結果ノード経由）→ 切り抜き → レイアウト
const snapshotRetouchThenCutout = () => ({
  nodes: [
    { id: 'bi', type: 'batchInputNode', data: { type: 'batchInput', params: {} } },
    { id: 'tp1', type: 'textPromptNode', data: { type: 'textPrompt', params: { prompt: RETOUCH_PROMPT } } },
    { id: 'retouch', type: 'imageGenerationNode', data: { type: 'imageGen', label: 'レタッチ', params: { editModel: 'fal-ai/nano-banana-2', aspectRatio: 'auto', resolution: '1K' } } },
    { id: 'disp', type: 'imageDisplayNode', data: { type: 'imageDisplay' } },
    { id: 'rb', type: 'removeBackgroundNode', data: { type: 'removeBackground', params: RB } },
    { id: 'pl', type: 'productLayoutNode', data: { type: 'productLayout', params: { variantName: 'ec_white' } } },
  ],
  edges: [
    { source: 'bi', sourceHandle: 'out-image-image', target: 'retouch', targetHandle: 'in-image-1' },
    { source: 'tp1', sourceHandle: 'out-text-text-out', target: 'retouch', targetHandle: 'in-text' },
    { source: 'retouch', sourceHandle: 'out-image-image-out', target: 'disp', targetHandle: 'in-image-image-in' },
    { source: 'disp', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' },
    { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'pl', targetHandle: 'in-cutout-cutout' },
  ],
})
// ④ 写真 → 切り抜き → 合成（＋レイアウト）
const snapshotCutoutThenCompose = () => ({
  nodes: [
    { id: 'bi', type: 'batchInputNode', data: { type: 'batchInput', params: {} } },
    { id: 'rb', type: 'removeBackgroundNode', data: { type: 'removeBackground', params: RB } },
    { id: 'pl', type: 'productLayoutNode', data: { type: 'productLayout', params: { variantName: 'ec_white' } } },
    { id: 'tp2', type: 'textPromptNode', data: { type: 'textPrompt', params: { prompt: COMPOSE_PROMPT } } },
    { id: 'compose', type: 'imageGenerationNode', data: { type: 'imageGen', label: '合成', params: { editModel: 'fal-ai/nano-banana-2', aspectRatio: '1:1', resolution: '1K' } } },
  ],
  edges: [
    { source: 'bi', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' },
    { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'pl', targetHandle: 'in-cutout-cutout' },
    { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'compose', targetHandle: 'in-image-1' },
    { source: 'tp2', sourceHandle: 'out-text-text-out', target: 'compose', targetHandle: 'in-text' },
  ],
})
// 3 段（レタッチ → 切り抜き → 合成）は 3 段目が対象外になる（dryRun だけ）
const snapshotThreeStages = () => { const s = snapshotRetouchThenCutout(); const c = snapshotCutoutThenCompose(); return { nodes: [...s.nodes, ...c.nodes.filter((n) => ['tp2', 'compose'].includes(n.id))], edges: [...s.edges, ...c.edges.filter((e) => e.target === 'compose')] } }

/** ジョブを 1 件流して完了まで待ち、タスク・アイテム・ジョブ行を返す */
async function runJob(A, items, name, snapshot, first, second) {
  const cr = await api(A.jwt, 'create', { name: `${TAG} ${name}`, items, workflowSnapshot: snapshot })
  check(`${name}: create 200 → jobId`, cr.status === 200 && !!cr.json?.jobId, JSON.stringify(cr.json).slice(0, 200))
  const jobId = cr.json.jobId; if (!jobId) return null
  created.jobs.push(jobId)
  let last = null
  for (let i = 0; i < 20; i++) { const s = await api(A.jwt, 'submit', { jobId }); last = s.json; if (s.status !== 200) { console.log('  submit error', s.status, JSON.stringify(s.json).slice(0, 200)); break } if (last.done) break }
  const t0rows = await userRest(A.jwt, `batch_tasks?select=node_id,status,input&job_id=eq.${jobId}`)
  const st = (n) => t0rows.filter((t) => t.node_id === n).map((t) => t.status)
  check(`${name}: submit 完了 — 1 段目（${first}）だけ投入、2 段目（${second}）は前段待ち（投入 ${last?.submitted}・待ち ${last?.waitingTasks}・total ${last?.totalTasks}）→ ${first}=${st(first)} ${second}=${st(second)}`,
    !!last?.done && last.totalTasks === ITEMS * 2 && last.waitingTasks === ITEMS && st(first).every((x) => x === 'submitted') && st(second).every((x) => x === 'pending'), JSON.stringify(last).slice(0, 200))
  const secondRow = t0rows.find((t) => t.node_id === second)
  check(`${name}: 2 段目のタスクに段と依存が記録（__stage=${secondRow?.input?.__stage}・__depends_on=${secondRow?.input?.__depends_on}）`, secondRow?.input?.__stage === 2 && secondRow?.input?.__depends_on === first)
  let job = null
  const t0 = Date.now()
  for (let i = 0; i < 72; i++) {
    await sleep(5000)
    if (IS_DEV || i >= 18) await api(A.jwt, 'reconcile', { jobId, minAgeSec: 0 })
    ;[job] = await userRest(A.jwt, `batch_jobs?select=status,completed_tasks,failed_tasks,task_count,actual_cost_usd&id=eq.${jobId}`)
    if (job && ['completed', 'partial_failed'].includes(job.status)) break
  }
  const secs = Math.round((Date.now() - t0) / 1000)
  check(`${name}: ジョブが完了（${job?.status}・完了 ${job?.completed_tasks}/${job?.task_count}・失敗 ${job?.failed_tasks}・実績 $${job?.actual_cost_usd}・${secs}s）`, job?.status === 'completed' && job.completed_tasks === ITEMS * 2, JSON.stringify(job))
  const tasks = await userRest(A.jwt, `batch_tasks?select=item_id,node_id,status,result_path,result_meta,submitted_at,completed_at&job_id=eq.${jobId}&order=created_at`)
  const itemsRows = await userRest(A.jwt, `batch_items?select=id,status&job_id=eq.${jobId}`)
  check(`${name}: アイテムは最後の段が終わってから準備完了（ready ${itemsRows.filter((i) => i.status === 'ready').length}/${ITEMS}）`, itemsRows.length === ITEMS && itemsRows.every((i) => i.status === 'ready'))
  const ordered = itemsRows.every((it) => { const a = tasks.find((t) => t.item_id === it.id && t.node_id === first), b = tasks.find((t) => t.item_id === it.id && t.node_id === second); return a && b && new Date(b.submitted_at) >= new Date(a.completed_at) })
  check(`${name}: 2 段目は 1 段目の完了後に投入されている（投入時刻 ≥ 前段の完了時刻）`, ordered)
  return { jobId, tasks, itemsRows, job }
}

try {
  console.log(`target: ${API}  items: ${ITEMS}  mode: ${IS_DEV ? 'dev(照合)' : 'prod(Webhook)'}`)
  const A = await mkUser('a')
  const items = await uploadOriginals(A, ITEMS)

  // 計画（dryRun）: 段数・内訳・3 段目の警告
  const dry3 = await api(A.jwt, 'create', { items, workflowSnapshot: snapshotRetouchThenCutout(), dryRun: true })
  const bd = dry3.json?.plan?.breakdown ?? []
  check(`③ dryRun: タスク ${dry3.json?.plan?.totalTasks}（段数 ${dry3.json?.plan?.maxStage}・写真ごとの生成 ${dry3.json?.plan?.perItemGenerations} 件）・見積 $${dry3.json?.plan?.estimatedCostUsd}・内訳 ${bd.map((b) => `${b.label}(段${b.stage}) ${b.count}×$${b.unitUsd}`).join(' / ')}`,
    dry3.status === 200 && dry3.json?.plan?.totalTasks === ITEMS * 2 && dry3.json?.plan?.maxStage === 2 && dry3.json?.plan?.perItemGenerations === ITEMS && bd.length === 2 && (dry3.json?.plan?.warnings ?? []).length === 0, JSON.stringify(dry3.json?.plan).slice(0, 300))
  const dryX = await api(A.jwt, 'create', { items, workflowSnapshot: snapshotThreeStages(), dryRun: true })
  check(`3 段目は対象外（警告: ${(dryX.json?.plan?.warnings ?? [])[0] ?? '無し'}）`, dryX.json?.plan?.totalTasks === ITEMS * 2 && (dryX.json?.plan?.warnings ?? []).some((w) => w.includes('2 段まで')))

  // ③ レタッチ → 切り抜き → レイアウト
  const r3 = await runJob(A, items, '③レタッチ→切り抜き', snapshotRetouchThenCutout(), 'retouch', 'rb')
  if (r3) {
    const rb = r3.tasks.filter((t) => t.node_id === 'rb')
    check(`③: 切り抜きはマスクだけ保存（後段が無いので透過画像は作らない。cutout_path ${rb.filter((t) => t.result_meta?.cutout_path).length}/${ITEMS}）`, rb.every((t) => t.result_path?.endsWith('rb-result.png') && !t.result_meta?.cutout_path))
    const names = ((await (await fetch(`${URL_BASE}/storage/v1/object/list/batch`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ prefix: `${A.teamId}/${r3.jobId}/${r3.itemsRows[0].id}`, limit: 100 }) })).json()) ?? []).map((f) => f.name)
    check(`③: 1 枚目のフォルダ: ${names.join(', ')}`, names.includes('retouch-result.png') && names.includes('rb-result.png'))
    const del = await api(A.jwt, 'delete', { jobId: r3.jobId }); check(`③: delete 200（削除 ${del.json?.deletedFiles} ファイル）`, del.status === 200); created.jobs = created.jobs.filter((j) => j !== r3.jobId)
  }

  // ④ 切り抜き → 合成
  const r4 = await runJob(A, items, '④切り抜き→合成', snapshotCutoutThenCompose(), 'rb', 'compose')
  if (r4) {
    const rb = r4.tasks.filter((t) => t.node_id === 'rb')
    check(`④: 切り抜きはマスク＋透過画像の両方を保存（cutout_path ${rb.filter((t) => t.result_meta?.cutout_path).length}/${ITEMS}）`, rb.length === ITEMS && rb.every((t) => t.result_path?.endsWith('rb-result.png') && typeof t.result_meta?.cutout_path === 'string' && t.result_meta.cutout_path.endsWith('rb-cutout.png')))
    const comp = r4.tasks.filter((t) => t.node_id === 'compose')
    check(`④: 合成の結果が保存されている（${comp.filter((t) => t.result_path).length}/${ITEMS}）`, comp.length === ITEMS && comp.every((t) => t.status === 'completed' && t.result_path?.includes(`/${r4.jobId}/`)))
    const names = ((await (await fetch(`${URL_BASE}/storage/v1/object/list/batch`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ prefix: `${A.teamId}/${r4.jobId}/${r4.itemsRows[0].id}`, limit: 100 }) })).json()) ?? []).map((f) => f.name)
    check(`④: 1 枚目のフォルダ: ${names.join(', ')}`, names.includes('rb-result.png') && names.includes('rb-cutout.png') && names.some((n) => n.startsWith('compose-result')))
    const del = await api(A.jwt, 'delete', { jobId: r4.jobId }); check(`④: delete 200（削除 ${del.json?.deletedFiles} ファイル）`, del.status === 200); created.jobs = created.jobs.filter((j) => j !== r4.jobId)
  }
} catch (e) {
  console.error('\n💥 実行エラー:', e.message); fail++
} finally {
  for (const id of created.jobs) await rest(`batch_jobs?id=eq.${id}`, { method: 'DELETE' })
  for (const p of created.objects) await fetch(`${URL_BASE}/storage/v1/object/batch`, { method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ prefixes: [p] }) })
  for (const id of created.users) await auth(`admin/users/${id}`, { method: 'DELETE' })
  for (const id of created.teams) await rest(`teams?id=eq.${id}`, { method: 'DELETE' })
  const strays = await (await rest(`teams?select=id&name=ilike.*${TAG}*`)).json(); for (const t of strays) await rest(`teams?id=eq.${t.id}`, { method: 'DELETE' })
  console.log(`cleanup done. ${fail === 0 ? '✅ PASS' : '❌ FAIL'}: ${pass} pass / ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
