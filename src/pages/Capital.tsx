import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Plus, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '@/lib/data'
import { fetchInjections, fetchRecoveredProfitMap } from '@/services/capitalApi'
import { computeRisk } from '@/lib/capitalRisk'
import type { CapitalInjection, RiskTier } from '@/lib/supabase'
import CreateInjectionSheet from '@/components/CreateInjectionSheet'

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

export default function Capital() {
  const navigate = useNavigate()
  const [injections, setInjections] = useState<CapitalInjection[]>([])
  const [recovered, setRecovered] = useState<Record<string, number>>({})
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const list = await fetchInjections()
      setInjections(list)
      setRecovered(await fetchRecoveredProfitMap(list.map((i) => i.id)))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const totalOutstanding = injections
    .filter((i) => i.status !== 'repaid')
    .reduce((s, i) => s + (i.total_repayable - i.amount_repaid), 0)
  const totalRecovered = Object.values(recovered).reduce((s, v) => s + v, 0)

  return (
    <div className="min-h-screen bg-light pb-40">
      <header className="bg-ink text-white px-5 pt-6 pb-5">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-white/70 text-sm mb-3">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl">Capital & Loans</h1>
        <div className="flex gap-6 mt-3">
          <div><p className="text-xs text-white/60">Outstanding</p><p className="font-display text-lg">{formatCurrency(totalOutstanding)}</p></div>
          <div><p className="text-xs text-white/60">Recovered (profit)</p><p className="font-display text-lg text-accent-green">{formatCurrency(totalRecovered)}</p></div>
        </div>
      </header>

      <div className="px-5 py-4 space-y-3">
        {loading && <p className="text-sm text-muted-text">Loading…</p>}
        {!loading && injections.length === 0 && (
          <div className="text-center py-12 text-muted-text">
            <p className="text-sm">No capital tracked yet.</p>
            <p className="text-xs mt-1">Add a loan or investment to start tracing every pesewa.</p>
          </div>
        )}
        {injections.map((inj) => {
          const recoveredProfit = recovered[inj.id] || 0
          const risk = computeRisk({
            injectionDate: inj.injection_date,
            paybackMonths: inj.payback_months,
            totalRepayable: inj.total_repayable,
            recoveredProfit,
            installments: [],
            now: new Date().toISOString(),
          })
          const tier = inj.status === 'repaid' ? 'on_track' : risk.tier
          const style = TIER_STYLE[tier]
          const pct = Math.min(100, Math.round((recoveredProfit / inj.total_repayable) * 100))
          return (
            <button
              key={inj.id}
              onClick={() => navigate(`/capital/${inj.id}`)}
              className="w-full text-left bg-white harsh-border rounded-sm p-4"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-text">{SOURCE_LABEL[inj.source]}</p>
                  <p className="font-medium text-sm">{inj.lender_name || formatCurrency(inj.principal)}</p>
                </div>
                <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${style.cls}`}>
                  {style.dot} {inj.status === 'repaid' ? 'Repaid' : style.label}
                </span>
              </div>
              <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-accent-green" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-muted-text mt-1">
                <span>{formatCurrency(recoveredProfit)} recovered ({pct}%)</span>
                <span>of {formatCurrency(inj.total_repayable)}</span>
              </div>
              {tier === 'at_risk' && inj.status !== 'repaid' && (
                <p className="flex items-center gap-1 text-[11px] text-accent-red mt-2">
                  <AlertTriangle size={12} /> Behind — tap to see what to do
                </p>
              )}
            </button>
          )
        })}
      </div>

      <button
        onClick={() => setShowCreate(true)}
        className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+1.5rem)] right-5 w-14 h-14 rounded-full bg-accent-red text-white flex items-center justify-center shadow-lg z-30"
        aria-label="Add capital"
      >
        <Plus size={26} />
      </button>

      <CreateInjectionSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </div>
  )
}
