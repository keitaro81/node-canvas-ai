import { describe, it, expect } from 'vitest'
import { initialGate, nextGate, MAX_REALTIME_FAILURES } from './realtimeGate'

describe('realtimeGate（Realtime を諦める判断）', () => {
  it('一度も購読できず失敗が続いたら諦める', () => {
    let g = initialGate()
    for (let i = 0; i < MAX_REALTIME_FAILURES - 1; i++) { g = nextGate(g, 'TIMED_OUT'); expect(g.gaveUp).toBe(false) }
    g = nextGate(g, 'CHANNEL_ERROR')
    expect(g).toEqual({ subscribed: false, failures: MAX_REALTIME_FAILURES, gaveUp: true })
    expect(nextGate(g, 'SUBSCRIBED').gaveUp).toBe(true)   // 諦めた後は変えない
  })
  it('購読できれば失敗数はリセット、その後の切断では諦めない', () => {
    let g = nextGate(nextGate(initialGate(), 'TIMED_OUT'), 'SUBSCRIBED')
    expect(g).toEqual({ subscribed: true, failures: 0, gaveUp: false })
    for (let i = 0; i < 10; i++) g = nextGate(g, 'CLOSED')
    expect(g.gaveUp).toBe(false)
    expect(g.subscribed).toBe(true)
  })
})
