// チャットでワークフローを組む: LLM を呼び、応答を読み、DSL をコンパイルする（検証に落ちたら 1 回だけ直させる）
import { llmComplete } from '../ai/llmClient'
import type { LlmUsage } from '../ai/llm'
import { parseAgentReply, type AgentReply } from './dsl'
import { compileWorkflow, type CompileResult } from './compile'
import { buildConversationPrompt, buildSystemPrompt, type AgentTurn } from './prompt'

/** 既定は Sonnet（構成の質が第一印象を決める）。落ちたら Haiku */
export const AGENT_MODELS = ['anthropic/claude-sonnet-4.5', 'anthropic/claude-haiku-5.5'] as const
export const AGENT_MAX_TURNS = 12

export interface AgentTurnResult {
  text: string                 // LLM の本文（会話の記録に残す）
  reply: AgentReply | null
  compiled: CompileResult | null
  parseError: string | null
  usage: LlmUsage              // この往復の合計（直しの再呼び出しを含む）
  model: string
  endpoint: string
  repaired: boolean
}

const addUsage = (a: LlmUsage, b: LlmUsage): LlmUsage => ({
  promptTokens: a.promptTokens === null && b.promptTokens === null ? null : (a.promptTokens ?? 0) + (b.promptTokens ?? 0),
  completionTokens: a.completionTokens === null && b.completionTokens === null ? null : (a.completionTokens ?? 0) + (b.completionTokens ?? 0),
  cost: a.cost === null && b.cost === null ? null : (a.cost ?? 0) + (b.cost ?? 0),
})

export async function askBuilder(turns: AgentTurn[], opts: { models?: readonly string[] } = {}): Promise<AgentTurnResult> {
  const systemPrompt = buildSystemPrompt()
  const models = opts.models ?? AGENT_MODELS
  const call = (extra?: string) => llmComplete({ models, systemPrompt, prompt: buildConversationPrompt(turns, extra), temperature: 0.2, maxTokens: 4000 })
  let r = await call()
  let usage = r.usage
  let parsed = parseAgentReply(r.output)
  let compiled = parsed.reply?.workflow ? compileWorkflow(parsed.reply.workflow) : null
  let repaired = false
  const problem = parsed.error ?? (compiled && compiled.errors.length ? `検証エラー:\n${compiled.errors.map((e) => `- ${e}`).join('\n')}` : null)
  if (problem) {
    // 1 回だけ直させる（前回の応答と問題点を添えて）
    const fixTurns: AgentTurn[] = [...turns, { role: 'assistant', content: r.output.slice(0, 6000) }]
    const r2 = await llmComplete({ models, systemPrompt, prompt: buildConversationPrompt(fixTurns, `${problem}\n上の問題を直した JSON だけを返してください。`), temperature: 0.1, maxTokens: 4000 })
    usage = addUsage(usage, r2.usage)
    const parsed2 = parseAgentReply(r2.output)
    const compiled2 = parsed2.reply?.workflow ? compileWorkflow(parsed2.reply.workflow) : null
    const better = !parsed2.error && (!compiled2 || compiled2.errors.length === 0 || (compiled && compiled2.errors.length < compiled.errors.length))
    if (better) { r = r2; parsed = parsed2; compiled = compiled2; repaired = true }
  }
  return { text: r.output, reply: parsed.reply, compiled, parseError: parsed.error, usage, model: r.model, endpoint: r.endpoint, repaired }
}
