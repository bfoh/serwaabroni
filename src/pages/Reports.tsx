import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, DollarSign, CalendarDays, BarChart3, Package } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, getProfitForPeriod } from '@/lib/data'
import MazeShader from '@/components/MazeShader'
import ProductIcon from '@/components/ProductIcon'

type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

const periodLabels: Record<ReportPeriod, string> = {
  daily: 'TODAY',
  weekly: 'WEEK',
  monthly: 'MONTH',
  yearly: 'YEAR',
}

export default function Reports() {
  const { state, t } = useStore()
  const [period, setPeriod] = useState<ReportPeriod>('daily')

  const periodDays = {
    daily: 1,
    weekly: 7,
    monthly: 30,
    yearly: 365,
  }

  const cutoff = new Date(Date.now() - periodDays[period] * 86400000).toISOString()

  // Main stats
  const salesTotal = state.sales.filter((s) => s.created_at >= cutoff).reduce((sum, s) => sum + s.total, 0)
  const profitTotal = getProfitForPeriod(state.sales, periodDays[period])
  const expensesTotal = state.expenses.filter((e) => e.created_at >= cutoff).reduce((sum, e) => sum + e.amount, 0)
  const netTotal = profitTotal - expensesTotal

  // All debts (not filtered by period — same as v14)
  const allDebts = state.debts
  const totalOwed = allDebts.filter((d) => d.type === 'owed' && !d.is_paid).reduce((s, d) => s + d.amount, 0)
  const totalOwing = allDebts.filter((d) => d.type === 'owing' && !d.is_paid).reduce((s, d) => s + d.amount, 0)
  const debtNet = totalOwed - totalOwing

  // Top products (uses same period as main selector)
  const topProducts = useMemo(() => {
    const productSales: Record<string, { name: string; total: number; profit: number; qty: number; category: string }> = {}
    state.sales.filter((s) => s.created_at >= cutoff).forEach((sale) => {
      if (!productSales[sale.product_name]) {
        productSales[sale.product_name] = {
          name: sale.product_name,
          total: 0,
          profit: 0,
          qty: 0,
          category: state.products.find((p) => p.id === sale.product_id)?.category || 'default',
        }
      }
      productSales[sale.product_name].total += sale.total
      productSales[sale.product_name].profit += sale.profit
      productSales[sale.product_name].qty += sale.quantity
    })
    return Object.values(productSales).sort((a, b) => b.total - a.total).slice(0, 5)
  }, [period, state.sales, state.products, cutoff])

  const periods: ReportPeriod[] = ['daily', 'weekly', 'monthly', 'yearly']

  return (
    <div className="min-h-screen pb-20 relative">
      <MazeShader />
      <div className="relative z-10">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-sand/95 backdrop-blur-sm border-b-2 border-ink px-5 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="font-display text-2xl text-ink uppercase tracking-tight">{t('report')}</h1>
            <BarChart3 size={24} strokeWidth={2} className="text-ink" />
          </div>

          {/* Inline period tabs — same as v14 */}
          <div className="flex bg-warm-gray rounded-sm p-1">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`btn-tactile flex-1 py-2 font-display text-sm uppercase tracking-wider rounded-sm transition-colors ${
                  period === p ? 'bg-ink text-white' : 'text-ink'
                }`}
              >
                {periodLabels[p]}
              </button>
            ))}
          </div>
        </header>

        <div className="px-5 pt-4 space-y-4">
          {/* 4 Stat Cards — 2x2 grid, same as v14 */}
          <div className="grid grid-cols-2 gap-3">
            <motion.div
              key={`sales-${period}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-light/95 harsh-border rounded-sm p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-accent-green" strokeWidth={2.5} />
                <span className="text-micro text-muted-text">{t('sales')}</span>
              </div>
              <p className="font-display text-2xl text-ink">{formatCurrency(salesTotal)}</p>
            </motion.div>

            <motion.div
              key={`profit-${period}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-light/95 harsh-border rounded-sm p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={16} className="text-accent-green" strokeWidth={2.5} />
                <span className="text-micro text-muted-text">{t('profit')}</span>
              </div>
              <p className="font-display text-2xl text-accent-green">{formatCurrency(profitTotal)}</p>
            </motion.div>

            <motion.div
              key={`exp-${period}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-light/95 harsh-border rounded-sm p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={16} className="text-accent-red" strokeWidth={2.5} />
                <span className="text-micro text-muted-text">{t('expenses')}</span>
              </div>
              <p className="font-display text-2xl text-accent-red">{formatCurrency(expensesTotal)}</p>
            </motion.div>

            <motion.div
              key={`net-${period}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-light/95 harsh-border rounded-sm p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <CalendarDays size={16} className="text-ink" strokeWidth={2.5} />
                <span className="text-micro text-muted-text">{t('net')}</span>
              </div>
              <p className={`font-display text-2xl ${netTotal >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {formatCurrency(netTotal)}
              </p>
            </motion.div>
          </div>

          {/* Cash Flow Overview */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-light/95 harsh-border rounded-sm p-4"
          >
            <p className="text-micro text-muted-text mb-3">{t('cash_flow')}</p>
            <div className="space-y-3">
              {/* Income */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-sm">{t('income')}</span>
                  <span className="font-display text-base text-accent-green">{formatCurrency(salesTotal)}</span>
                </div>
                <div className="h-2 bg-warm-gray rounded-full overflow-hidden">
                  <motion.div
                    key={`inc-bar-${period}`}
                    initial={{ width: 0 }}
                    animate={{
                      width:
                        salesTotal + expensesTotal > 0
                          ? `${(salesTotal / (salesTotal + expensesTotal)) * 100}%`
                          : '0%',
                    }}
                    transition={{ duration: 0.5 }}
                    className="h-full bg-accent-green rounded-full"
                  />
                </div>
              </div>
              {/* Expenses */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-sm uppercase">{t('expenses')}</span>
                  <span className="font-display text-base text-accent-red">{formatCurrency(expensesTotal)}</span>
                </div>
                <div className="h-2 bg-warm-gray rounded-full overflow-hidden">
                  <motion.div
                    key={`exp-bar-${period}`}
                    initial={{ width: 0 }}
                    animate={{
                      width:
                        salesTotal + expensesTotal > 0
                          ? `${(expensesTotal / (salesTotal + expensesTotal)) * 100}%`
                          : '0%',
                    }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="h-full bg-accent-red rounded-full"
                  />
                </div>
              </div>
              {/* Balance */}
              <div className="border-t border-ink/10 pt-3 flex justify-between items-center">
                <span className="text-sm font-medium">{t('balance')}</span>
                <span className={`font-display text-lg ${netTotal >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatCurrency(netTotal)}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Debt Summary — simple, no period dropdown */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-light/95 harsh-border rounded-sm p-4"
          >
            <p className="text-micro text-muted-text mb-3">{t('debt_summary')}</p>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm">{t('they_owe_you')}</span>
                <span className="font-display text-base text-accent-green">{formatCurrency(totalOwed)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">{t('you_owe')}</span>
                <span className="font-display text-base text-accent-red">{formatCurrency(totalOwing)}</span>
              </div>
              <div className="border-t border-ink/10 pt-2 flex justify-between items-center">
                <span className="text-sm font-medium">{t('net_position')}</span>
                <span className={`font-display text-lg ${debtNet >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatCurrency(debtNet)}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Top Selling Items — simple, no period dropdown */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-light/95 harsh-border rounded-sm p-4"
          >
            <div className="flex items-center gap-2 mb-4">
              <Package size={16} className="text-ink" strokeWidth={2.5} />
              <p className="text-micro text-muted-text">{t('top_selling')}</p>
            </div>

            {topProducts.length === 0 && (
              <p className="text-sm text-muted-text text-center py-4">{t('no_sales_period')}</p>
            )}

            <div className="space-y-3">
              {topProducts.map((product, index) => (
                <div key={product.name}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
                      <ProductIcon category={product.category} size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium truncate">{product.name}</p>
                        <p className="font-display text-sm text-ink">{formatCurrency(product.total)}</p>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-text">{product.qty} {t('sold')}</span>
                        <span className="text-[10px] text-accent-green">+{formatCurrency(product.profit)} {t('profit')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 ml-11 h-1.5 bg-warm-gray rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(product.total / (topProducts[0]?.total || 1)) * 100}%` }}
                      transition={{ duration: 0.5, delay: index * 0.08 }}
                      className="h-full bg-ink rounded-full"
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
