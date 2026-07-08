// delete-generation の共通サーバーロジック。Edge(/api/storage/delete-generation) と vite dev(/dev-proxy/delete-generation) が共用。
// service role の admin と検証済み userId を受け取り、所有者チェック込みで生成物を削除する。
// 返り値 { status, body } を呼び出し側がそのまま HTTP 応答にする。
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Supabase の公開URL（…/object/public/<bucket>/<path>）から bucket と path を取り出す。形式外は null。 */
function parseStorageUrl(url: string | null): { bucket: string; path: string } | null {
  if (!url) return null
  const marker = '/object/public/'
  const i = url.indexOf(marker)
  if (i === -1) return null
  const rest = url.slice(i + marker.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return null
  return { bucket: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)) }
}

/**
 * canvas_data 内の、削除URLを参照するノードの画像/動画フィールドをクリアし deleted フラグを立てる。
 * 表示は「表示できません」プレースホルダになり、下流生成は「画像なし」として扱われる（クォータ浪費を防ぐ）。
 */
function clearDeletedUrlFromCanvas(canvasData: any, url: string): { changed: boolean; data: unknown } {
  if (!canvasData || !Array.isArray(canvasData.nodes)) return { changed: false, data: canvasData }
  let changed = false
  const nodes = canvasData.nodes.map((node: any) => {
    const d = node?.data ?? {}
    const next = { ...d }
    let nodeChanged = false
    for (const f of ['output', 'imageUrl', 'videoUrl', 'uploadedImagePreview']) {
      if (next[f] === url) { next[f] = null; nodeChanged = true }
    }
    if (next.params && next.params.imageUrl === url) {
      next.params = { ...next.params, imageUrl: null }
      nodeChanged = true
    }
    if (nodeChanged) { next.deleted = true; changed = true; return { ...node, data: next } }
    return node
  })
  return changed ? { changed: true, data: { ...canvasData, nodes } } : { changed: false, data: canvasData }
}

/** Storage オブジェクトをバケットごとにまとめて削除（ベストエフォート）。 */
async function removeStorageObjects(admin: any, urls: (string | null)[]): Promise<void> {
  const byBucket = new Map<string, string[]>()
  for (const u of urls) {
    const parsed = parseStorageUrl(u)
    if (!parsed) continue
    const list = byBucket.get(parsed.bucket) ?? []
    list.push(parsed.path)
    byBucket.set(parsed.bucket, list)
  }
  for (const [bucket, paths] of byBucket) {
    const { error } = await admin.storage.from(bucket).remove(paths)
    if (error) console.warn(`[delete-generation] storage remove failed (${bucket}):`, error.message)
  }
}

export interface DeleteGenerationResult {
  status: number
  body: Record<string, unknown>
}

export async function deleteGenerationServer(
  admin: any,
  userId: string,
  body: { generationId?: string; workflowId?: string },
): Promise<DeleteGenerationResult> {
  // ---- モード1: 生成1件の削除（所有者のみ）----
  if (body.generationId) {
    const { data: gen, error } = await admin
      .from('generations')
      .select('id, output_url, user_id, workflow_id')
      .eq('id', body.generationId)
      .maybeSingle()
    if (error) return { status: 500, body: { error: 'Lookup failed' } }
    if (!gen) return { status: 404, body: { error: 'Not found' } }
    if (gen.user_id !== userId) return { status: 403, body: { error: 'Forbidden' } }

    await removeStorageObjects(admin, [gen.output_url])
    const { error: delErr } = await admin.from('generations').delete().eq('id', gen.id)
    if (delErr) return { status: 500, body: { error: 'Delete failed' } }

    // キャンバスの参照クリア + サムネ修正（同一ワークフロー）。失敗してもベストエフォート。
    if (gen.output_url && gen.workflow_id) {
      const { data: wf } = await admin
        .from('workflows')
        .select('canvas_data, thumbnail_url')
        .eq('id', gen.workflow_id)
        .maybeSingle()
      if (wf) {
        const patch: Record<string, unknown> = {}
        const { changed, data } = clearDeletedUrlFromCanvas(wf.canvas_data, gen.output_url)
        if (changed) patch.canvas_data = data
        // サムネが該当URLなら null に。ProjectsPage が次の生成物を動的フォールバック表示する。
        if (wf.thumbnail_url === gen.output_url) patch.thumbnail_url = null
        if (Object.keys(patch).length > 0) {
          const { error: upErr } = await admin.from('workflows').update(patch).eq('id', gen.workflow_id)
          if (upErr) console.warn('[delete-generation] canvas/thumbnail patch failed:', upErr.message)
        }
      }
    }
    return { status: 200, body: { deleted: 1 } }
  }

  // ---- モード2: ワークフロー配下の全生成を削除（ワークフロー所有者のみ）----
  if (body.workflowId) {
    // 所有権: workflow → project.user_id === userId
    const { data: wf } = await admin.from('workflows').select('id, project_id').eq('id', body.workflowId).maybeSingle()
    if (!wf) return { status: 200, body: { deleted: 0 } } // 既に無い
    const { data: project } = await admin.from('projects').select('user_id').eq('id', wf.project_id).maybeSingle()
    if (!project || project.user_id !== userId) return { status: 403, body: { error: 'Forbidden' } }

    const { data: gens } = await admin.from('generations').select('id, output_url').eq('workflow_id', body.workflowId)
    const rows = (gens ?? []) as { id: string; output_url: string | null }[]

    await removeStorageObjects(admin, rows.map((r) => r.output_url))
    const { error: delErr } = await admin.from('generations').delete().eq('workflow_id', body.workflowId)
    if (delErr) return { status: 500, body: { error: 'Delete failed' } }
    return { status: 200, body: { deleted: rows.length } }
  }

  return { status: 400, body: { error: 'Missing generationId or workflowId' } }
}
