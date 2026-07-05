import { Trash2 } from 'lucide-react'
import type { Product } from '@/lib/supabase'
import { formatCurrency } from '@/lib/data'
import { saleRowStatus, isPackedSale, toBaseSale, PAYMENTS, type SaleDraftRow } from '@/lib/bulkSales/rows'

const toDateInput = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export default function BulkSalesReviewTable({
  rows, products, onChange, onImport, importing,
}: {
  rows: SaleDraftRow[]
  products: Product[]
  onChange: (rows: SaleDraftRow[]) => void
  onImport: () => void
  importing: boolean
}) {
  const set = (id: string, patch: Partial<SaleDraftRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id))

  const statuses = rows.map((r) => saleRowStatus(r, products))
  const blocked = statuses.some((s) => s.status !== 'ready')
  const readyCount = statuses.filter((s) => s.status === 'ready').length

  const pill = (s: 'ready' | 'unmatched' | 'invalid') =>
    s === 'ready' ? 'bg-accent-green text-white' : s === 'unmatched' ? 'bg-warm-gray text-ink' : 'bg-accent-red text-white'
  const label = (s: 'ready' | 'unmatched' | 'invalid') => (s === 'ready' ? 'Ready' : s === 'unmatched' ? 'Match?' : 'Fix')

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <div className="min-w-[840px] space-y-2">
          {rows.map((r, i) => {
            const s = statuses[i]
            const product = r.productId ? products.find((p) => p.id === r.productId) : undefined
            const packed = product ? isPackedSale(r, product) : false
            // Default price shown for the CHOSEN unit: per pack when a pack unit is selected.
            const defaultPrice = product
              ? packed
                ? Math.round(product.selling_price * product.units_per_pack * 100) / 100
                : product.selling_price
              : null
            return (
              <div key={r.id} className="space-y-0.5">
                <div className="flex items-center gap-2 text-xs">
                  <select
                    value={r.productId ?? ''}
                    onChange={(e) => {
                      const id = e.target.value || null
                      const p = id ? products.find((x) => x.id === id) : undefined
                      set(r.id, { productId: id, unit: p ? p.unit : r.unit })
                    }}
                    className={`flex-1 min-w-0 harsh-border rounded-sm px-1 py-1.5 border ${r.productId ? 'border-ink/20' : 'border-accent-red'}`}
                  >
                    <option value="">— pick product{r.product ? ` (“${r.product}”)` : ''} —</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="number" inputMode="decimal" value={r.quantity || ''}
                    onChange={(e) => set(r.id, { quantity: Number(e.target.value) })} placeholder="Qty"
                    className={`w-14 harsh-border rounded-sm px-2 py-1.5 border ${s.errors.includes('quantity') ? 'border-accent-red' : 'border-ink/20'}`} />
                  {product ? (
                    <select value={r.unit}
                      onChange={(e) => {
                        const newUnit = e.target.value
                        const willPack = product.units_per_pack >= 2 && !!product.pack_unit &&
                          newUnit.toLowerCase() === product.pack_unit.toLowerCase()
                        let unitPrice = r.unitPrice
                        // Convert an entered price to the new unit basis (per pack ↔ per base).
                        if (unitPrice !== null && willPack !== packed) {
                          const f = product.units_per_pack
                          unitPrice = Math.round((willPack ? unitPrice * f : unitPrice / f) * 100) / 100
                        }
                        set(r.id, { unit: newUnit, unitPrice })
                      }}
                      title="Choose the unit sold (small unit or pack)"
                      className="w-20 harsh-border rounded-sm px-1 py-1.5 border border-ink/20">
                      {(product.units_per_pack >= 2 && product.pack_unit
                        ? [product.unit, product.pack_unit]
                        : [product.unit]
                      ).map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  ) : (
                    <input value={r.unit} onChange={(e) => set(r.id, { unit: e.target.value })} placeholder="Unit"
                      className="w-20 harsh-border rounded-sm px-2 py-1.5 border border-ink/20" />
                  )}
                  <input type="number" inputMode="decimal" value={r.unitPrice ?? ''}
                    onChange={(e) => set(r.id, { unitPrice: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder={defaultPrice !== null ? String(defaultPrice) : 'Price'}
                    className={`w-20 harsh-border rounded-sm px-2 py-1.5 border ${s.errors.includes('price') ? 'border-accent-red' : 'border-ink/20'}`} />
                  <select value={r.payment} onChange={(e) => set(r.id, { payment: e.target.value as SaleDraftRow['payment'] })}
                    className="w-20 harsh-border rounded-sm px-1 py-1.5 border border-ink/20">
                    {PAYMENTS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {r.payment === 'credit' && (
                    <input value={r.customer} onChange={(e) => set(r.id, { customer: e.target.value })} placeholder="Customer"
                      className={`w-24 harsh-border rounded-sm px-2 py-1.5 border ${s.errors.includes('customer') ? 'border-accent-red' : 'border-ink/20'}`} />
                  )}
                  <input type="date" value={toDateInput(r.date)}
                    onChange={(e) => set(r.id, { date: e.target.value ? new Date(e.target.value).toISOString() : r.date })}
                    className="w-32 harsh-border rounded-sm px-2 py-1.5 border border-ink/20" />
                  <span className={`shrink-0 px-2 py-1 rounded-sm text-[10px] uppercase ${pill(s.status)}`}>{label(s.status)}</span>
                  <button onClick={() => remove(r.id)} aria-label="Remove row" className="shrink-0 text-muted-text hover:text-accent-red">
                    <Trash2 size={14} />
                  </button>
                </div>
                {product && isPackedSale(r, product) && (
                  <p className="text-[10px] text-muted-text pl-1">
                    {r.quantity} {r.unit} × {product.units_per_pack} = {toBaseSale(r, product).quantity} {product.unit} · {formatCurrency(toBaseSale(r, product).unitPrice)}/{product.unit}
                  </p>
                )}
                {s.warnings.includes('stock') && (
                  <p className="text-[10px] text-accent-red pl-1">More than current stock — allowed, but stock will floor at 0.</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-ink/10 pt-3">
        <span className="text-xs text-muted-text">{readyCount} ready of {rows.length}</span>
        <button onClick={onImport} disabled={importing || rows.length === 0 || blocked}
          className="btn-tactile bg-ink text-white text-sm uppercase tracking-wide px-5 py-2.5 rounded-sm disabled:opacity-50">
          {importing ? 'Recording…' : `Record ${rows.length}`}
        </button>
      </div>
    </div>
  )
}
