// src/lib/agent/readTools.test.ts
import { describe, it, expect } from 'vitest'
import { runReadTool } from './readTools'
import { buildSnapshot } from './snapshot'
import type { Product, Debt } from '@/lib/supabase'

const p = (over: Partial<Product>): Product => ({
  id: 'p', user_id: 'u', name: 'Milo', cost_price: 4, selling_price: 8, quantity: 2,
  unit: 'tin', units_per_pack: 1, category: 'food', low_stock_threshold: 5,
  created_at: '2026-07-01T00:00:00Z', ...over,
})
const d = (over: Partial<Debt>): Debt => ({
  id: 'd', user_id: 'u', person_name: 'Ama', phone: null, amount: 50, amount_paid: 0,
  payments: [], description: null, type: 'owed', due_date: null, is_paid: false,
  paid_at: null, created_at: '2026-07-01T00:00:00Z', ...over,
})

function ctx(products: Product[], debts: Debt[]) {
  const snapshot = buildSnapshot({ products, debts, todaySales: 500, todayProfit: 120, cashInHand: 300, cashInBank: 700 })
  return { products, sales: [], debts, expenses: [], snapshot }
}

describe('runReadTool', () => {
  it('summarises the day', () => {
    const r = runReadTool({ name: 'get_summary', input: { period: 'daily' } }, ctx([p({})], []))
    expect(r?.text).toContain('500')
    expect(r?.text.toLowerCase()).toContain('profit')
  })

  it('lists low stock', () => {
    const r = runReadTool({ name: 'get_low_stock', input: {} }, ctx([p({ name: 'Milo', quantity: 2 })], []))
    expect(r?.text).toContain('Milo')
  })

  it('reports who owes', () => {
    const r = runReadTool({ name: 'get_debts', input: { direction: 'owed' } }, ctx([], [d({ person_name: 'Ama', amount: 50 })]))
    expect(r?.text).toContain('Ama')
  })

  it('returns null for a write tool', () => {
    expect(runReadTool({ name: 'add_sale', input: {} }, ctx([], []))).toBeNull()
  })
})
