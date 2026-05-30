import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Bell, ScanLine, TrendingUp, TrendingDown, Mic, Receipt, TrendingDown as ExpenseIcon } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatTime } from '@/lib/data'
import Odometer from '@/components/Odometer'
import ProductIcon from '@/components/ProductIcon'
import BarcodeScanner from '@/components/BarcodeScanner'
import ReceiptModal from '@/components/ReceiptModal'
import type { Sale } from '@/lib/supabase'

interface DashboardProps {
  onOpenSalesHistory: () => void
  onOpenExpenses: () => void
}

export default function Dashboard({ onOpenSalesHistory, onOpenExpenses }: DashboardProps) {
  const { state, t } = useStore()
  const [showScanner, setShowScanner] = useState(false)
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)

  const businessName = state.businessProfile?.business_name || "Maame Doku's Shop"
  const initials = businessName.split(' ').map((w) => w[0]).join('').substring(0, 2).toUpperCase()

  const recentSales = useMemo(() => state.sales.slice(0, 6), [state.sales])

  const lowStockItems = useMemo(
    () => state.products.filter((p) => p.quantity <= p.low_stock_threshold),
    [state.products]
  )

  return (
    <div className="min-h-screen bg-sand pb-20">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3 flex items-center justify-between">
        <div>
          <p className="text-micro text-muted-text">{businessName.toUpperCase()}</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-tactile relative w-10 h-10 flex items-center justify-center">
            <Bell size={20} strokeWidth={2} className="text-ink" />
            {lowStockItems.length > 0 && (
              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-accent-red rounded-full" />
            )}
          </button>
          <button
            onClick={onOpenSalesHistory}
            className="w-9 h-9 rounded-full bg-ink flex items-center justify-center"
          >
            <span className="font-display text-sm text-white">{initials}</span>
          </button>
        </div>
      </header>

      {/* Total Balance Hero */}
      <section className="px-5 pt-6 pb-4">
        <div className="text-center">
          <p className="text-micro text-muted-text mb-2">{t('total_cash')}</p>
          <Odometer value={state.balance} />
        </div>

        {/* Sub stats */}
        <div className="flex gap-3 mt-5">
          <div className="flex-1 bg-accent-green rounded-sm px-4 py-3 flex items-center gap-3">
            <TrendingUp size={18} strokeWidth={2.5} className="text-white/80" />
            <div>
              <p className="text-[10px] text-white/70 uppercase tracking-wider">{t('todays_sales')}</p>
              <p className="font-display text-lg text-white">{formatCurrency(state.todaySales)}</p>
            </div>
          </div>
          <div className="flex-1 bg-warm-gray rounded-sm px-4 py-3 flex items-center gap-3">
            <TrendingDown size={18} strokeWidth={2.5} className="text-ink/60" />
            <div>
              <p className="text-[10px] text-ink/50 uppercase tracking-wider">{t('pending_debts')}</p>
              <p className="font-display text-lg text-ink">{formatCurrency(state.pendingDebts)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Scan Action */}
      <section className="px-5 mb-5">
        <button
          onClick={() => setShowScanner(true)}
          className="btn-tactile w-full bg-ink rounded-sm px-5 py-4 flex items-center gap-4 active:bg-ink/80"
        >
          <ScanLine size={24} strokeWidth={2} className="text-white" />
          <span className="font-display text-base text-white uppercase tracking-wider">{t('scan_delivery')}</span>
        </button>
      </section>

      {/* Quick Actions */}
      <section className="px-5 mb-5 grid grid-cols-2 gap-3">
        <button
          onClick={onOpenSalesHistory}
          className="btn-tactile bg-warm-gray rounded-sm px-4 py-3 flex items-center gap-3"
        >
          <Receipt size={18} className="text-accent-green" />
          <span className="font-display text-xs text-ink uppercase tracking-wider">Sales History</span>
        </button>
        <button
          onClick={onOpenExpenses}
          className="btn-tactile bg-warm-gray rounded-sm px-4 py-3 flex items-center gap-3"
        >
          <ExpenseIcon size={18} className="text-accent-red" />
          <span className="font-display text-xs text-ink uppercase tracking-wider">Expenses</span>
        </button>
      </section>

      {/* Voice Search */}
      <section className="px-5 mb-5">
        <button className="btn-tactile w-full bg-warm-gray rounded-sm px-5 py-3 flex items-center gap-4">
          <Mic size={20} strokeWidth={2} className="text-accent-red" />
          <span className="font-display text-sm text-ink uppercase tracking-wider">{t('voice_input')}</span>
          <span className="text-[10px] text-muted-text ml-auto">{t('hold_to_speak')}</span>
        </button>
      </section>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <section className="px-5 mb-5">
          <div className="bg-accent-red/10 harsh-border border-accent-red rounded-sm p-4">
            <p className="text-micro text-accent-red mb-2">{t('low_stock_warning')}</p>
            <div className="space-y-2">
              {lowStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{item.name}</span>
                  <span className="text-xs text-accent-red font-display">{item.quantity} {t('left')}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Recent Sales Stream */}
      <section className="px-5 pb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl text-ink uppercase tracking-tight">{t('latest_sales')}</h2>
          <button onClick={onOpenSalesHistory} className="text-micro text-accent-red">{t('view_all')}</button>
        </div>

        <div className="space-y-2">
          {recentSales.length === 0 && (
            <div className="text-center py-10">
              <p className="text-muted-text text-sm">{t('no_sales_period')}</p>
              <p className="text-xs text-muted-text mt-1">Tap the + button to add your first sale</p>
            </div>
          )}
          {recentSales.map((sale, index) => (
            <motion.button
              key={sale.id}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05, duration: 0.25 }}
              onClick={() => { setReceiptSale(sale); setShowReceipt(true) }}
              className="w-full bg-light harsh-border rounded-sm px-4 py-3 flex items-center gap-3 text-left"
            >
              <div className="w-10 h-10 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
                <ProductIcon
                  category={state.products.find((p) => p.id === sale.product_id)?.category || 'default'}
                  size={24}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{sale.product_name}</p>
                <p className="text-xs text-muted-text">{formatTime(sale.created_at)}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-display text-base text-accent-green">+{formatCurrency(sale.total)}</p>
                {sale.quantity > 1 && (
                  <p className="text-[10px] text-muted-text">{sale.quantity} x {formatCurrency(sale.unit_price)}</p>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </section>

      {/* Barcode Scanner Modal */}
      <BarcodeScanner isOpen={showScanner} onClose={() => setShowScanner(false)} />

      {/* Receipt Modal */}
      <ReceiptModal
        sale={receiptSale}
        isOpen={showReceipt}
        onClose={() => setShowReceipt(false)}
      />
    </div>
  )
}
