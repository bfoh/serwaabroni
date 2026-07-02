import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Clock } from 'lucide-react'
import type { Product, StockBatch } from '@/lib/supabase'
import { formatCurrency, formatDate, formatTime } from '@/lib/data'
import { isMultiUnit, factorOf, splitStock } from '@/lib/units'

// Format a base-unit quantity in mixed pack/base units for pack goods.
function qtyLabel(baseQty: number, product: Product): string {
  const unit = product.unit || 'pc'
  if (!isMultiUnit(product)) return `${baseQty} ${unit}`
  const { packs, loose } = splitStock(baseQty, factorOf(product))
  const parts: string[] = []
  if (packs > 0) parts.push(`${packs} ${product.pack_unit}`)
  if (loose > 0 || packs === 0) parts.push(`${loose} ${unit}`)
  return `${parts.join(' ')} (${baseQty} ${unit})`
}

export default function StockHistorySheet({
  product,
  onClose,
}: {
  product: Product | null
  onClose: () => void
}) {
  const [batches, setBatches] = useState<StockBatch[] | null>(null)

  useEffect(() => {
    if (!product) return
    let cancelled = false
    setBatches(null)
    import('@/services/batchApi')
      .then(({ fetchBatchHistory }) => fetchBatchHistory(product.id))
      .then((b) => { if (!cancelled) setBatches(b) })
      .catch(() => { if (!cancelled) setBatches([]) })
    return () => { cancelled = true }
  }, [product])

  return (
    <AnimatePresence>
      {product && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-[61] shadow-sheet flex flex-col"
            style={{ maxHeight: '85dvh' }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink flex-shrink-0">
              <div className="min-w-0">
                <h2 className="font-display text-xl text-ink uppercase tracking-tight">Stock History</h2>
                <p className="text-xs text-muted-text truncate">{product.name}</p>
              </div>
              <button onClick={onClose} className="btn-tactile w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-sm bg-warm-gray">
                <X size={20} strokeWidth={2.5} className="text-ink" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
              {batches === null ? (
                <p className="text-sm text-muted-text text-center py-8">Loading…</p>
              ) : batches.length === 0 ? (
                <p className="text-sm text-muted-text text-center py-8">No stock intake records yet.</p>
              ) : (
                batches.map((b) => (
                  <div key={b.id} className="bg-light harsh-border rounded-sm p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-display text-base uppercase truncate">{qtyLabel(b.qty_purchased, product)}</p>
                      <p className="font-display text-base flex-shrink-0">{formatCurrency(b.total_cost)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1 text-xs text-muted-text">
                      <span className="flex items-center gap-1 truncate">
                        <Clock size={12} /> {formatDate(b.purchased_at)} · {formatTime(b.purchased_at)}
                      </span>
                      <span className="flex-shrink-0">{formatCurrency(b.unit_cost)}/{product.unit || 'pc'}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-text">
                      Remaining: {qtyLabel(b.qty_remaining, product)}{b.injection_id ? ' · funded by capital' : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
