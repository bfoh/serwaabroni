import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { Bell, ScanLine, TrendingUp, TrendingDown, Mic, Receipt, TrendingDown as ExpenseIcon, User } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatTime, formatDate, groupSales, type SaleGroup } from '@/lib/data'
import Odometer from '@/components/Odometer'
import ProductIcon from '@/components/ProductIcon'
import BarcodeScanner from '@/components/BarcodeScanner'
import ReceiptModal from '@/components/ReceiptModal'
import NotificationsSheet from '@/components/NotificationsSheet'
import CapitalSummaryCard from '@/components/CapitalSummaryCard'
import type { Sale } from '@/lib/supabase'

interface DashboardProps {
  onOpenSalesHistory: () => void
  onOpenExpenses: () => void
  onOpenCustomers: () => void
}

export default function Dashboard({ onOpenSalesHistory, onOpenExpenses, onOpenCustomers }: DashboardProps) {
  const { state, t, setTab } = useStore()
  const navigate = useNavigate()
  const [showScanner, setShowScanner] = useState(false)
  const [receiptSales, setReceiptSales] = useState<Sale[]>([])
  const [showReceipt, setShowReceipt] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)

  const businessName = state.businessProfile?.business_name || state.user?.business_name || "Maame Doku's Shop"
  const initials = businessName.split(' ').map((w) => w[0]).join('').substring(0, 2).toUpperCase()

  const recentGroups = useMemo(() => groupSales(state.sales).slice(0, 6), [state.sales])

  return (
    <div className="min-h-screen bg-sand pb-20">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3 pt-safe flex items-center justify-between">
        <div>
          <p className="text-micro text-muted-text">{businessName.toUpperCase()}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowNotifications(true)} className="btn-tactile relative w-10 h-10 flex items-center justify-center">
            <Bell size={20} strokeWidth={2} className="text-ink" />
            {state.alerts?.length > 0 && (
              <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-accent-red rounded-full border-2 border-sand" />
            )}
          </button>
          <button
            onClick={onOpenSalesHistory}
            className="w-9 h-9 rounded-full bg-ink flex items-center justify-center overflow-hidden"
          >
            {state.user?.logo || state.businessProfile?.logo_url ? (
              <img src={state.user?.logo || state.businessProfile?.logo_url || ''} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <span className="font-display text-sm text-white">{initials}</span>
            )}
          </button>
        </div>
      </header>

      {/* Total Balance Hero */}
      <section className="px-5 pt-6 pb-4">
        <div className="text-center">
          <p className="text-micro text-muted-text mb-2">{t('total_cash')}</p>
          <Odometer value={state.balance} />
          <button
            onClick={() => navigate('/cash')}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-text active:opacity-60"
          >
            <span className="font-display text-ink">{formatCurrency(state.bankBalance)}</span> in bank →
          </button>
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
      <section className="px-5 mb-5 grid grid-cols-3 gap-3">
        <button
          onClick={onOpenSalesHistory}
          className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2"
        >
          <Receipt size={24} className="text-accent-green" />
          <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Sales<br/>History</span>
        </button>
        <button
          onClick={onOpenExpenses}
          className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2"
        >
          <ExpenseIcon size={24} className="text-accent-red" />
          <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Expenses</span>
        </button>
        <button
          onClick={onOpenCustomers}
          className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Customers</span>
        </button>
        <CapitalSummaryCard />
      </section>

      {/* Voice Search */}
      <section className="px-5 mb-5">
        <button className="btn-tactile w-full bg-warm-gray rounded-sm px-5 py-3 flex items-center gap-4">
          <Mic size={20} strokeWidth={2} className="text-accent-red" />
          <span className="font-display text-sm text-ink uppercase tracking-wider">{t('voice_input')}</span>
          <span className="text-[10px] text-muted-text ml-auto">{t('hold_to_speak')}</span>
        </button>
      </section>

      {/* Action Required Section (Top Alerts) */}
      {(state.alerts || []).length > 0 && (
        <section className="px-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-base text-accent-red uppercase tracking-tight flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent-red animate-pulse" /> Action Required
            </h2>
          </div>
          <div className="space-y-3">
            {(state.alerts || []).slice(0, 2).map((alert) => (
              <div key={alert.id} className="bg-light harsh-border rounded-sm p-4 border-l-4 border-l-accent-red">
                <h3 className="font-display text-sm text-ink uppercase">{alert.title}</h3>
                <p className="text-xs text-ink/80 mt-1">{alert.message}</p>
                {alert.actionLabel && (
                  <button
                    onClick={() => {
                      if (alert.actionPhone) window.location.href = `tel:${alert.actionPhone}`
                      else if (alert.actionLink) setTab(alert.actionLink as any)
                    }}
                    className="mt-3 text-xs font-display uppercase tracking-wider text-ink bg-warm-gray px-3 py-1.5 rounded-sm inline-flex items-center gap-2 hover:bg-ink hover:text-white transition-colors"
                  >
                    {alert.actionLabel}
                  </button>
                )}
              </div>
            ))}
            {(state.alerts || []).length > 2 && (
              <button 
                onClick={() => setShowNotifications(true)}
                className="w-full text-center text-[10px] uppercase font-display text-muted-text mt-2 hover:text-ink"
              >
                View {(state.alerts || []).length - 2} more alerts
              </button>
            )}
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
          {recentGroups.length === 0 && (
            <div className="text-center py-10">
              <p className="text-muted-text text-sm">{t('no_sales_period')}</p>
              <p className="text-xs text-muted-text mt-1">Tap the + button to add your first sale</p>
            </div>
          )}
          {recentGroups.map((group: SaleGroup, index) => {
            const head = group.sales[0]
            const lineCount = group.sales.length
            const title = lineCount > 1 ? `${head.product_name} +${lineCount - 1} more` : head.product_name
            return (
              <motion.button
                key={group.key}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05, duration: 0.25 }}
                onClick={() => { setReceiptSales(group.sales); setShowReceipt(true) }}
                className="w-full bg-light harsh-border rounded-sm px-4 py-3 flex items-center gap-3 text-left"
              >
                <div className="w-10 h-10 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
                  <ProductIcon
                    category={state.products.find((p) => p.id === head.product_id)?.category || 'default'}
                    size={24}
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
                  <p className="font-display text-base text-accent-green">+{formatCurrency(group.total)}</p>
                  {lineCount > 1 ? (
                    <p className="text-[10px] text-muted-text">{group.itemCount} items</p>
                  ) : (
                    head.quantity > 1 && (
                      <p className="text-[10px] text-muted-text">{head.quantity} x {formatCurrency(head.unit_price)}</p>
                    )
                  )}
                </div>
              </motion.button>
            )
          })}
        </div>
      </section>

      {/* Barcode Scanner Modal */}
      <BarcodeScanner isOpen={showScanner} onClose={() => setShowScanner(false)} />

      {/* Receipt Modal */}
      <ReceiptModal
        sales={receiptSales}
        isOpen={showReceipt}
        onClose={() => setShowReceipt(false)}
      />
      {/* Notifications Overlay */}
      {showNotifications && (
        <div className="absolute inset-0 z-[60] bg-sand">
          <NotificationsSheet onClose={() => setShowNotifications(false)} />
        </div>
      )}
    </div>
  )
}
