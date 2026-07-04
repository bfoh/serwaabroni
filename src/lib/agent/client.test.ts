import { describe, it, expect, vi } from 'vitest'
import { callAgent } from './client'
import type { BusinessSnapshot } from './types'

const snap: BusinessSnapshot = {
  currency: 'GHS', todaySales: 0, todayProfit: 0, cashInHand: 0, cashInBank: 0,
  products: [], lowStock: [], owedTotal: 0, owingTotal: 0,
}

describe('callAgent', () => {
  it('posts messages + snapshot and returns the parsed response', async () => {
    const doFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ say: 'Hello', toolCalls: [{ name: 'get_summary', input: {} }] }),
    }) as unknown as typeof fetch
    const getToken = vi.fn().mockResolvedValue('jwt-123')

    const r = await callAgent([{ role: 'user', content: 'hi' }], snap, { getToken, doFetch })

    expect(r.say).toBe('Hello')
    expect(r.toolCalls[0].name).toBe('get_summary')
    const [, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent.userJwt).toBe('jwt-123')
    expect(sent.messages).toHaveLength(1)
    expect(sent.snapshot.currency).toBe('GHS')
  })

  it('throws when not signed in', async () => {
    const doFetch = vi.fn() as unknown as typeof fetch
    const getToken = vi.fn().mockResolvedValue(null)
    await expect(callAgent([{ role: 'user', content: 'hi' }], snap, { getToken, doFetch })).rejects.toThrow()
  })

  it('throws on a non-OK response', async () => {
    const doFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'boom' }) }) as unknown as typeof fetch
    const getToken = vi.fn().mockResolvedValue('jwt')
    await expect(callAgent([{ role: 'user', content: 'hi' }], snap, { getToken, doFetch })).rejects.toThrow('boom')
  })
})
