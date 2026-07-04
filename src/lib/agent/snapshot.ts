import type { Product, Debt } from '@/lib/supabase'
import type { BusinessSnapshot, SnapshotProduct } from './types'

export interface SnapshotInput {
  products: Product[]
  debts: Debt[]
  todaySales: number
  todayProfit: number
  cashInHand: number
  cashInBank: number
}

const MAX_PRODUCTS = 80

export function buildSnapshot(input: SnapshotInput): BusinessSnapshot {
  const products: SnapshotProduct[] = input.products.slice(0, MAX_PRODUCTS).map((p) => ({
    id: p.id,
    name: p.name,
    qty: p.quantity,
    unit: p.unit,
    price: p.selling_price,
  }))

  const lowStock = input.products
    .filter((p) => p.quantity <= (p.low_stock_threshold || 5))
    .map((p) => ({ name: p.name, qty: p.quantity }))

  const owedTotal = input.debts
    .filter((x) => x.type === 'owed' && !x.is_paid)
    .reduce((s, x) => s + x.amount, 0)
  const owingTotal = input.debts
    .filter((x) => x.type === 'owing' && !x.is_paid)
    .reduce((s, x) => s + x.amount, 0)

  return {
    currency: 'GHS',
    todaySales: input.todaySales,
    todayProfit: input.todayProfit,
    cashInHand: input.cashInHand,
    cashInBank: input.cashInBank,
    products,
    lowStock,
    owedTotal,
    owingTotal,
  }
}
