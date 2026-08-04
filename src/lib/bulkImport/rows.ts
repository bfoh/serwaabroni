import type { Product } from '@/lib/supabase'
import { matchProduct } from '@/lib/agent/match'
import { uid } from '@/lib/data'

export const CATEGORIES = ['Groceries', 'Dairy', 'Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles', 'Bakery']
export const UNITS = ['piece', 'sachet', 'bag', 'tin', 'bottle', 'box', 'pack', 'kg']

export interface RawRow {
  name?: string
  quantity?: number
  unit?: string
  cost_price?: number
  selling_price?: number
  category?: string
  pack_unit?: string
  units_per_pack?: number
  low_stock_threshold?: number
}

export interface DraftRow {
  id: string
  name: string
  quantity: number
  unit: string
  costPrice: number
  sellPrice: number
  category: string
  packUnit: string | null
  unitsPerPack: number
  lowStockThreshold: number | null
}

// Header label → RawRow key.
const HEADER_KEY: Record<string, keyof RawRow> = {
  'name': 'name',
  'quantity': 'quantity',
  'unit': 'unit',
  'cost price': 'cost_price',
  'selling price': 'selling_price',
  'category': 'category',
  'pack unit': 'pack_unit',
  'units per pack': 'units_per_pack',
  'low stock threshold': 'low_stock_threshold',
}

const NUMERIC: Set<keyof RawRow> = new Set([
  'quantity', 'cost_price', 'selling_price', 'units_per_pack', 'low_stock_threshold',
])

export function rowsFromMatrix(matrix: string[][]): RawRow[] {
  if (matrix.length < 2) return []
  const headers = matrix[0].map((h) => HEADER_KEY[h.trim().toLowerCase()])
  const out: RawRow[] = []
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]
    const row: RawRow = {}
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

export function normalizeRow(raw: RawRow): DraftRow {
  const quantity = Number(raw.quantity ?? 0)
  return {
    id: uid(),
    name: (raw.name ?? '').trim(),
    quantity,
    unit: (raw.unit ?? 'piece').trim() || 'piece',
    costPrice: Number(raw.cost_price ?? 0),
    sellPrice: Number(raw.selling_price ?? 0),
    category: (raw.category ?? 'Uncategorized').trim() || 'Uncategorized',
    packUnit: raw.pack_unit ? raw.pack_unit.trim() : null,
    unitsPerPack: Number(raw.units_per_pack ?? 1) || 1,
    lowStockThreshold:
      raw.low_stock_threshold === undefined ? null : Number(raw.low_stock_threshold),
  }
}

export function rowStatus(
  row: DraftRow,
  products: Product[],
): { status: 'new' | 'restock' | 'invalid'; matchId: string | null; errors: string[] } {
  const errors: string[] = []
  if (!row.name) errors.push('name')
  if (!(row.costPrice > 0)) errors.push('cost')
  if (!(row.sellPrice > 0)) errors.push('sell')
  if (!(row.quantity > 0)) errors.push('quantity')
  if (errors.length > 0) return { status: 'invalid', matchId: null, errors }

  const m = matchProduct(row.name, products)
  if (m.product) return { status: 'restock', matchId: m.product.id, errors: [] }
  return { status: 'new', matchId: null, errors: [] }
}

// A row is "packed" when it describes a bigger unit holding >= 2 base units.
export function isPacked(row: DraftRow): boolean {
  return row.unitsPerPack >= 2 && !!row.packUnit
}

// Convert a row's entered values to base units. Packed rows: quantity is in packs
// and prices are per pack, so multiply qty and divide prices by units_per_pack.
export function toBase(
  row: DraftRow,
): { quantity: number; costPrice: number; sellPrice: number; unitsPerPack: number; packUnit: string | null } {
  const packed = isPacked(row)
  const f = packed ? row.unitsPerPack : 1
  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    quantity: row.quantity * f,
    costPrice: round2(row.costPrice / f),
    sellPrice: round2(row.sellPrice / f),
    unitsPerPack: packed ? row.unitsPerPack : 1,
    packUnit: packed ? row.packUnit : null,
  }
}
