import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Landmark, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '@/lib/data'
import { fetchInjections, fetchRecoveredProfitMap } from '@/services/capitalApi'
import { computeRisk } from '@/lib/capitalRisk'
import type { CapitalInjection, RiskTier } from '@/lib/supabase'

const SOURCE_LABEL: Record<string, string> = {
  microfinance: 'Microfinance loan',
  personal: 'Personal money',
  family_friends: 'Family / friends',
  investment: 'Investment',
  other: 'Other',
}

const TIER_STYLE: Record<RiskTier, { dot: string; label: string; cls: string }> = {
  on_track: { dot: '🟢', label: 'On track', cls: 'bg-green-100 text-green-800' },
  watch: { dot: '🟡', label: 'Watch', cls: 'bg-amber-100 text-amber-800' },
  at_risk: { dot: '🔴', label: 'At risk', cls: 'bg-red-100 text-red-800' },
}

// Reports-embedded capital view. `cutoff` is the ISO start of the selected period
// (daily/weekly/monthly/yearly); `periodLabel` is shown next to the period profit.
export default function CapitalReportSection({ cutoff, periodLabel }: { cutoff: string; periodLabel: string }) {
  const navigate = useNavigate()
  const [injections, setInjections] = useState<CapitalInjection[]>([])
  const [lifetime, setLifetime] = useState<Record<string, number>>({})
  const [periodMap, setPeriodMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const list = await fetchInjections()
        const active = list.filter((i) => i.status !== 'repaid')
        const ids = active.map((i) => i.id)
        const [life, period] = await Promise.all([
          fetchRecoveredProfitMap(ids),
          fetchRecoveredProfitMap(ids, cutoff),
        ])
        if (cancelled) return
        setInjections(active)
        setLifetime(life)
        setPeriodMap(period)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [cutoff])

  const outstanding = injections.reduce((s, i) => s + (i.total_repayable - i.amount_repaid), 0)
  const recoveredPeriod = Object.values(periodMap).reduce((s, v) => s + v, 0)

  return (
    <div className="bg-light/95 harsh-border rounded-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Landmark size={16} className="text-ink" strokeWidth={2.5} />
          <span className="text-micro text-muted-text uppercase tracking-wider">Capital & Loans</span>
        </div>
        <button onClick={() => navigate('/capital')} className="text-micro text-accent-red">View all</button>
      </div>

      {/* Period + outstanding totals */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-[10px] text-muted-text uppercase">Recovered ({periodLabel})</p>
          <p className="font-display text-lg text-accent-green">{formatCurrency(recoveredPeriod)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-text uppercase">Outstanding</p>
          <p className="font-display text-lg text-ink">{formatCurrency(outstanding)}</p>
        </div>
      </div>

      {loading && <p className="text-xs text-muted-text">Loading…</p>}
      {!loading && injections.length === 0 && (
        <button onClick={() => navigate('/capital')} className="w-full text-left text-xs text-muted-text py-2">
          No capital tracked — tap to add a loan or investment.
        </button>
      )}

      <div className="space-y-2">
        {injections.map((inj) => {
          const recoveredLife = lifetime[inj.id] || 0
          const thisPeriod = periodMap[inj.id] || 0
          const risk = computeRisk({
            injectionDate: inj.injection_date,
            paybackMonths: inj.payback_months,
            totalRepayable: inj.total_repayable,
            recoveredProfit: recoveredLife,
            installments: [],
            now: new Date().toISOString(),
          })
          const style = TIER_STYLE[risk.tier]
          const pct = Math.min(100, Math.round((recoveredLife / inj.total_repayable) * 100))
          return (
            <button
              key={inj.id}
              onClick={() => navigate(`/capital/${inj.id}`)}
              className="w-full text-left border-t border-ink/10 pt-2"
            >
              <div className="flex justify-between items-start">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{inj.lender_name || SOURCE_LABEL[inj.source]}</p>
                  <p className="text-[10px] text-muted-text">{SOURCE_LABEL[inj.source]}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${style.cls}`}>
                  {style.dot} {style.label}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-accent-green" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-muted-text mt-1">
                <span>{pct}% recovered ({formatCurrency(recoveredLife)} of {formatCurrency(inj.total_repayable)})</span>
                <span className="text-accent-green">+{formatCurrency(thisPeriod)} {periodLabel}</span>
              </div>
              {risk.tier === 'at_risk' && (
                <p className="flex items-center gap-1 text-[10px] text-accent-red mt-1">
                  <AlertTriangle size={10} /> Behind pace — {formatCurrency(risk.requiredProfitPerWeek)}/week needed
                </p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
