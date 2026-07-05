import { describe, it, expect, vi } from 'vitest'
import { runTurn, parseReceiptReply } from './useAgent'
import type { BusinessSnapshot } from '@/lib/agent/types'
import type { Product } from '@/lib/supabase'

const snap: BusinessSnapshot = {
  currency: 'GHS', todaySales: 500, todayProfit: 120, cashInHand: 300, cashInBank: 700,
  products: [], lowStock: [], owedTotal: 0, owingTotal: 0,
}
const products: Product[] = [{
  id: 'p1', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 20,
  unit: 'pc', units_per_pack: 1, category: 'food', low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z',
}]

const readCtx = { products, sales: [], debts: [], expenses: [], snapshot: snap }

describe('runTurn', () => {
  it('answers a read query with spoken text and no pending preview', async () => {
    const callAgent = vi.fn().mockResolvedValue({ say: '', toolCalls: [{ name: 'get_summary', input: { period: 'daily' } }] })
    const out = await runTurn('how are sales today', {
      history: [], snapshot: snap, readCtx, previewCtx: { products }, callAgent,
    })
    expect(out.reply).toContain('500')
    expect(out.pending).toBeNull()
  })

  it('returns a pending confirm preview for a sale', async () => {
    const callAgent = vi.fn().mockResolvedValue({
      say: 'Okay', toolCalls: [{ name: 'add_sale', input: { items: [{ product: 'indomie', qty: 5 }], payment: 'cash' } }],
    })
    const out = await runTurn('sell 5 indomie cash', {
      history: [], snapshot: snap, readCtx, previewCtx: { products }, callAgent,
    })
    expect(out.pending?.kind).toBe('sale')
    expect(out.reply.toLowerCase()).toContain('confirm')
  })

  it('surfaces a clarify question when the write tool errors', async () => {
    const callAgent = vi.fn().mockResolvedValue({
      say: '', toolCalls: [{ name: 'add_sale', input: { items: [{ product: 'zzz', qty: 5 }] } }],
    })
    const out = await runTurn('sell 5 zzz', {
      history: [], snapshot: snap, readCtx, previewCtx: { products }, callAgent,
    })
    expect(out.pending).toBeNull()
    expect(out.reply).toContain("couldn't find")
  })

  it('falls back to the model text when there are no tool calls', async () => {
    const callAgent = vi.fn().mockResolvedValue({ say: 'Hello Auntie!', toolCalls: [] })
    const out = await runTurn('hi', { history: [], snapshot: snap, readCtx, previewCtx: { products }, callAgent })
    expect(out.reply).toBe('Hello Auntie!')
  })

  it('returns a receipt request (no pending) for the send_receipt tool', async () => {
    // (kept for the LLM fallback path)
    const callAgent = vi.fn().mockResolvedValue({
      say: '', toolCalls: [{ name: 'send_receipt', input: { customer_name: 'Ama', customer_phone: '0241234567' } }],
    })
    const out = await runTurn('send it to Ama, 0241234567', {
      history: [], snapshot: snap, readCtx, previewCtx: { products }, callAgent,
    })
    expect(out.pending).toBeNull()
    expect(out.receipt).toEqual({ customerName: 'Ama', customerPhone: '0241234567' })
  })
})

describe('parseReceiptReply', () => {
  it('extracts name and phone from a spoken answer', () => {
    expect(parseReceiptReply('Her name is Ama and the number is 0241234567')).toEqual({
      negative: false,
      name: 'Ama',
      phone: '0241234567',
    })
  })

  it('handles a phone with spaces/dashes', () => {
    const r = parseReceiptReply('Kofi Mensah 024-123 4567')
    expect(r.phone).toBe('0241234567')
    expect(r.name).toBe('Kofi Mensah')
  })

  it('detects a decline', () => {
    expect(parseReceiptReply('no').negative).toBe(true)
    expect(parseReceiptReply("no, don't send").negative).toBe(true)
  })

  it('is not a decline when a number is present', () => {
    expect(parseReceiptReply('yes 0201112222').negative).toBe(false)
    expect(parseReceiptReply('yes 0201112222').phone).toBe('0201112222')
  })
})
