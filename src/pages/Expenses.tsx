import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Search, TrendingDown, Trash2, Receipt } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatTime, uid } from '@/lib/data'

interface ExpensesProps {
  isOpen: boolean
  onClose: () => void
}

const CATEGORIES = ['Rent', 'Electricity', 'Water', 'Transport', 'Salary', 'Supplies', 'Other']

export default function Expenses({ isOpen, onClose }: ExpensesProps) {
  const { state, dispatch, showToast, addExpense, removeExpense } = useStore()
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Other')
  const [notes, setNotes] = useState('')
  const [payFrom, setPayFrom] = useState<'cash' | 'bank'>('cash')
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    let exps = state.expenses
    if (search) exps = exps.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    if (filterCat) exps = exps.filter((e) => e.category === filterCat)
    return exps
  }, [state.expenses, search, filterCat])

  const summary = useMemo(() => {
    const total = filtered.reduce((s, e) => s + e.amount, 0)
    const byCategory = CATEGORIES.map((cat) => ({
      cat,
      amount: filtered.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
    })).filter((c) => c.amount > 0)
    return { total, byCategory }
  }, [filtered])

  const handleAdd = async () => {
    if (!name || !amount) { showToast('Enter name and amount', 'error'); return }
    setSaving(true)
    try {
      await addExpense({
        id: uid(),
        name,
        amount: parseFloat(amount),
        category,
        notes: notes || null,
        created_at: new Date().toISOString(),
      }, payFrom)
      showToast('Expense added!', 'success')
      setShowAdd(false)
      setName('')
      setAmount('')
      setCategory('Other')
      setNotes('')
      setPayFrom('cash')
    } catch { showToast('Failed to add', 'error') }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    await removeExpense(id)
    dispatch({ type: 'DELETE_EXPENSE', id })
    showToast('Deleted', 'success')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-sand flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-sand border-b-2 border-ink px-5 py-3 pt-safe flex items-center justify-between flex-shrink-0">
        <h1 className="font-display text-xl text-ink uppercase tracking-tight">Expenses</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAdd(true)} className="btn-tactile w-9 h-9 bg-ink rounded-sm flex items-center justify-center">
            <Plus size={18} className="text-white" />
          </button>
          <button onClick={onClose} className="btn-tactile w-9 h-9 bg-warm-gray rounded-sm flex items-center justify-center">
            <X size={18} strokeWidth={2.5} className="text-ink" />
          </button>
        </div>
      </div>

      {/* Total */}
      <div className="px-5 pt-4 pb-2 flex-shrink-0">
        <div className="bg-warm-gray rounded-sm px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown size={16} className="text-accent-red" />
            <span className="text-xs text-muted-text uppercase">Total Expenses</span>
          </div>
          <span className="font-display text-lg text-accent-red">{formatCurrency(summary.total)}</span>
        </div>
      </div>

      {/* Category Breakdown */}
      {summary.byCategory.length > 0 && (
        <div className="px-5 pb-2 flex gap-1.5 overflow-x-auto flex-shrink-0">
          {summary.byCategory.map((c) => (
            <button
              key={c.cat}
              onClick={() => setFilterCat(filterCat === c.cat ? null : c.cat)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-sm text-[10px] font-display uppercase tracking-wider border-2 transition-colors ${
                filterCat === c.cat ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'
              }`}
            >
              {c.cat}: {formatCurrency(c.amount)}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="px-5 pb-3 flex-shrink-0">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search expenses..." className="w-full h-10 pl-10 pr-4 bg-light harsh-border rounded-sm text-sm font-body" />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-5 pb-sheet space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Receipt size={40} strokeWidth={1} className="text-ink/20 mx-auto mb-3" />
            <p className="text-muted-text text-sm">No expenses yet</p>
            <p className="text-xs text-muted-text mt-1">Tap + to add your first expense</p>
          </div>
        )}
        {filtered.map((exp, i) => (
          <motion.div key={exp.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            className="bg-light harsh-border rounded-sm p-3 flex items-center gap-3"
          >
            <div className="w-9 h-9 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
              <TrendingDown size={16} className="text-accent-red" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{exp.name}</p>
              <p className="text-[10px] text-muted-text">{exp.category} | {formatTime(exp.created_at)}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="font-display text-sm text-accent-red">{formatCurrency(exp.amount)}</p>
            </div>
            <button onClick={() => handleDelete(exp.id)} className="w-8 h-8 flex items-center justify-center ml-1">
              <Trash2 size={13} className="text-accent-red/50" />
            </button>
          </motion.div>
        ))}
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {showAdd && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowAdd(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-[61] flex flex-col shadow-sheet"
              style={{ maxHeight: '92dvh' }}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink flex-shrink-0">
                <h2 className="font-display text-2xl text-ink uppercase tracking-tight">Add Expense</h2>
                <button onClick={() => setShowAdd(false)} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
                  <X size={20} strokeWidth={2.5} className="text-ink" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="What did you spend on?" className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base" />
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (GH₵)" className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base" />
                <div className="grid grid-cols-4 gap-1.5">
                  {CATEGORIES.map((cat) => (
                    <button key={cat} onClick={() => setCategory(cat)}
                      className={`py-2 text-[10px] font-display uppercase tracking-wider rounded-sm border-2 ${
                        category === cat ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'
                      }`}>
                      {cat}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-micro text-muted-text mb-2 block">PAID FROM</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['cash','bank'] as const).map((a) => (
                      <button key={a} type="button" onClick={() => setPayFrom(a)}
                        className={`py-3 font-display text-xs uppercase tracking-wide rounded-sm border-2 ${payFrom === a ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                        {a === 'cash' ? 'Cash in hand' : 'Cash in bank'}
                      </button>
                    ))}
                  </div>
                </div>
                </div>
                
                {/* Save button - STICKY AT BOTTOM */}
                <div className="px-5 pt-4 pb-sheet bg-sand border-t-2 border-ink flex-shrink-0 mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
                  <button onClick={handleAdd} disabled={saving} className="w-full h-14 bg-ink text-white font-display text-lg uppercase tracking-wider rounded-sm disabled:opacity-50">
                    {saving ? '...' : 'Add Expense'}
                  </button>
                </div>
              </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
