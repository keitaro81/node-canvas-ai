// チャットでワークフローを組む: LLM が返す JSON（DSL）の形と読み取り
import { parseJsonLoose } from '../ai/llm'

export interface DslNode { id: string; type: string; label?: string; params?: Record<string, unknown> }
export interface DslEdge { from: string; to: string }   // "ノードid.ポート名"
export interface DslWorkflow { name?: string; nodes: DslNode[]; edges: DslEdge[] }
export interface AgentReply { message?: string; questions?: string[]; workflow?: DslWorkflow }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [])

/** LLM の本文から応答を読む。JSON でない / 形が違うときは error */
export function parseAgentReply(text: string): { reply: AgentReply | null; error: string | null } {
  const j = parseJsonLoose<unknown>(text)
  if (!isObj(j)) return { reply: null, error: '応答が JSON ではありません' }
  const reply: AgentReply = {}
  if (typeof j.message === 'string' && j.message.trim()) reply.message = j.message.trim()
  const questions = strs(j.questions)
  if (questions.length) reply.questions = questions
  if (isObj(j.workflow)) {
    const w = j.workflow
    const nodes = Array.isArray(w.nodes) ? w.nodes : null
    const edges = Array.isArray(w.edges) ? w.edges : []
    if (!nodes) return { reply: null, error: 'workflow.nodes が配列ではありません' }
    const outNodes: DslNode[] = []
    for (const n of nodes) {
      if (!isObj(n) || typeof n.id !== 'string' || typeof n.type !== 'string') return { reply: null, error: 'workflow.nodes の要素に id / type がありません' }
      outNodes.push({ id: n.id, type: n.type, ...(typeof n.label === 'string' ? { label: n.label } : {}), ...(isObj(n.params) ? { params: n.params } : {}) })
    }
    const outEdges: DslEdge[] = []
    for (const e of edges) {
      if (!isObj(e) || typeof e.from !== 'string' || typeof e.to !== 'string') return { reply: null, error: 'workflow.edges の要素に from / to がありません' }
      outEdges.push({ from: e.from, to: e.to })
    }
    reply.workflow = { ...(typeof w.name === 'string' ? { name: w.name } : {}), nodes: outNodes, edges: outEdges }
  }
  if (!reply.workflow && !reply.questions && !reply.message) return { reply: null, error: '応答に workflow / questions / message のどれもありません' }
  return { reply, error: null }
}
