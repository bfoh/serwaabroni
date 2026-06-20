import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Plus } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/data'
import { fetchMovements, fetchBalances, postTransfer, postMovement, type CashMovement } from '@/services/cashApi'
import { useStore } from '@/lib/store'

const CAT_LABEL: Record<string, string> = {
  sale: 'Sale', debtor_payment: 'Debtor payment', expense: 'Expense',
  loan_repayment: 'Loan repayment', debt_repayment: 'Debt repayment',
  stock_purchase: 'Stock purchase', bank_deposit: 'Bank deposit',
  bank_withdrawal: 'Bank withdrawal', adjustment: 'Adjustment',
}

type Action = 'deposit' | 'withdraw' | 'adjust' | null

export default function CashFlow() {
  const navigate = useNavigate()
  const { refreshData } = useStore()
  const [rows, setRows] = useState<CashMovement[]>([])
  const [bal, setBal] = useState({ cash: 0, bank: 0 })
  const [action, setAction] = useState<Action>(null)
  const [amount, setAmount] = useState('')
  const [adjAccount, setAdjAccount] = useState<'cash' | 'bank'>('cash')
  const [adjDir, setAdjDir] = useState<'in' | 'out'>('in')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [m, b] = await Promise.all([fetchMovements(200), fetchBalances()])
    setRows(m); setBal(b)
  }
  useEffect(() => { load() }, [])

  const submit = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return
    setBusy(true)
    try {
      if (action === 'deposit') await postTransfer('cash', 'bank', amt, note || null)
      else if (action === 'withdraw') await postTransfer('bank', 'cash', amt, note || null)
      else if (action === 'adjust') await postMovement({ account: adjAccount, direction: adjDir, amount: amt, category: 'adjustment', note: note || 'Adjustment' })
      setAction(null); setAmount(''); setNote('')
      await load(); await refreshData()
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-light pb-24">
      <header className="bg-ink text-white px-5 pt-[calc(env(safe-area-inset-top)_+_1.5rem)] pb-5">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-white/70 text-sm mb-3">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl">Cash Flow</h1>
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
          <div className="min-w-0"><p className="text-xs text-white/60">Cash in hand</p><p className="font-display text-lg truncate">{formatCurrency(bal.cash)}</p></div>
          <div className="min-w-0"><p className="text-xs text-white/60">Cash in bank</p><p className="font-display text-lg truncate">{formatCurrency(bal.bank)}</p></div>
        </div>
      </header>

      <div className="px-5 py-3 flex gap-2">
        <button onClick={() => setAction('deposit')} className="btn-tactile flex-1 py-2.5 text-xs uppercase tracking-wide rounded-sm border-2 border-ink bg-light">Deposit → bank</button>
        <button onClick={() => setAction('withdraw')} className="btn-tactile flex-1 py-2.5 text-xs uppercase tracking-wide rounded-sm border-2 border-ink bg-light">Withdraw → cash</button>
        <button onClick={() => setAction('adjust')} className="btn-tactile flex-1 py-2.5 text-xs uppercase tracking-wide rounded-sm border-2 border-ink bg-light">Adjust</button>
      </div>

      <div className="px-5 space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-text py-8 text-center">No movements yet.</p>}
        {rows.map((m) => (
          <div key={m.id} className="bg-white harsh-border rounded-sm px-4 py-3 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm text-ink truncate">{CAT_LABEL[m.category] || m.category}{m.note ? ` · ${m.note}` : ''}</p>
              <p className="text-[11px] text-muted-text">{formatDate(m.created_at)} · {m.account === 'cash' ? 'Cash' : 'Bank'}</p>
            </div>
            <span className={`font-display text-sm shrink-0 ${m.direction === 'in' ? 'text-accent-green' : 'text-accent-red'}`}>
              {m.direction === 'in' ? '+' : '−'}{formatCurrency(m.amount)}
            </span>
          </div>
        ))}
      </div>

      {action && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setAction(null)} />
          <div className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-4">
            <p className="font-display text-lg uppercase">{action === 'deposit' ? 'Deposit to bank' : action === 'withdraw' ? 'Withdraw to cash' : 'Adjustment'}</p>
            {action === 'adjust' && (
              <div className="grid grid-cols-2 gap-2">
                {(['cash','bank'] as const).map((a) => (
                  <button key={a} onClick={() => setAdjAccount(a)} className={`py-2 text-xs uppercase rounded-sm border-2 border-ink ${adjAccount === a ? 'bg-ink text-white' : 'bg-light'}`}>{a}</button>
                ))}
                {(['in','out'] as const).map((d) => (
                  <button key={d} onClick={() => setAdjDir(d)} className={`py-2 text-xs uppercase rounded-sm border-2 border-ink ${adjDir === d ? 'bg-ink text-white' : 'bg-light'}`}>{d === 'in' ? 'Add' : 'Remove'}</button>
                ))}
              </div>
            )}
            <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (GH₵)"
              className="block w-full min-w-0 max-w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body appearance-none" />
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
              className="block w-full min-w-0 max-w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body" />
            <div className="flex gap-3">
              <button onClick={() => setAction(null)} className="btn-tactile flex-1 h-12 bg-warm-gray font-display text-sm uppercase rounded-sm">Cancel</button>
              <button onClick={submit} disabled={busy} className="btn-tactile flex-1 h-12 bg-ink text-white font-display text-sm uppercase rounded-sm disabled:opacity-50">{busy ? '…' : 'Save'}</button>
            </div>
          </div>
        </>
      )}

      <button onClick={() => setAction('adjust')} aria-label="Add adjustment"
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-5 w-14 h-14 rounded-full bg-accent-red text-white flex items-center justify-center shadow-lg z-30">
        <Plus size={26} />
      </button>
    </div>
  )
}
