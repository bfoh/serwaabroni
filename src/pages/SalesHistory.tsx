import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { X, Search, Receipt, User } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatTime } from '@/lib/data'
import ProductIcon from '@/components/ProductIcon'
import ReceiptModal from '@/components/ReceiptModal'
import type { Sale } from '@/lib/supabase'

interface SalesHistoryProps {
  isOpen: boolean
  onClose: () => void
}

export default function SalesHistory({ isOpen, onClose }: SalesHistoryProps) {
  const { state } = useStore()
  const [search, setSearch] = useState('')
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all')

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

  const summary = useMemo(() => {
    const total = filteredSales.reduce((s, sale) => s + sale.total, 0)
    const profit = filteredSales.reduce((s, sale) => s + (sale.profit || 0), 0)
    const count = filteredSales.length
    return { total, profit, count }
  }, [filteredSales])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[90] bg-sand flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-sand border-b-2 border-ink px-5 py-3 flex items-center justify-between flex-shrink-0">
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
        {(['all', 'today', 'week', 'month'] as const).map((p) => (
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
            className="w-full h-10 pl-10 pr-4 bg-light harsh-border rounded-sm text-sm font-body"
          />
        </div>
      </div>

      {/* Sales List */}
      <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-2">
        {filteredSales.length === 0 && (
          <div className="text-center py-16">
            <Receipt size={40} strokeWidth={1} className="text-ink/20 mx-auto mb-3" />
            <p className="text-muted-text text-sm">No sales found</p>
            <p className="text-xs text-muted-text mt-1">Try a different filter or search term</p>
          </div>
        )}

        {filteredSales.map((sale, i) => (
          <motion.button
            key={sale.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            onClick={() => { setSelectedSale(sale); setShowReceipt(true) }}
            className="w-full bg-light harsh-border rounded-sm p-3 flex items-center gap-3 text-left"
          >
            <div className="w-10 h-10 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
              <ProductIcon
                category={state.products.find((p) => p.id === sale.product_id)?.category || 'default'}
                size={22}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{sale.product_name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-text">{formatTime(sale.created_at)}</span>
                {sale.customer_name && (
                  <span className="text-[10px] text-accent-green flex items-center gap-0.5">
                    <User size={8} /> {sale.customer_name}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="font-display text-sm text-ink">{formatCurrency(sale.total)}</p>
              <p className="text-[9px] text-muted-text">{sale.quantity} x {formatCurrency(sale.unit_price)}</p>
            </div>
          </motion.button>
        ))}
      </div>

      {/* Receipt Modal */}
      <ReceiptModal
        sale={selectedSale}
        isOpen={showReceipt}
        onClose={() => setShowReceipt(false)}
      />
    </div>
  )
}
