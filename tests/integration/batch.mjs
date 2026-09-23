#!/usr/bin/env node
// 撮影後工程 Step 5 の受入テスト（API だけで実行・ブラウザ不要）。本番 DB に一時ユーザー/チーム/ジョブを作り、最後に必ず削除する。
//   APP_URL=https://node-canvas-ai.vercel.app（既定・Webhook で完了）/ APP_URL=http://localhost:5173（dev・照合で完了）
//   ITEMS=20 枚（既定）。fal のコスト: BiRefNet ≈ $0.002 × 枚数
// 使い方: npm run test:batch  /  APP_URL=http://localhost:5173 npm run test:batch
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
for (const line of readFileSync(resolve(__dirname, '../../.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const URL_BASE = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY, SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP = process.env.APP_URL || 'https://node-canvas-ai.vercel.app'
const IS_DEV = APP.includes('localhost')
const API = IS_DEV ? `${APP}/dev-proxy/batch` : `${APP}/api/batch`
const ITEMS = Number(process.env.ITEMS || 20)
const TESTSET = resolve(__dirname, '../../testset/cutout')

const adminHeaders = { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json' }
const rest = (p, init = {}) => fetch(`${URL_BASE}/rest/v1/${p}`, { ...init, headers: { ...adminHeaders, ...(init.headers || {}) } })
const auth = (p, init = {}) => fetch(`${URL_BASE}/auth/v1/${p}`, { ...init, headers: { ...adminHeaders, ...(init.headers || {}) } })
const TAG = `btest-${Math.random().toString(36).slice(2, 8)}`
const created = { users: [], teams: [], jobs: [], objects: [] }
let pass = 0, fail = 0
const check = (d, c, detail = '') => { if (c) { pass++; console.log(`  ✅ ${d}`) } else { fail++; console.log(`  ❌ ${d} — ${detail}`) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function mkUser(suffix, withTeam = true) {
  const email = `${TAG}-${suffix}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`
  const cu = await (await auth('admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) })).json()
  if (!cu.id) throw new Error(`createUser failed: ${JSON.stringify(cu)}`)
  created.users.push(cu.id)
  let teamId = null
  if (withTeam) {
    const team = await (await rest('teams', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: `${TAG} ${suffix}` }) })).json()
    teamId = team[0].id; created.teams.push(teamId)
    await rest('team_members', { method: 'POST', body: JSON.stringify({ team_id: teamId, user_id: cu.id, role: 'owner' }) })
  }
  const tk = await (await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()
  return { id: cu.id, teamId, jwt: tk.access_token }
}
const api = async (jwt, action, body) => { const r = await fetch(`${API}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
const userRest = (jwt, p) => fetch(`${URL_BASE}/rest/v1/${p}`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } }).then((r) => r.json())

async function uploadOriginals(A, n) {
  const files = readdirSync(TESTSET).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !f.startsWith('.')).sort()
  if (!files.length) throw new Error(`testset が空: ${TESTSET}`)
  const items = []
  for (let i = 0; i < n; i++) {
    const f = files[i % files.length]
    const buf = readFileSync(resolve(TESTSET, f))
    const ext = f.split('.').pop().toLowerCase().replace('jpeg', 'jpg')
    const name = `SKU-${String(i + 1).padStart(3, '0')}_front.${ext}`
    const path = `${A.teamId}/interactive/node-test/items/${TAG}-${i + 1}-${name}`
    const ct = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    const up = await fetch(`${URL_BASE}/storage/v1/object/batch/${path}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${A.jwt}`, 'Content-Type': ct }, body: buf })
    if (!up.ok) throw new Error(`upload failed ${up.status}: ${await up.text()}`)
    created.objects.push(path)
    items.push({ index: i + 1, originalName: name, sku: `SKU-${String(i + 1).padStart(3, '0')}`, interactivePath: path })
  }
  return items
}
const snapshotFor = () => ({
  nodes: [
    { id: 'bi', type: 'batchInputNode', data: { type: 'batchInput', params: {} } },
    { id: 'rb', type: 'removeBackgroundNode', data: { type: 'removeBackground', params: { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '1024x1024', alphaThreshold: 8, featherPx: 0 } } },
  ],
  edges: [{ source: 'bi', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' }],
})

try {
  console.log(`target: ${API}  items: ${ITEMS}  mode: ${IS_DEV ? 'dev(照合)' : 'prod(Webhook)'}`)
  const A = await mkUser('a')
  const items = await uploadOriginals(A, ITEMS)

  // dryRun（上限の事前確認）
  const dry = await api(A.jwt, 'create', { items, workflowSnapshot: snapshotFor(), dryRun: true })
  check(`dryRun 200: 残り ${dry.json?.limits?.remaining} 枚・タスク ${dry.json?.plan?.totalTasks}・見積 $${dry.json?.plan?.estimatedCostUsd}`, dry.status === 200 && dry.json?.plan?.totalTasks === ITEMS, JSON.stringify(dry.json).slice(0, 200))

  // 51 枚は拒否
  const many = Array.from({ length: 51 }, (_, i) => ({ ...items[i % items.length], index: i + 1, originalName: `x${i}.jpg`, sku: `x${i}` }))
  const r51 = await api(A.jwt, 'create', { items: many, workflowSnapshot: snapshotFor() })
  check(`51 枚のジョブは拒否（${r51.status} ${r51.json?.error}）`, r51.status === 400 && r51.json?.error === 'items_limit')

  // 他チームのファイル / 未所属ユーザー は拒否
  const B = await mkUser('b')
  const rOther = await api(B.jwt, 'create', { items: items.slice(0, 1), workflowSnapshot: snapshotFor() })
  check(`他チームのファイルを指す投入は拒否（${rOther.status} ${rOther.json?.error}）`, rOther.status === 400)
  const N = await mkUser('n', false)
  const rNo = await api(N.jwt, 'create', { items: items.slice(0, 1), workflowSnapshot: snapshotFor() })
  check(`チーム未所属の投入は拒否（${rNo.status} ${rNo.json?.error}）`, rNo.status === 403)

  // 作成 → 投入（チャンク）
  const cr = await api(A.jwt, 'create', { name: `${TAG} job`, items, workflowSnapshot: snapshotFor() })
  check(`create 200 → jobId`, cr.status === 200 && !!cr.json?.jobId, JSON.stringify(cr.json).slice(0, 200))
  const jobId = cr.json.jobId; if (jobId) created.jobs.push(jobId)
  let rounds = 0, last = null
  for (; rounds < 40; rounds++) { const s = await api(A.jwt, 'submit', { jobId }); last = s.json; if (s.status !== 200) { console.log('  submit error', s.status, JSON.stringify(s.json).slice(0, 200)); break } if (last.done) break }
  check(`submit 完了（${rounds + 1} 回・タスク ${last?.totalTasks}・投入 ${last?.jobStatus}・webhook=${last?.webhook}）`, !!last?.done && last.totalTasks === ITEMS, JSON.stringify(last).slice(0, 200))
  // 再投入しても二重に作らない
  const again = await api(A.jwt, 'submit', { jobId })
  check(`submit を再実行してもタスクは増えない（${again.json?.totalTasks}）`, again.json?.totalTasks === ITEMS && again.json?.tasksCreated === 0 && again.json?.submitted === 0)

  // 完了待ち（prod: Webhook / dev: 照合）
  let job = null
  const t0 = Date.now()
  for (let i = 0; i < 60; i++) {
    await sleep(5000)
    if (IS_DEV || i >= 12) await api(A.jwt, 'reconcile', { jobId, minAgeSec: 0 })  // prod は 60 秒待っても届かない分だけ照合で補う
    ;[job] = await userRest(A.jwt, `batch_jobs?select=status,completed_tasks,failed_tasks,task_count,actual_cost_usd&id=eq.${jobId}`)
    if (job && ['completed', 'partial_failed'].includes(job.status)) break
  }
  check(`ジョブが完了（${job?.status}・完了 ${job?.completed_tasks}/${job?.task_count}・失敗 ${job?.failed_tasks}・実績 $${job?.actual_cost_usd}・${Math.round((Date.now() - t0) / 1000)}s）`, job?.status === 'completed' && job.completed_tasks === ITEMS, JSON.stringify(job))
  const readyItems = await userRest(A.jwt, `batch_items?select=status&job_id=eq.${jobId}&status=eq.ready`)
  check(`アイテムがすべて準備完了（${readyItems.length}/${ITEMS}）`, readyItems.length === ITEMS)
  const results = await userRest(A.jwt, `batch_tasks?select=result_path,result_meta&job_id=eq.${jobId}&status=eq.completed`)
  check(`結果ファイルがジョブ階層に保存（例: ${results[0]?.result_path?.split('/').slice(-2).join('/')}）`, results.length === ITEMS && results.every((t) => t.result_path?.startsWith(`${A.teamId}/${jobId}/`)))

  // 冪等: 照合を 2 回呼んでも件数不変
  const before = JSON.stringify(job)
  await api(A.jwt, 'reconcile', { jobId, minAgeSec: 0 }); await api(A.jwt, 'reconcile', { jobId, minAgeSec: 0 })
  const [job2] = await userRest(A.jwt, `batch_jobs?select=status,completed_tasks,failed_tasks,task_count,actual_cost_usd&id=eq.${jobId}`)
  check('完了後に照合を 2 回呼んでも状態・件数は不変', JSON.stringify(job2) === before)

  // 失敗分の再実行（Step 6）: 完了タスク 1 件を失敗にした状態を作り（RPC の結果と同じ形）、retry → 再投入 → 完了に戻る
  const noRetry = await api(A.jwt, 'retry', { jobId })
  check(`失敗が無いジョブの retry は何もしない（${noRetry.status}・retried ${noRetry.json?.retriedTasks}）`, noRetry.status === 200 && noRetry.json?.retriedTasks === 0)
  const [victim] = await (await rest(`batch_tasks?select=id,item_id&job_id=eq.${jobId}&status=eq.completed&limit=1`)).json()
  await rest(`batch_tasks?id=eq.${victim.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: 'simulated' }) })
  await rest(`batch_items?id=eq.${victim.item_id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed' }) })
  await rest(`batch_jobs?id=eq.${jobId}`, { method: 'PATCH', body: JSON.stringify({ status: 'partial_failed', completed_tasks: ITEMS - 1, failed_tasks: 1 }) })
  const retry = await api(A.jwt, 'retry', { jobId })
  check(`retry 200（失敗 1 件を未投入へ・アイテム ${retry.json?.resetItems} 件を待機へ・${retry.json?.status}）`, retry.status === 200 && retry.json?.retriedTasks === 1 && retry.json?.resetItems === 1 && retry.json?.status === 'processing', JSON.stringify(retry.json).slice(0, 160))
  let rs = null
  for (let i = 0; i < 40; i++) { rs = (await api(A.jwt, 'submit', { jobId })).json; if (rs?.done) break }
  check(`再投入 完了（投入 ${rs?.submitted} 件・タスク総数は増えない ${rs?.totalTasks}）`, !!rs?.done && rs.totalTasks === ITEMS && rs.tasksCreated === 0)
  let job3 = null
  for (let i = 0; i < 60; i++) {
    await sleep(5000)
    if (IS_DEV || i >= 12) await api(A.jwt, 'reconcile', { jobId, minAgeSec: 0 })
    ;[job3] = await userRest(A.jwt, `batch_jobs?select=status,completed_tasks,failed_tasks,task_count&id=eq.${jobId}`)
    if (job3 && ['completed', 'partial_failed'].includes(job3.status)) break
  }
  const [victimItem] = await userRest(A.jwt, `batch_items?select=status&id=eq.${victim.item_id}`)
  check(`再実行後にジョブが完了に戻る（${job3?.status}・完了 ${job3?.completed_tasks}/${job3?.task_count}・失敗 ${job3?.failed_tasks}・アイテム ${victimItem?.status}）`, job3?.status === 'completed' && job3.completed_tasks === ITEMS && job3.failed_tasks === 0 && victimItem?.status === 'ready', JSON.stringify(job3))

  // NG のみ再実行（Step 7）: 2 枚だけ別エンジン（Bria）で再実行 → その 2 枚だけタスクが差し替わり、他は不変
  const beforeTasks = await userRest(A.jwt, `batch_tasks?select=id,item_id,endpoint,completed_at&job_id=eq.${jobId}&order=created_at`)
  const targets = beforeTasks.slice(0, 2).map((t) => t.item_id)
  const rerun = await api(A.jwt, 'rerun', { jobId, nodeId: 'rb', itemIds: targets, params: { engine: 'bria', alphaThreshold: 16, featherPx: 0 } })
  check(`rerun 200（対象 ${rerun.json?.rerunTasks} 件・${rerun.json?.status}）`, rerun.status === 200 && rerun.json?.rerunTasks === 2 && rerun.json?.status === 'processing', JSON.stringify(rerun.json).slice(0, 200))
  let rr = null
  for (let i = 0; i < 40; i++) { rr = (await api(A.jwt, 'submit', { jobId })).json; if (rr?.done) break }
  check(`再投入 完了（投入 ${rr?.submitted} 件・タスク総数は増えない ${rr?.totalTasks}）`, !!rr?.done && rr.totalTasks === ITEMS && rr.tasksCreated === 0 && rr.submitted === 2)
  let job4 = null
  for (let i = 0; i < 60; i++) {
    await sleep(5000)
    if (IS_DEV || i >= 12) await api(A.jwt, 'reconcile', { jobId, minAgeSec: 0 })
    ;[job4] = await userRest(A.jwt, `batch_jobs?select=status,completed_tasks,failed_tasks,task_count&id=eq.${jobId}`)
    if (job4 && ['completed', 'partial_failed'].includes(job4.status)) break
  }
  const afterTasks = await userRest(A.jwt, `batch_tasks?select=id,item_id,endpoint,completed_at,input,result_path&job_id=eq.${jobId}&order=created_at`)
  const changed = afterTasks.filter((t) => targets.includes(t.item_id))
  const same = afterTasks.filter((t) => !targets.includes(t.item_id))
  const beforeById = Object.fromEntries(beforeTasks.map((t) => [t.id, t]))
  check(`再実行後: 対象 2 件は Bria で完了し __params を持つ（${changed.map((t) => t.endpoint.split('/')[1]).join(',')}）`,
    job4?.status === 'completed' && changed.length === 2 && changed.every((t) => t.endpoint.startsWith('fal-ai/bria') && t.input?.__params?.engine === 'bria' && t.result_path && t.completed_at !== beforeById[t.id]?.completed_at), JSON.stringify(job4))
  check(`再実行後: 他の ${same.length} 件は手つかず（エンドポイント・完了時刻が同じ）`, same.length === ITEMS - 2 && same.every((t) => t.endpoint.startsWith('fal-ai/birefnet') && t.completed_at === beforeById[t.id]?.completed_at))

  // 権限（仕様 4-11）: 同じチームの member は一覧を読めるが削除は 403。owner でない投入者以外の削除は拒否
  const C = await mkUser('c', false)
  await rest('team_members', { method: 'POST', body: JSON.stringify({ team_id: A.teamId, user_id: C.id, role: 'member' }) })
  const cJobs = await userRest(C.jwt, `batch_jobs?select=id&id=eq.${jobId}`)
  const cDel = await api(C.jwt, 'delete', { jobId })
  check(`同チームの member はジョブを読めるが削除は拒否（読める=${Array.isArray(cJobs) && cJobs.length === 1}・delete ${cDel.status} ${cDel.json?.error}）`, Array.isArray(cJobs) && cJobs.length === 1 && cDel.status === 403)
  const cReview = await fetch(`${URL_BASE}/rest/v1/rpc/review_batch_item`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${C.jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_item_id: victim.item_id, p_review: 'ok' }) })
  const [reviewed] = await userRest(A.jwt, `batch_items?select=review,reviewed_by&id=eq.${victim.item_id}`)
  check(`同チームの member は OK/NG を付けられる（${cReview.status}・review=${reviewed?.review}・確認者=本人）`, cReview.status < 300 && reviewed?.review === 'ok' && reviewed?.reviewed_by === C.id)

  // 同時進行ジョブは 2 つまで（未投入のまま 2 件作り、3 件目は 429）
  const j1 = await api(A.jwt, 'create', { name: `${TAG} j1`, items: items.slice(0, 1), workflowSnapshot: snapshotFor() })
  const j2 = await api(A.jwt, 'create', { name: `${TAG} j2`, items: items.slice(0, 1), workflowSnapshot: snapshotFor() })
  const j3 = await api(A.jwt, 'create', { name: `${TAG} j3`, items: items.slice(0, 1), workflowSnapshot: snapshotFor() })
  check(`同時進行 3 つ目のジョブは拒否（${j3.status} ${j3.json?.error}）`, j1.status === 200 && j2.status === 200 && j3.status === 429 && j3.json?.error === 'active_jobs', JSON.stringify(j3.json).slice(0, 160))
  for (const j of [j1, j2]) if (j.json?.jobId) { const d = await api(A.jwt, 'delete', { jobId: j.json.jobId }); if (d.status !== 200) created.jobs.push(j.json.jobId) }

  // 削除 → Storage に残らない
  const del = await api(A.jwt, 'delete', { jobId })
  const leftFiles = await (await fetch(`${URL_BASE}/storage/v1/object/list/batch`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ prefix: `${A.teamId}/${jobId}`, limit: 10 }) })).json()
  const leftRows = await (await rest(`batch_jobs?select=id&id=eq.${jobId}`)).json()
  check(`delete 200（削除 ${del.json?.deletedFiles} ファイル）→ Storage/DB に残らない（files=${Array.isArray(leftFiles) ? leftFiles.length : '?'}, rows=${leftRows.length}）`, del.status === 200 && Array.isArray(leftFiles) && leftFiles.length === 0 && leftRows.length === 0)
  if (del.status === 200) created.jobs = created.jobs.filter((j) => j !== jobId)
} catch (e) {
  console.error('\n💥', e.message); fail++
} finally {
  for (const j of created.jobs) { await rest(`batch_jobs?id=eq.${j}`, { method: 'DELETE' }) }
  for (const p of created.objects) await fetch(`${URL_BASE}/storage/v1/object/batch`, { method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ prefixes: [p] }) })
  for (const t of created.teams) { const list = await (await fetch(`${URL_BASE}/storage/v1/object/list/batch`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ prefix: t, limit: 1000 }) })).json(); if (Array.isArray(list) && list.length) console.log(`  (残りオブジェクト ${list.length} 件は再帰削除しません: ${t})`) }
  for (const u of created.users) await auth(`admin/users/${u}`, { method: 'DELETE' })
  for (const t of created.teams) await rest(`teams?id=eq.${t}`, { method: 'DELETE' })
  const strays = await (await rest(`teams?select=id&name=ilike.*${TAG}*`)).json(); for (const t of strays) await rest(`teams?id=eq.${t.id}`, { method: 'DELETE' })
  console.log(`\ncleanup done. ${fail === 0 ? '✅ PASS' : '❌ FAIL'}: ${pass} pass / ${fail} fail`)
  process.exitCode = fail === 0 ? 0 : 1
}
