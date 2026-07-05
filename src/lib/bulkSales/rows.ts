import type { Product } from '@/lib/supabase'
import { matchProduct } from '@/lib/agent/match'
import { uid } from '@/lib/data'

export const PAYMENTS = ['cash', 'momo', 'bank', 'credit'] as const
export type Payment = (typeof PAYMENTS)[number]

export interface SaleRawRow {
  product?: string
  quantity?: number
  unit?: string
  unit_price?: number
  payment?: string
  customer?: string
  date?: string
}

export interface SaleDraftRow {
  id: string
  product: string
  productId: string | null
  quantity: number
  unit: string
  unitPrice: number | null
  payment: Payment
  customer: string
  date: string
}

const HEADER_KEY: Record<string, keyof SaleRawRow> = {
  'product': 'product',
  'quantity': 'quantity',
  'unit': 'unit',
  'unit price': 'unit_price',
  'payment': 'payment',
  'customer': 'customer',
  'date': 'date',
}
const NUMERIC: Set<keyof SaleRawRow> = new Set(['quantity', 'unit_price'])

export function rowsFromMatrix(matrix: string[][]): SaleRawRow[] {
  if (matrix.length < 2) return []
  const headers = matrix[0].map((h) => HEADER_KEY[h.trim().toLowerCase()])
  const out: SaleRawRow[] = []
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]
    const row: SaleRawRow = {}
    headers.forEach((key, c) => {
      if (!key) return
      const raw = (cells[c] ?? '').trim()
      if (raw === '') return
      if (NUMERIC.has(key)) {
        const n = Number(raw.replace(/[^\d.-]/g, ''))
        if (!Number.isNaN(n)) (row[key] as number) = n
      } else {
        (row[key] as string) = raw
      }
    })
    if (Object.keys(row).length > 0) out.push(row)
  }
  return out
}

function normPayment(v: string | undefined): Payment {
  const p = (v ?? '').trim().toLowerCase()
  return (PAYMENTS as readonly string[]).includes(p) ? (p as Payment) : 'cash'
}

function normDate(v: string | undefined): string {
  if (v) {
    const d = new Date(v.trim())
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

export function normalizeSaleRow(raw: SaleRawRow): SaleDraftRow {
  return {
    id: uid(),
    product: (raw.product ?? '').trim(),
    productId: null,
    quantity: Number(raw.quantity ?? 0),
    unit: (raw.unit ?? 'piece').trim() || 'piece',
    unitPrice: typeof raw.unit_price === 'number' ? raw.unit_price : null,
    payment: normPayment(raw.payment),
    customer: (raw.customer ?? '').trim(),
    date: normDate(raw.date),
  }
}

export function matchSaleRow(row: SaleDraftRow, products: Product[]): SaleDraftRow {
  const m = matchProduct(row.product, products)
  return { ...row, productId: m.product ? m.product.id : null }
}

export function isPackedSale(row: SaleDraftRow, product: Product): boolean {
  return (
    product.units_per_pack >= 2 &&
    !!product.pack_unit &&
    row.unit.trim().toLowerCase() === product.pack_unit.trim().toLowerCase()
  )
}

export function toBaseSale(
  row: SaleDraftRow,
  product: Product,
): { quantity: number; unitPrice: number; saleUnit: string | null; saleUnitQty: number | null } {
  const packed = isPackedSale(row, product)
  const f = packed ? product.units_per_pack : 1
  const round2 = (n: number) => Math.round(n * 100) / 100
  const enteredPrice = row.unitPrice ?? (packed ? product.selling_price * f : product.selling_price)
  return {
    quantity: row.quantity * f,
    unitPrice: round2(enteredPrice / f),
    saleUnit: packed ? product.pack_unit ?? null : null,
    saleUnitQty: packed ? row.quantity : null,
  }
}

export function saleRowStatus(
  row: SaleDraftRow,
  products: Product[],
): { status: 'ready' | 'unmatched' | 'invalid'; errors: string[]; warnings: string[] } {
  const product = row.productId ? products.find((p) => p.id === row.productId) : undefined
  if (!product) return { status: 'unmatched', errors: ['product'], warnings: [] }

  const errors: string[] = []
  if (!(row.quantity > 0)) errors.push('quantity')
  if (row.unitPrice !== null && !(row.unitPrice > 0)) errors.push('price')
  if (row.payment === 'credit' && !row.customer.trim()) errors.push('customer')
  if (errors.length > 0) return { status: 'invalid', errors, warnings: [] }

  const warnings: string[] = []
  if (toBaseSale(row, product).quantity > product.quantity) warnings.push('stock')
  return { status: 'ready', errors: [], warnings }
}
