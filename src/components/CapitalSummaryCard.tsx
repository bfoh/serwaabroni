import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Landmark } from 'lucide-react'
import { fetchCapitalSummary, type CapitalSummary } from '@/services/capitalApi'

export default function CapitalSummaryCard() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<CapitalSummary | null>(null)

  useEffect(() => {
    fetchCapitalSummary().then(setSummary).catch(() => {})
  }, [])

  return (
    <button
      onClick={() => navigate('/capital')}
      className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2 relative"
    >
      {summary && summary.atRiskCount > 0 && (
        <span className="absolute top-1 right-1 bg-accent-red text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
          {summary.atRiskCount} at risk
        </span>
      )}
      <Landmark size={24} className="text-ink" />
      <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Capital<br/>& Loans</span>
    </button>
  )
}
