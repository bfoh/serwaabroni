import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { createInjection, updateInjection } from '@/services/capitalApi'
import type { CapitalSource, CapitalInjection } from '@/lib/supabase'

const SOURCES: { value: CapitalSource; label: string }[] = [
  { value: 'microfinance', label: 'Microfinance loan' },
  { value: 'personal', label: 'Personal money' },
  { value: 'family_friends', label: 'Family / friends' },
  { value: 'investment', label: 'Investment' },
  { value: 'other', label: 'Other' },
]

export default function CreateInjectionSheet({
  open, onClose, onCreated, injection = null
}: { open: boolean; onClose: () => void; onCreated: () => void; injection?: CapitalInjection | null }) {
  const [source, setSource] = useState<CapitalSource>('microfinance')
  const [lender, setLender] = useState('')
  const [principal, setPrincipal] = useState('')
  const [interest, setInterest] = useState('')
  const [months, setMonths] = useState('3')
  const [repaymentType, setRepaymentType] = useState<'equal' | 'interest_only'>('equal')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (injection && open) {
      setSource(injection.source)
      setLender(injection.lender_name || '')
      setPrincipal(injection.principal.toString())
      setInterest(injection.interest_amount.toString())
      setMonths(injection.payback_months.toString())
      setRepaymentType(injection.repayment_type)
    } else if (open && !injection) {
      reset()
    }
  }, [injection, open])

  const reset = () => {
    setSource('microfinance'); setLender(''); setPrincipal(''); setInterest(''); setMonths('3'); setRepaymentType('equal')
  }

  const submit = async () => {
    const p = parseFloat(principal)
    if (!p || p <= 0) return
    const m = Math.max(1, parseInt(months) || 3)
    setSaving(true)
    try {
      if (injection) {
        await updateInjection(injection.id, {
          source,
          lender_name: lender.trim() || null,
          principal: p,
          interest_amount: parseFloat(interest) || 0,
          payback_months: m,
          repayment_type: repaymentType,
        })
      } else {
        await createInjection({
          source,
          lender_name: lender.trim() || null,
          principal: p,
          interest_amount: parseFloat(interest) || 0,
          injection_date: new Date().toISOString(),
          payback_months: m,
          installment_count: m, // monthly installments, one per month
          repayment_type: repaymentType,
          notes: null,
        })
      }
      reset()
      onCreated()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const total = (parseFloat(principal) || 0) + (parseFloat(interest) || 0)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader><SheetTitle>{injection ? 'Edit capital' : 'Add capital'}</SheetTitle></SheetHeader>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                onClick={() => setSource(s.value)}
                className={`text-xs px-3 py-2 rounded-sm harsh-border ${source === s.value ? 'bg-ink text-white' : 'bg-white'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-ink font-medium">Lender / source name (optional)</label>
            <input className="w-full harsh-border rounded-sm px-3 py-2 text-sm" placeholder="e.g. Sinapi Aba"
              value={lender} onChange={(e) => setLender(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-ink font-medium">Principal received (GHS)</label>
            <input className="w-full harsh-border rounded-sm px-3 py-2 text-sm" type="number" inputMode="decimal"
              placeholder="0.00" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-ink font-medium">Interest amount (GHS, optional)</label>
            <input className="w-full harsh-border rounded-sm px-3 py-2 text-sm" type="number" inputMode="decimal"
              placeholder="0.00" value={interest} onChange={(e) => setInterest(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-ink font-medium">Payback months</label>
            <input className="w-full harsh-border rounded-sm px-3 py-2 text-sm" type="number" inputMode="numeric"
              placeholder="3" value={months} onChange={(e) => setMonths(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-ink font-medium">Repayment type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRepaymentType('equal')}
                className={`text-xs px-3 py-2 rounded-sm harsh-border ${repaymentType === 'equal' ? 'bg-ink text-white' : 'bg-white'}`}
              >
                Equal installments
              </button>
              <button
                type="button"
                onClick={() => setRepaymentType('interest_only')}
                className={`text-xs px-3 py-2 rounded-sm harsh-border ${repaymentType === 'interest_only' ? 'bg-ink text-white' : 'bg-white'}`}
              >
                Interest-only + balloon
              </button>
            </div>
          </div>
          {total > 0 && (() => {
            const m = Math.max(1, parseInt(months) || 3)
            const p = parseFloat(principal) || 0
            const intAmt = parseFloat(interest) || 0
            const perMonthInterest = Math.round((intAmt / m) * 100) / 100
            const finalMonth = Math.round((perMonthInterest + p) * 100) / 100
            return repaymentType === 'interest_only' ? (
              <p className="text-xs text-muted-text">
                Interest <strong>GHS {perMonthInterest.toFixed(2)}</strong>/mo for {m} months; final month{' '}
                <strong>GHS {finalMonth.toFixed(2)}</strong> (incl. principal). Total GHS {total.toFixed(2)}.
              </p>
            ) : (
              <p className="text-xs text-muted-text">
                Total to repay: <strong>GHS {total.toFixed(2)}</strong> over {months || '3'} monthly installments.
              </p>
            )
          })()}
          <button onClick={submit} disabled={saving || !principal}
            className="w-full bg-accent-red text-white rounded-sm py-3 text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : (injection ? 'Save changes' : 'Add capital & build schedule')}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
