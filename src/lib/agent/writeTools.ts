import type { Product } from '@/lib/supabase'
import { formatCurrency } from '@/lib/data'
import { matchProduct } from './match'
import type { ToolCall, ConfirmPreview, SaleItemResolved } from './types'

export interface PreviewContext {
  products: Product[]
}

interface RawItem {
  product: string
  qty: number
  unit?: string
}

function resolveItems(
  raw: RawItem[],
  products: Product[],
): { items: SaleItemResolved[] } | { error: string } {
  const items: SaleItemResolved[] = []
  for (const r of raw) {
    const qty = Number(r.qty)
    if (!qty || qty <= 0) return { error: `How many ${r.product} did you mean?` }
    const m = matchProduct(String(r.product ?? ''), products)
    if (m.ambiguous) {
      return { error: `Did you mean ${m.candidates.map((c) => c.name).join(' or ')}?` }
    }
    if (!m.product) return { error: `I couldn't find "${r.product}" in your stock. Please say the name again.` }
    const p = m.product
    // If the buyer named the bigger (pack) unit, sell in packs: base quantity is
    // qty × units_per_pack; the price stays per base unit.
    const reqUnit = String(r.unit ?? '').trim().toLowerCase()
    const packed = p.units_per_pack >= 2 && !!p.pack_unit && reqUnit === p.pack_unit.trim().toLowerCase()
    const factor = packed ? p.units_per_pack : 1
    items.push({
      productId: p.id,
      productName: p.name,
      unitPrice: p.selling_price,
      unitCost: p.cost_price,
      qty: qty * factor,
      saleUnit: packed ? p.pack_unit : null,
      saleUnitQty: packed ? qty : null,
    })
  }
  if (items.length === 0) return { error: 'Which item did you sell?' }
  return { items }
}

function saleLines(items: SaleItemResolved[]): { lines: { label: string; value: string }[]; total: number } {
  const lines = items.map((i) => ({
    label: i.saleUnit && i.saleUnitQty ? `${i.productName} ×${i.saleUnitQty} ${i.saleUnit}` : `${i.productName} ×${i.qty}`,
    value: formatCurrency(i.unitPrice * i.qty),
  }))
  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
  lines.push({ label: 'Total', value: formatCurrency(total) })
  return { lines, total }
}

export function buildPreview(call: ToolCall, ctx: PreviewContext): ConfirmPreview | { error: string } {
  const input = call.input as Record<string, unknown>

  if (call.name === 'add_sale' || call.name === 'add_credit_sale') {
    const raw = (input.items as RawItem[]) ?? []
    const resolved = resolveItems(raw, ctx.products)
    if ('error' in resolved) return resolved
    const { lines } = saleLines(resolved.items)

    if (call.name === 'add_sale') {
      const payment = input.payment === 'bank' ? 'bank' : 'cash'
      return {
        kind: 'sale',
        title: 'Confirm sale',
        lines: [...lines, { label: 'Payment', value: payment === 'bank' ? 'Bank/MoMo' : 'Cash' }],
        warnings: [],
        sale: { items: resolved.items, payment },
      }
    }

    const customerName = String(input.customer_name ?? '').trim()
    if (!customerName) return { error: 'Who is buying on credit? Please say the customer name.' }
    return {
      kind: 'credit_sale',
      title: 'Confirm credit sale',
      lines: [...lines, { label: 'Customer', value: customerName }],
      warnings: ['Recorded as money owed to you.'],
      credit: {
        items: resolved.items,
        customerName,
        dueDate: input.due_date ? String(input.due_date) : null,
      },
    }
  }

  if (call.name === 'new_product') {
    const name = String(input.name ?? '').trim()
    const costPrice = Number(input.cost_price)
    const sellPrice = Number(input.sell_price)
    const qty = Number(input.qty)
    if (!name) return { error: 'What is the product name?' }
    if (!costPrice || costPrice <= 0) return { error: `What did you buy ${name} for (cost price)?` }
    if (!sellPrice || sellPrice <= 0) return { error: `What price will you sell ${name}?` }
    if (qty === undefined || Number.isNaN(qty) || qty < 0) return { error: `How many ${name} did you buy?` }
    const payment =
      input.payment === 'bank' ? 'bank' : input.payment === 'supplier_credit' ? 'supplier_credit' : 'cash'
    const category = String(input.category ?? 'Uncategorized')
    return {
      kind: 'new_product',
      title: 'Confirm new product',
      lines: [
        { label: 'Name', value: name },
        { label: 'Cost price', value: formatCurrency(costPrice) },
        { label: 'Selling price', value: formatCurrency(sellPrice) },
        { label: 'Quantity', value: String(qty) },
        { label: 'Paid with', value: payment === 'supplier_credit' ? 'Supplier credit' : payment === 'bank' ? 'Bank/MoMo' : 'Cash' },
      ],
      warnings: [],
      newProduct: { name, costPrice, sellPrice, qty, category, payment },
    }
  }

  if (call.name === 'add_stock') {
    const m = matchProduct(String(input.product ?? ''), ctx.products)
    if (m.ambiguous) return { error: `Did you mean ${m.candidates.map((c) => c.name).join(' or ')}?` }
    if (!m.product) return { error: `I couldn't find "${input.product}" in your stock.` }
    const qty = Number(input.qty)
    if (!qty || qty <= 0) return { error: `How many ${m.product.name} did you add?` }
    const unitCost = input.cost_price !== undefined ? Number(input.cost_price) : m.product.cost_price
    return {
      kind: 'add_stock',
      title: 'Confirm restock',
      lines: [
        { label: 'Product', value: m.product.name },
        { label: 'Add quantity', value: String(qty) },
        { label: 'Unit cost', value: formatCurrency(unitCost) },
        { label: 'New total', value: String(m.product.quantity + qty) },
      ],
      warnings: [],
      addStock: { productId: m.product.id, productName: m.product.name, qty, unitCost },
    }
  }

  return { error: 'Unknown action.' }
}
