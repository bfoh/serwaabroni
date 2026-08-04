import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Product } from '@/lib/supabase'
import { formatCurrency } from '@/lib/data'
import { rowStatus, isPacked, toBase, UNITS, type DraftRow } from '@/lib/bulkImport/rows'

export default function BulkReviewTable({
  rows, products, categories, onChange, onImport, importing,
}: {
  rows: DraftRow[]
  products: Product[]
  categories: string[]
  onChange: (rows: DraftRow[]) => void
  onImport: () => void
  importing: boolean
}) {
  const set = (id: string, patch: Partial<DraftRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id))

  // Raw text for the "/pack" field so mid-typing digits (e.g. the "1" in "10")
  // aren't wiped by the numeric model.
  const [packText, setPackText] = useState<Record<string, string>>({})

  const statuses = rows.map((r) => rowStatus(r, products))
  const anyInvalid = statuses.some((s) => s.status === 'invalid')
  const newCount = statuses.filter((s) => s.status === 'new').length
  const restockCount = statuses.filter((s) => s.status === 'restock').length

  const pill = (s: 'new' | 'restock' | 'invalid') =>
    s === 'invalid' ? 'bg-accent-red text-white'
      : s === 'restock' ? 'bg-warm-gray text-ink'
      : 'bg-accent-green text-white'
  const label = (s: 'new' | 'restock' | 'invalid') => (s === 'invalid' ? 'Fix' : s === 'restock' ? 'Restock' : 'New')

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <div className="min-w-[820px] space-y-2">
          {rows.map((r, i) => {
            const s = statuses[i]
            const err = (k: string) => s.errors.includes(k) ? 'border-accent-red' : 'border-ink/20'
            const packed = isPacked(r)
            const base = toBase(r)
            return (
              <div key={r.id} className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs">
                <input
                  value={r.name}
                  onChange={(e) => set(r.id, { name: e.target.value })}
                  placeholder="Name"
                  className={`flex-1 min-w-0 harsh-border rounded-sm px-2 py-1.5 border ${err('name')}`}
                />
                <input
                  type="number" inputMode="decimal" value={r.quantity || ''}
                  onChange={(e) => set(r.id, { quantity: Number(e.target.value) })}
                  placeholder="Qty"
                  className={`w-16 harsh-border rounded-sm px-2 py-1.5 border ${err('quantity')}`}
                />
                <select
                  value={r.unit} onChange={(e) => set(r.id, { unit: e.target.value })}
                  className="w-20 harsh-border rounded-sm px-1 py-1.5 border border-ink/20"
                >
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <input
                  type="number" inputMode="decimal" value={r.costPrice || ''}
                  onChange={(e) => set(r.id, { costPrice: Number(e.target.value) })}
                  placeholder="Cost"
                  className={`w-20 harsh-border rounded-sm px-2 py-1.5 border ${err('cost')}`}
                />
                <input
                  type="number" inputMode="decimal" value={r.sellPrice || ''}
                  onChange={(e) => set(r.id, { sellPrice: Number(e.target.value) })}
                  placeholder="Sell"
                  className={`w-20 harsh-border rounded-sm px-2 py-1.5 border ${err('sell')}`}
                />
                <select
                  value={r.category} onChange={(e) => set(r.id, { category: e.target.value })}
                  className="w-28 harsh-border rounded-sm px-1 py-1.5 border border-ink/20"
                >
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  value={r.packUnit ?? ''}
                  onChange={(e) => set(r.id, { packUnit: e.target.value.trim() || null })}
                  placeholder="Pack" title="Bigger unit, e.g. box (leave blank for loose items)"
                  className="w-16 harsh-border rounded-sm px-2 py-1.5 border border-ink/20"
                />
                <input
                  type="number" inputMode="numeric"
                  value={packText[r.id] ?? (r.unitsPerPack > 1 ? String(r.unitsPerPack) : '')}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, '')
                    setPackText((d) => ({ ...d, [r.id]: raw }))
                    set(r.id, { unitsPerPack: raw === '' ? 1 : Math.max(1, parseInt(raw, 10) || 1) })
                  }}
                  placeholder="/pack" title="How many small units per pack, e.g. 40"
                  className="w-16 harsh-border rounded-sm px-2 py-1.5 border border-ink/20"
                />
                <span className={`shrink-0 px-2 py-1 rounded-sm text-[10px] uppercase ${pill(s.status)}`}>{label(s.status)}</span>
                <button onClick={() => remove(r.id)} aria-label="Remove row" className="shrink-0 text-muted-text hover:text-accent-red">
                  <Trash2 size={14} />
                </button>
              </div>
              {packed && (
                <p className="text-[10px] text-muted-text pl-1">
                  {r.quantity} {r.packUnit} × {r.unitsPerPack} = {base.quantity} {r.unit} · {formatCurrency(base.costPrice)}/{r.unit} cost · {formatCurrency(base.sellPrice)}/{r.unit} sell
                </p>
              )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-ink/10 pt-3">
        <span className="text-xs text-muted-text">{newCount} new · {restockCount} restock</span>
        <button
          onClick={onImport}
          disabled={importing || rows.length === 0 || anyInvalid}
          className="btn-tactile bg-ink text-white text-sm uppercase tracking-wide px-5 py-2.5 rounded-sm disabled:opacity-50"
        >
          {importing ? 'Importing…' : `Import ${rows.length}`}
        </button>
      </div>
    </div>
  )
}
