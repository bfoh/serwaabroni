import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { X, Search, Receipt, User, Trash2, AlertTriangle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatTime, formatDate, groupSales, type SaleGroup } from '@/lib/data'
import ProductIcon from '@/components/ProductIcon'
import ReceiptModal from '@/components/ReceiptModal'
import type { Sale } from '@/lib/supabase'

interface SalesHistoryProps {
  isOpen: boolean
  onClose: () => void
}

export default function SalesHistory({ isOpen, onClose }: SalesHistoryProps) {
  const { state, deleteSale } = useStore()
  const [search, setSearch] = useState('')
  const [selectedSales, setSelectedSales] = useState<Sale[]>([])
  const [showReceipt, setShowReceipt] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SaleGroup | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'today' | 'week' | 'month' | 'year'>('all')

  const filteredSales = useMemo(() => {
    let sales = state.sales

    // Period filter
    const now = new Date()
    if (filterPeriod === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      sales = sales.filter((s) => new Date(s.created_at) >= start)
    } else if (filterPeriod === 'week') {
      const start = new Date(now)
      start.setDate(start.getDate() - 7)
      sales = sales.filter((s) => new Date(s.created_at) >= start)
    } else if (filterPeriod === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      sales = sales.filter((s) => new Date(s.created_at) >= start)
    } else if (filterPeriod === 'year') {
      const start = new Date(now.getFullYear(), 0, 1)
      sales = sales.filter((s) => new Date(s.created_at) >= start)
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase()
      sales = sales.filter(
        (s) =>
          s.product_name.toLowerCase().includes(q) ||
          (s.customer_name || '').toLowerCase().includes(q) ||
          (s.payment_method || '').toLowerCase().includes(q)
      )
    }

    return sales
  }, [state.sales, search, filterPeriod])

  const filteredGroups = useMemo(() => groupSales(filteredSales), [filteredSales])

  const summary = useMemo(() => {
    const total = filteredSales.reduce((s, sale) => s + sale.total, 0)
    const profit = filteredSales.reduce((s, sale) => s + (sale.profit || 0), 0)
    const count = filteredGroups.length
    return { total, profit, count }
  }, [filteredSales, filteredGroups])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-sand flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-sand border-b-2 border-ink px-5 py-3 pt-safe flex items-center justify-between flex-shrink-0">
        <h1 className="font-display text-xl text-ink uppercase tracking-tight">Sales History</h1>
        <button onClick={onClose} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
          <X size={20} strokeWidth={2.5} className="text-ink" />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="px-5 pt-4 pb-2 flex gap-2 flex-shrink-0">
        <div className="flex-1 bg-ink rounded-sm px-3 py-2.5">
          <p className="text-[9px] text-white/50 uppercase">Sales</p>
          <p className="font-display text-lg text-white">{summary.count}</p>
        </div>
        <div className="flex-1 bg-accent-green rounded-sm px-3 py-2.5">
          <p className="text-[9px] text-white/50 uppercase">Revenue</p>
          <p className="font-display text-lg text-white">{formatCurrency(summary.total)}</p>
        </div>
        <div className="flex-1 bg-warm-gray rounded-sm px-3 py-2.5">
          <p className="text-[9px] text-ink/50 uppercase">Profit</p>
          <p className="font-display text-lg text-ink">{formatCurrency(summary.profit)}</p>
        </div>
      </div>

      {/* Period Filters */}
      <div className="px-5 pb-2 flex gap-1.5 flex-shrink-0">
        {(['all', 'today', 'week', 'month', 'year'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setFilterPeriod(p)}
            className={`flex-1 py-2 text-[10px] font-display uppercase tracking-wider rounded-sm border-2 transition-colors ${
              filterPeriod === p ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-5 pb-3 flex-shrink-0">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, customer..."
            className="w-full h-10 pl-10 pr-4 bg-light harsh-border rounded-sm text-base font-body"
          />
        </div>
      </div>

      {/* Sales List */}
      <div className="flex-1 overflow-y-auto px-5 pb-sheet space-y-2">
        {filteredGroups.length === 0 && (
          <div className="text-center py-16">
            <Receipt size={40} strokeWidth={1} className="text-ink/20 mx-auto mb-3" />
            <p className="text-muted-text text-sm">No sales found</p>
            <p className="text-xs text-muted-text mt-1">Try a different filter or search term</p>
          </div>
        )}

        {filteredGroups.map((group: SaleGroup, i) => {
          const head = group.sales[0]
          const lineCount = group.sales.length
          const title = lineCount > 1 ? `${head.product_name} +${lineCount - 1} more` : head.product_name
          return (
            <motion.div
              key={group.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="w-full bg-light harsh-border rounded-sm flex items-center gap-2 pr-2"
            >
              <button
                onClick={() => { setSelectedSales(group.sales); setShowReceipt(true) }}
                className="flex-1 min-w-0 p-3 flex items-center gap-3 text-left"
              >
                <div className="w-10 h-10 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
                  <ProductIcon
                    category={state.products.find((p) => p.id === head.product_id)?.category || 'default'}
                    size={22}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-text">{formatDate(group.created_at)} {formatTime(group.created_at)}</span>
                    {group.customer_name && (
                      <span className="text-[10px] text-accent-green flex items-center gap-0.5">
                        <User size={8} /> {group.customer_name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-display text-sm text-ink">{formatCurrency(group.total)}</p>
                  {lineCount > 1 ? (
                    <p className="text-[9px] text-muted-text">{group.itemCount} items</p>
                  ) : (
                    <p className="text-[9px] text-muted-text">{head.quantity} x {formatCurrency(head.unit_price)}</p>
                  )}
                </div>
              </button>
              <button
                onClick={() => setConfirmDelete(group)}
                aria-label="Delete sale"
                className="btn-tactile w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-sm"
              >
                <Trash2 size={18} className="text-accent-red" />
              </button>
            </motion.div>
          )
        })}
      </div>

      {/* Receipt Modal */}
      {confirmDelete && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[60]" onClick={() => !deleting && setConfirmDelete(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[85vw] max-w-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-accent-red" />
              <h3 className="font-display text-lg text-ink uppercase tracking-tight">Delete sale?</h3>
            </div>
            <p className="text-sm text-muted-text mb-1">
              {confirmDelete.sales[0].product_name}
              {confirmDelete.sales.length > 1 ? ` +${confirmDelete.sales.length - 1} more` : ''} · {formatCurrency(confirmDelete.total)}
            </p>
            <p className="text-xs text-muted-text mb-5">Stock will be restored. This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="flex-1 h-12 bg-warm-gray rounded-sm font-display text-sm text-ink uppercase tracking-wider disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setDeleting(true)
                  try { await deleteSale(confirmDelete) } finally { setDeleting(false); setConfirmDelete(null) }
                }}
                disabled={deleting}
                className="flex-1 h-12 bg-accent-red rounded-sm font-display text-sm text-white uppercase tracking-wider disabled:opacity-50"
              >
                {deleting ? '...' : 'Delete'}
              </button>
            </div>
          </div>
        </>
      )}

      <ReceiptModal
        sales={selectedSales}
        isOpen={showReceipt}
        onClose={() => setShowReceipt(false)}
      />
    </div>
  )
}
