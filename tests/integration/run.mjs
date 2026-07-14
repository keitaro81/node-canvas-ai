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
const created = { users: [], teams: [], projects: [], workflows: [] }

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
}

async function cleanup() {
  console.log('\ncleanup...')
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
