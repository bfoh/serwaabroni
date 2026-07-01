import type { Product, Sale } from './supabase'

export type UnitKind = 'pack' | 'base'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function factorOf(p: Pick<Product, 'units_per_pack'>): number {
  const f = p.units_per_pack ?? 1
  return Number.isInteger(f) && f >= 1 ? f : 1
}

export function isMultiUnit(
  p: Pick<Product, 'pack_unit' | 'units_per_pack'>
): boolean {
  return !!p.pack_unit && factorOf(p) > 1
}

export function toBase(
  qty: number,
  kind: UnitKind,
  p: Pick<Product, 'units_per_pack'>
): number {
  return kind === 'pack' ? qty * factorOf(p) : qty
}

export function splitStock(
  baseQty: number,
  factor: number
): { packs: number; loose: number } {
  const f = Number.isInteger(factor) && factor >= 1 ? factor : 1
  const packs = Math.floor(baseQty / f)
  return { packs, loose: baseQty - packs * f }
}

export function priceFor(
  p: Pick<Product, 'selling_price' | 'units_per_pack'>,
  kind: UnitKind
): number {
  return kind === 'pack' ? round2(p.selling_price * factorOf(p)) : p.selling_price
}

export function costFor(
  p: Pick<Product, 'cost_price' | 'units_per_pack'>,
  kind: UnitKind
): number {
  return kind === 'pack' ? round2(p.cost_price * factorOf(p)) : p.cost_price
}

export function formatStock(
  p: Pick<Product, 'quantity' | 'unit' | 'pack_unit' | 'units_per_pack'>
): string {
  const baseUnit = p.unit || 'pc'
  if (!isMultiUnit(p)) return `${p.quantity} ${baseUnit}`
  const { packs, loose } = splitStock(p.quantity, factorOf(p))
  const parts: string[] = []
  if (packs > 0) parts.push(`${packs} ${p.pack_unit}`)
  if (loose > 0 || packs === 0) parts.push(`${loose} ${baseUnit}`)
  return `${parts.join(' ')} (${p.quantity} ${baseUnit})`
}

export function saleDisplay(
  s: Pick<Sale, 'quantity' | 'unit_price' | 'total' | 'sale_unit' | 'sale_unit_qty'>
): { qty: number; unitLabel: string | null; unitPrice: number; qtyLabel: string } {
  const qty = s.sale_unit_qty != null ? s.sale_unit_qty : s.quantity
  const unitLabel = s.sale_unit ?? null
  const unitPrice = qty > 0 ? round2(s.total / qty) : s.unit_price
  return { qty, unitLabel, unitPrice, qtyLabel: unitLabel ? `${qty} ${unitLabel}` : `${qty}` }
}
