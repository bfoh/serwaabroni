import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/data'
import {
  fetchInjection, fetchInstallments, fetchRecoveredProfit, fetchFundedStock, fetchConsumptions,
  recordInstallmentPayment, updateInjectionRisk, type FundedStockRow,
} from '@/services/capitalApi'
import { computeRisk } from '@/lib/capitalRisk'
import { buildWeeklyReport, type WeeklyReportRow } from '@/lib/capitalReport'
import type { CapitalInjection, RepaymentInstallment, RiskTier } from '@/lib/supabase'

const TIER: Record<RiskTier, { dot: string; label: string; cls: string }> = {
  on_track: { dot: '🟢', label: 'ON TRACK', cls: 'bg-green-100 text-green-800' },
  watch: { dot: '🟡', label: 'WATCH', cls: 'bg-amber-100 text-amber-800' },
  at_risk: { dot: '🔴', label: 'AT RISK', cls: 'bg-red-100 text-red-800' },
}

export default function InjectionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inj, setInj] = useState<CapitalInjection | null>(null)
  const [installments, setInstallments] = useState<RepaymentInstallment[]>([])
  const [recovered, setRecovered] = useState(0)
  const [stock, setStock] = useState<FundedStockRow[]>([])
  const [report, setReport] = useState<WeeklyReportRow[]>([])
  const [payInput, setPayInput] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!id) return
    const [injection, insts, prof, funded, cons] = await Promise.all([
      fetchInjection(id), fetchInstallments(id), fetchRecoveredProfit(id), fetchFundedStock(id), fetchConsumptions(id),
    ])
    setInj(injection); setInstallments(insts); setRecovered(prof); setStock(funded)
    setReport(buildWeeklyReport(cons))
  }
  useEffect(() => { load() }, [id])

  // Risk is derived from the loaded data; guarded so it is safe before load.
  const risk = inj
    ? computeRisk({
        injectionDate: inj.injection_date,
        paybackMonths: inj.payback_months,
        totalRepayable: inj.total_repayable,
        recoveredProfit: recovered,
        installments: installments.map((i) => ({ due_date: i.due_date, amount_due: i.amount_due, amount_paid: i.amount_paid })),
        now: new Date().toISOString(),
      })
    : null
  const tier: RiskTier = inj && inj.status !== 'repaid' && risk ? risk.tier : 'on_track'

  // Persist the freshly computed tier so the list/alerts stay in sync.
  useEffect(() => {
    if (inj && tier !== inj.risk_tier && inj.status !== 'repaid') {
      updateInjectionRisk(inj.id, tier).catch(() => {})
    }
  }, [tier, inj])

  if (!inj || !risk) return <div className="min-h-screen bg-light p-5 text-sm text-muted-text">Loading…</div>

  const style = TIER[tier]
  const pct = Math.min(100, Math.round((recovered / inj.total_repayable) * 100))
  const targetPct = Math.min(100, Math.round((risk.linearTargetNow / inj.total_repayable) * 100))

  const pay = async () => {
    const amt = parseFloat(payInput)
    if (!amt || amt <= 0) return
    setBusy(true)
    try { await recordInstallmentPayment(inj.id, amt); setPayInput(''); await load() }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-light pb-12">
      <header className="bg-ink text-white px-5 pt-6 pb-4">
        <button onClick={() => navigate('/capital')} className="flex items-center gap-1 text-white/70 text-sm mb-3">
          <ArrowLeft size={16} /> Capital
        </button>
      </header>

      <div className="px-5 -mt-2 space-y-3">
        {/* 1. Header card */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs uppercase text-muted-text">{inj.source.replace('_', ' / ')}</p>
              <p className="font-display text-xl">{formatCurrency(inj.principal)}
                {inj.interest_amount > 0 && <span className="text-sm text-muted-text"> + {formatCurrency(inj.interest_amount)} interest</span>}</p>
              <p className="text-xs text-muted-text">Repay {formatCurrency(inj.total_repayable)} over {inj.payback_months} months</p>
            </div>
            <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${style.cls}`}>{style.dot} {style.label}</span>
          </div>
        </div>

        {/* 2. Recovery card */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <p className="text-sm font-medium mb-2">Recovery from this stock's profit</p>
          <div className="relative h-5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-accent-green" style={{ width: `${pct}%` }} />
            <div className="absolute top-0 h-full border-l-2 border-dashed border-ink" style={{ left: `${targetPct}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-muted-text mt-1">
            <span><strong className="text-accent-green">{formatCurrency(recovered)}</strong> recovered ({pct}%)</span>
            <span>target by now: {targetPct}%</span>
          </div>
          {risk.shortfall > 0 && inj.status !== 'repaid' && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-sm p-3 text-xs text-amber-800 flex gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>At this pace you'll recover <strong>{formatCurrency(risk.projected)}</strong> by the deadline —
                <strong> {formatCurrency(risk.shortfall)} short</strong>. Aim for <strong>{formatCurrency(risk.requiredProfitPerWeek)}/week</strong> profit to stay on track.</span>
            </div>
          )}
        </div>

        {/* 3. Schedule card */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <p className="text-sm font-medium mb-2">Repayment schedule</p>
          <div className="space-y-1 text-sm">
            {installments.map((i) => {
              const paid = i.amount_paid >= i.amount_due
              const overdue = !paid && new Date(i.due_date).getTime() <= Date.now()
              return (
                <div key={i.id} className="flex justify-between">
                  <span>{paid ? '✅' : overdue ? '🔴' : '🔔'} {formatDate(i.due_date)} · {formatCurrency(i.amount_due)}</span>
                  <span className={paid ? 'text-accent-green' : overdue ? 'text-accent-red' : 'text-muted-text'}>
                    {paid ? 'paid' : overdue ? 'overdue' : 'upcoming'}
                  </span>
                </div>
              )
            })}
          </div>
          {inj.status !== 'repaid' && (
            <div className="flex gap-2 mt-3">
              <input className="flex-1 harsh-border rounded-sm px-3 py-2 text-sm" type="number" inputMode="decimal"
                placeholder="Record payment (GHS)" value={payInput} onChange={(e) => setPayInput(e.target.value)} />
              <button onClick={pay} disabled={busy || !payInput}
                className="bg-accent-red text-white rounded-sm px-4 text-sm disabled:opacity-50">Pay</button>
            </div>
          )}
        </div>

        {/* 4. Funded stock card */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <p className="text-sm font-medium mb-2">Stock bought with this capital</p>
          {stock.length === 0 && <p className="text-xs text-muted-text">No stock tagged to this injection yet. Tag it when you receive stock in Inventory.</p>}
          <div className="space-y-1 text-sm">
            {stock.map((s) => (
              <div key={s.product_id} className="flex justify-between">
                <span>{s.product_name} — {s.qty_purchased} bought</span>
                <span className="text-muted-text">{s.qty_sold} sold · {s.qty_purchased > 0 ? Math.round((s.qty_sold / s.qty_purchased) * 100) : 0}%</span>
              </div>
            ))}
          </div>
          {stock.length > 0 && (
            <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm font-medium">
              <span>Turnover so far</span>
              <span>{formatCurrency(stock.reduce((s, x) => s + x.turnover, 0))} · profit {formatCurrency(stock.reduce((s, x) => s + x.profit, 0))}</span>
            </div>
          )}
        </div>

        {/* 5. Weekly report */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <p className="text-sm font-medium mb-2">Weekly report</p>
          {report.length === 0 && <p className="text-xs text-muted-text">No sales of this stock yet.</p>}
          <div className="space-y-1 text-sm">
            {report.map((w) => (
              <div key={w.week} className="flex justify-between">
                <span>{w.week.replace('-W', ' · week ')} — {w.units} sold</span>
                <span className="text-muted-text">
                  {formatCurrency(w.profit)} profit
                  {w.deltaVsPrev !== 0 && (
                    <span className={w.deltaVsPrev > 0 ? 'text-accent-green' : 'text-accent-red'}>
                      {' '}{w.deltaVsPrev > 0 ? '↑' : '↓'}{formatCurrency(Math.abs(w.deltaVsPrev))}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
