// dev 限定: 背景切り抜きエンジンの比較ページ（/dev/cutout-bench）。本番ビルドには含めない（router で DEV ガード）。
// ローカルのテストセット（vite の /dev-testset が配信）を batch バケットに上げ、Bria / BiRefNet を同じ共通処理で回して並べる。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fal } from '../../lib/ai/fal-client'
import type { CutoutEngine, CutoutParams, CutoutRef } from '../../types/nodes'
import {
  BIREFNET_MODELS, BIREFNET_RESOLUTIONS, CUTOUT_ENGINES, CUTOUT_ENGINE_IDS, DEFAULT_CUTOUT_PARAMS,
  buildEngineRequest, pickEngineResult,
} from '../../lib/cutout/engines'
import { decodeBlob, fetchBlob } from '../../lib/cutout/decode'
import { buildCutoutFromEngineResult, loadOriginal, loadRawAlpha, renderCutoutFullPng } from '../../lib/cutout/runCutout'
import { resolveTeamId, signBatchPath, uploadBatchObject } from '../../lib/cutout/store'

interface TestFile { name: string; size: number }
interface BenchResult { engine: CutoutEngine; ms: number; ref: CutoutRef; previewUrl: string | null; error?: string }
interface BenchRow { name: string; width: number; height: number; originalUrl: string; results: Partial<Record<CutoutEngine, BenchResult>> }

const CHECKER: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  backgroundImage:
    'linear-gradient(45deg,#CCCCCC 25%,transparent 25%),linear-gradient(-45deg,#CCCCCC 25%,transparent 25%),' +
    'linear-gradient(45deg,transparent 75%,#CCCCCC 75%),linear-gradient(-45deg,transparent 75%,#CCCCCC 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
}

const INPUT = 'h-8 rounded-md px-2 text-[12px] text-[var(--text-primary)] bg-[var(--bg-canvas)] border border-[var(--border)]'

export function CutoutBenchPage() {
  const [files, setFiles] = useState<TestFile[]>([])
  const [dir, setDir] = useState('')
  const [engines, setEngines] = useState<CutoutEngine[]>(['bria', 'birefnet'])
  const [params, setParams] = useState<CutoutParams>({ ...DEFAULT_CUTOUT_PARAMS })
  const [rows, setRows] = useState<BenchRow[]>([])
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [limit, setLimit] = useState(10)

  useEffect(() => {
    fetch('/dev-testset/').then((r) => r.json()).then((j: { dir: string; files: TestFile[] }) => {
      setDir(j.dir); setFiles(j.files)
    }).catch(() => setLog((l) => [...l, 'テストセット一覧の取得に失敗（dev サーバーを再起動してください）']))
  }, [])

  const append = useCallback((m: string) => setLog((l) => [...l.slice(-200), `${new Date().toLocaleTimeString()} ${m}`]), [])

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setRows([])
    try {
      const teamId = await resolveTeamId()
      const runId = Date.now().toString(36)
      const baseDir = `${teamId}/interactive/bench/${runId}`
      const targets = files.slice(0, limit)
      append(`開始: ${targets.length} 枚 × ${engines.length} エンジン (${baseDir})`)
      for (const f of targets) {
        const safe = f.name.replace(/[^A-Za-z0-9._-]/g, '_')
        append(`${f.name}: 読み込み`)
        const blob = await fetchBlob(`/dev-testset/${encodeURIComponent(f.name)}`)
        const original = await decodeBlob(blob)
        const origPath = `${baseDir}/${safe}`
        await uploadBatchObject(origPath, blob, blob.type || 'image/jpeg')
        const originalUrl = await signBatchPath(origPath)
        if (!originalUrl) throw new Error('元画像の署名に失敗')
        const row: BenchRow = { name: f.name, width: original.width, height: original.height, originalUrl, results: {} }
        setRows((rs) => [...rs, row])
        for (const engine of engines) {
          const p: CutoutParams = { ...params, engine }
          const t0 = performance.now()
          try {
            const req = buildEngineRequest(p, originalUrl)
            append(`${f.name}: ${CUTOUT_ENGINES[engine].label} 実行`)
            const result = await fal.subscribe(req.endpoint, { input: req.input, logs: false })
            const resultFile = pickEngineResult(engine, (result as unknown as { data?: unknown }).data)
            const falMs = Math.round(performance.now() - t0)
            const built = await buildCutoutFromEngineResult({
              engine, original, resultFile, params: p, dir: `${baseDir}/${engine}`, sourceRef: origPath,
            })
            const ms = Math.round(performance.now() - t0)
            const previewUrl = await signBatchPath(built.ref.previewPath)
            append(`${f.name}: ${CUTOUT_ENGINES[engine].label} 完了 fal ${falMs}ms / 合計 ${ms}ms`)
            setRows((rs) => rs.map((r) => (r.name === f.name ? { ...r, results: { ...r.results, [engine]: { engine, ms, ref: built.ref, previewUrl } } } : r)))
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            append(`${f.name}: ${CUTOUT_ENGINES[engine].label} 失敗 ${msg}`)
            setRows((rs) => rs.map((r) => (r.name === f.name ? { ...r, results: { ...r.results, [engine]: { engine, ms: 0, ref: null as unknown as CutoutRef, previewUrl: null, error: msg } } } : r)))
          }
        }
      }
      append('完了')
    } catch (e) {
      append(`中断: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }, [running, files, limit, engines, params, append])

  const download = useCallback(async (row: BenchRow, res: BenchResult) => {
    try {
      const maskUrl = await signBatchPath(res.ref.maskPath)
      if (!maskUrl) throw new Error('マスクの署名に失敗')
      const [original, rawAlpha] = await Promise.all([loadOriginal(row.originalUrl), loadRawAlpha(maskUrl, res.ref.width, res.ref.height)])
      const blob = await renderCutoutFullPng(original, rawAlpha, res.ref.params)
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = `${row.name.replace(/\.[^.]+$/, '')}-${res.engine}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(u), 1000)
    } catch (e) {
      append(`ダウンロード失敗: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [append])

  const summary = useMemo(() => {
    const out: Record<string, { n: number; ms: number; fail: number }> = {}
    for (const r of rows) for (const engine of engines) {
      const res = r.results[engine]
      if (!res) continue
      const s = (out[engine] ??= { n: 0, ms: 0, fail: 0 })
      if (res.error) s.fail++
      else { s.n++; s.ms += res.ms }
    }
    return out
  }, [rows, engines])

  return (
    <div className="min-h-screen p-6 text-[13px]" style={{ background: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      <h1 className="text-[16px] font-semibold mb-1">Cutout bench（dev 限定）</h1>
      <div className="text-[12px] mb-4" style={{ color: 'var(--text-secondary)' }}>
        テストセット: <code>{dir || '(取得中)'}</code> — {files.length} 枚。CUTOUT_TESTSET_DIR（.env.local）で変更できます。
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded-lg" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
        <label className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>枚数</span>
          <input type="number" className={INPUT} style={{ width: 72 }} value={limit} min={1} max={50} onChange={(e) => setLimit(Number(e.target.value))} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>エンジン</span>
          <div className="flex gap-3 h-8 items-center">
            {CUTOUT_ENGINE_IDS.map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={engines.includes(k)} onChange={(e) => setEngines((es) => (e.target.checked ? [...new Set([...es, k])] : es.filter((x) => x !== k)))} />
                {CUTOUT_ENGINES[k].label}
              </label>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>BiRefNet モデル</span>
          <select className={INPUT} value={params.birefnetModel} onChange={(e) => setParams((p) => ({ ...p, birefnetModel: e.target.value }))}>
            {BIREFNET_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>動作解像度</span>
          <select className={INPUT} value={params.birefnetResolution} onChange={(e) => setParams((p) => ({ ...p, birefnetResolution: e.target.value }))}>
            {BIREFNET_RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>しきい値</span>
          <input type="number" className={INPUT} style={{ width: 72 }} value={params.alphaThreshold} min={0} max={255} onChange={(e) => setParams((p) => ({ ...p, alphaThreshold: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>ぼかし px</span>
          <input type="number" className={INPUT} style={{ width: 72 }} value={params.featherPx} min={0} max={50} onChange={(e) => setParams((p) => ({ ...p, featherPx: Number(e.target.value) }))} />
        </label>
        <button
          className="h-9 px-4 rounded-lg text-white text-[12px] font-medium disabled:opacity-50"
          style={{ background: '#14B8A6' }}
          disabled={running || files.length === 0 || engines.length === 0}
          onClick={run}
        >
          {running ? '実行中…' : `実行（${Math.min(limit, files.length)} 枚 × ${engines.length}）`}
        </button>
      </div>

      {Object.keys(summary).length > 0 && (
        <div className="flex gap-4 mb-4 text-[12px]">
          {Object.entries(summary).map(([k, s]) => (
            <div key={k} className="px-3 py-2 rounded-md" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
              <b>{CUTOUT_ENGINES[k as CutoutEngine].label}</b>: {s.n} 枚 平均 {s.n ? Math.round(s.ms / s.n) : 0}ms{s.fail ? `・失敗 ${s.fail}` : ''}
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <table className="w-full border-collapse text-[12px] mb-4">
          <thead>
            <tr style={{ color: 'var(--text-secondary)' }}>
              <th className="text-left p-2">画像</th>
              {engines.map((k) => <th key={k} className="text-left p-2">{CUTOUT_ENGINES[k].label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="p-2 align-top" style={{ width: 260 }}>
                  <img src={row.originalUrl} alt="" className="block rounded" style={{ width: 240, height: 240, objectFit: 'contain', background: '#222' }} />
                  <div className="mt-1 break-all">{row.name}</div>
                  <div style={{ color: 'var(--text-tertiary)' }}>{row.width}×{row.height}</div>
                </td>
                {engines.map((k) => {
                  const res = row.results[k]
                  return (
                    <td key={k} className="p-2 align-top" style={{ width: 260 }}>
                      {!res ? (
                        <div style={{ color: 'var(--text-tertiary)' }}>待機中…</div>
                      ) : res.error ? (
                        <div style={{ color: '#EF4444' }}>{res.error}</div>
                      ) : (
                        <>
                          <div className="rounded overflow-hidden" style={{ ...CHECKER, width: 240, height: 240 }}>
                            {res.previewUrl && <img src={res.previewUrl} alt="" style={{ width: 240, height: 240, objectFit: 'contain' }} />}
                          </div>
                          <div className="mt-1">{res.ms}ms{res.ref.bbox ? `・商品 ${res.ref.bbox.w}×${res.ref.bbox.h}` : '・検出なし'}</div>
                          <button className="mt-1 underline" style={{ color: '#14B8A6' }} onClick={() => download(row, res)}>透過 PNG をダウンロード</button>
                        </>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <pre className="text-[11px] p-3 rounded-md overflow-auto" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', maxHeight: 240, color: 'var(--text-secondary)' }}>
        {log.join('\n')}
      </pre>
    </div>
  )
}
