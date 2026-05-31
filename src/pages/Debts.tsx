import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Phone, User, CalendarDays, CheckCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatDate, uid } from '@/lib/data'

type DebtTab = 'owed' | 'owing'

export default function Debts() {
  const { state, dispatch, showToast, t, addDebt, updateDebt } = useStore()
  const [activeDebtTab, setActiveDebtTab] = useState<DebtTab>('owed')
  const [showAddDebt, setShowAddDebt] = useState(false)
  const [markingPaid, setMarkingPaid] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [newDebt, setNewDebt] = useState({
    person_name: '',
    phone: '',
    amount: '',
    description: '',
    type: 'owed' as DebtTab,
    due_date: '',
  })

  const owedDebts = state.debts.filter((d) => d.type === 'owed' && !d.is_paid)
  const owingDebts = state.debts.filter((d) => d.type === 'owing' && !d.is_paid)
  const paidDebts = state.debts.filter((d) => d.is_paid)

  const totalOwed = owedDebts.reduce((s, d) => s + d.amount, 0)
  const totalOwing = owingDebts.reduce((s, d) => s + d.amount, 0)

  const handleAddDebt = async () => {
    if (!newDebt.person_name || !newDebt.amount) {
      showToast('Please fill in name and amount', 'error')
      return
    }

    setSaving(true)

    try {
      await addDebt({
        id: uid(),
        person_name: newDebt.person_name,
        phone: newDebt.phone || null,
        amount: parseFloat(newDebt.amount),
        description: newDebt.description || null,
        type: newDebt.type,
        due_date: newDebt.due_date || null,
        is_paid: false,
        paid_at: null,
        created_at: new Date().toISOString(),
      })
      showToast('Debt recorded!', 'success')
      setShowAddDebt(false)
      setNewDebt({ person_name: '', phone: '', amount: '', description: '', type: 'owed', due_date: '' })
    } catch {
      showToast('Failed to save debt', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleMarkPaid = async (debtId: string) => {
    const debt = state.debts.find((d) => d.id === debtId)
    if (!debt) return

    try {
      await updateDebt(debtId, { is_paid: true, paid_at: new Date().toISOString() })

      if (debt.type === 'owed') {
        dispatch({ type: 'SET_BALANCE', value: state.balance + debt.amount })
        dispatch({ type: 'SET_PENDING_DEBTS', value: Math.max(0, state.pendingDebts - debt.amount) })
      }

      showToast(`${debt.person_name} marked as paid!`, 'success')
    } catch {
      showToast('Failed to mark as paid', 'error')
    }

    setMarkingPaid(null)
  }

  const getDaysOverdue = (dueDate: string | null) => {
    if (!dueDate) return null
    const due = new Date(dueDate)
    const now = new Date()
    const diff = Math.ceil((now.getTime() - due.getTime()) / 86400000)
    return diff > 0 ? diff : 0
  }

  return (
    <div className="min-h-screen bg-sand pb-20">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display text-2xl text-ink uppercase tracking-tight">{t('debts')}</h1>
          <button
            onClick={() => setShowAddDebt(true)}
            className="btn-tactile w-10 h-10 bg-accent-red flex items-center justify-center rounded-sm"
          >
            <Plus size={20} strokeWidth={2.5} className="text-white" />
          </button>
        </div>

        {/* Summary */}
        <div className="flex gap-2">
          <div className="flex-1 bg-accent-green rounded-sm px-3 py-2">
            <p className="text-[10px] text-white/50 uppercase">{t('they_owe_you')}</p>
            <p className="font-display text-sm text-white">{formatCurrency(totalOwed)}</p>
          </div>
          <div className="flex-1 bg-accent-red rounded-sm px-3 py-2">
            <p className="text-[10px] text-white/50 uppercase">{t('you_owe')}</p>
            <p className="font-display text-sm text-white">{formatCurrency(totalOwing)}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex mt-3 border-b-2 border-ink">
          <button
            onClick={() => setActiveDebtTab('owed')}
            className={`flex-1 py-2.5 font-display text-sm uppercase tracking-wider transition-colors ${
              activeDebtTab === 'owed' ? 'text-ink border-b-2 border-accent-red -mb-0.5' : 'text-muted-text'
            }`}
          >
            {t('who_owe')} ({owedDebts.length})
          </button>
          <button
            onClick={() => setActiveDebtTab('owing')}
            className={`flex-1 py-2.5 font-display text-sm uppercase tracking-wider transition-colors ${
              activeDebtTab === 'owing' ? 'text-ink border-b-2 border-accent-red -mb-0.5' : 'text-muted-text'
            }`}
          >
            {t('i_owe')} ({owingDebts.length})
          </button>
        </div>
      </header>

      {/* Debt List */}
      <section className="px-5 pt-4 space-y-3">
        <AnimatePresence mode="wait">
          {activeDebtTab === 'owed' && (
            <motion.div key="owed" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-3">
              {owedDebts.length === 0 && (
                <div className="text-center py-12">
                  <CheckCircle size={40} className="text-accent-green mx-auto mb-3" />
                  <p className="text-muted-text text-sm">{t('no_outstanding')}</p>
                </div>
              )}
              {owedDebts.map((debt, index) => {
                const overdue = getDaysOverdue(debt.due_date)
                return (
                  <motion.div key={debt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
                    className={`bg-light harsh-border rounded-sm overflow-hidden ${overdue && overdue > 0 ? 'border-l-4 border-l-accent-red' : ''}`}>
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-ink flex items-center justify-center flex-shrink-0">
                            <span className="font-display text-sm text-white">{debt.person_name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div>
                            <p className="font-medium text-sm">{debt.person_name}</p>
                            {debt.phone && <p className="text-xs text-muted-text flex items-center gap-1"><Phone size={10} />{debt.phone}</p>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-lg text-accent-green">{formatCurrency(debt.amount)}</p>
                          {overdue !== null && overdue > 0 && <p className="text-[10px] text-accent-red font-medium">{overdue} days overdue</p>}
                        </div>
                      </div>
                      {debt.description && <p className="text-xs text-muted-text mt-2">{debt.description}</p>}
                      {debt.due_date && <p className="text-xs text-muted-text mt-1 flex items-center gap-1"><CalendarDays size={10} />Due: {formatDate(debt.due_date)}</p>}
                    </div>
                    <div className="flex border-t border-ink/10">
                      <button onClick={() => setMarkingPaid(debt.id)} className="flex-1 py-2.5 text-micro text-accent-green hover:bg-warm-gray/30 transition-colors">{t('mark_paid')}</button>
                    </div>
                  </motion.div>
                )
              })}
            </motion.div>
          )}

          {activeDebtTab === 'owing' && (
            <motion.div key="owing" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              {owingDebts.length === 0 && (
                <div className="text-center py-12">
                  <CheckCircle size={40} className="text-accent-green mx-auto mb-3" />
                  <p className="text-muted-text text-sm">{t('no_outstanding')}</p>
                </div>
              )}
              {owingDebts.map((debt, index) => {
                const overdue = getDaysOverdue(debt.due_date)
                return (
                  <motion.div key={debt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
                    className={`bg-light harsh-border rounded-sm overflow-hidden ${overdue && overdue > 0 ? 'border-l-4 border-l-accent-red' : ''}`}>
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-accent-red flex items-center justify-center flex-shrink-0">
                            <span className="font-display text-sm text-white">{debt.person_name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div>
                            <p className="font-medium text-sm">{debt.person_name}</p>
                            {debt.phone && <p className="text-xs text-muted-text flex items-center gap-1"><Phone size={10} />{debt.phone}</p>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-lg text-accent-red">{formatCurrency(debt.amount)}</p>
                          {overdue !== null && overdue > 0 && <p className="text-[10px] text-accent-red font-medium">{overdue} days overdue</p>}
                        </div>
                      </div>
                      {debt.description && <p className="text-xs text-muted-text mt-2">{debt.description}</p>}
                      {debt.due_date && <p className="text-xs text-muted-text mt-1 flex items-center gap-1"><CalendarDays size={10} />Due: {formatDate(debt.due_date)}</p>}
                    </div>
                    <div className="flex border-t border-ink/10">
                      <button onClick={() => setMarkingPaid(debt.id)} className="flex-1 py-2.5 text-micro text-accent-red hover:bg-warm-gray/30 transition-colors">{t('mark_paid')}</button>
                    </div>
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Paid debts */}
        {paidDebts.length > 0 && (
          <div className="mt-6">
            <p className="text-micro text-muted-text mb-3">{t('paid_debts')}</p>
            <div className="space-y-2">
              {paidDebts.slice(0, 5).map((debt) => (
                <div key={debt.id} className="bg-light/60 border border-ink/10 rounded-sm px-4 py-3 flex items-center justify-between opacity-60">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-accent-green" />
                    <span className="text-sm">{debt.person_name}</span>
                  </div>
                  <span className="font-display text-sm text-muted-text">{formatCurrency(debt.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Mark Paid Confirmation */}
      <AnimatePresence>
        {markingPaid && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-50" onClick={() => setMarkingPaid(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9, x: "-50%", y: "-50%" }} animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }} exit={{ opacity: 0, scale: 0.9, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm p-6 z-50 w-[85vw] max-w-sm">
              <p className="font-display text-lg text-ink uppercase text-center mb-4">{t('mark_as_paid')}</p>
              <p className="text-sm text-muted-text text-center mb-6">
                {state.debts.find((d) => d.id === markingPaid)?.person_name} - {formatCurrency(state.debts.find((d) => d.id === markingPaid)?.amount || 0)}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setMarkingPaid(null)} className="btn-tactile flex-1 h-12 bg-warm-gray font-display text-sm uppercase tracking-wider rounded-sm">{t('cancel')}</button>
                <button onClick={() => markingPaid && handleMarkPaid(markingPaid)} className="btn-tactile flex-1 h-12 bg-accent-green font-display text-sm uppercase tracking-wider text-white rounded-sm">{t('confirm')}</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Debt Sheet */}
      <AnimatePresence>
        {showAddDebt && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-50" onClick={() => setShowAddDebt(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 shadow-sheet flex flex-col" style={{ maxHeight: '92dvh' }}>
              <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink flex-shrink-0">
                <h2 className="font-display text-2xl text-ink uppercase tracking-tight">{t('debts')}</h2>
                <button onClick={() => setShowAddDebt(false)} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
                  <X size={20} strokeWidth={2.5} className="text-ink" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
                  <div>
                    <label className="text-micro text-muted-text mb-2 block">{t('type')}</label>
                    <div className="flex gap-2">
                      <button onClick={() => setNewDebt({ ...newDebt, type: 'owed' })}
                        className={`btn-tactile flex-1 py-3 font-display text-sm uppercase tracking-wider rounded-sm border-2 transition-colors ${newDebt.type === 'owed' ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                        {t('who_owe')}
                      </button>
                      <button onClick={() => setNewDebt({ ...newDebt, type: 'owing' })}
                        className={`btn-tactile flex-1 py-3 font-display text-sm uppercase tracking-wider rounded-sm border-2 transition-colors ${newDebt.type === 'owing' ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                        {t('i_owe')}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">{t('person_name')}</label>
                    <div className="relative">
                      <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
                      <input type="text" value={newDebt.person_name} onChange={(e) => setNewDebt({ ...newDebt, person_name: e.target.value })} placeholder="e.g. Auntie Yaa"
                        className="w-full h-12 pl-10 pr-4 bg-light harsh-border rounded-sm text-base font-body" />
                    </div>
                  </div>

                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">{t('phone_optional')}</label>
                    <div className="relative">
                      <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
                      <input type="tel" value={newDebt.phone} onChange={(e) => setNewDebt({ ...newDebt, phone: e.target.value })} placeholder="0244..."
                        className="w-full h-12 pl-10 pr-4 bg-light harsh-border rounded-sm text-base font-body" />
                    </div>
                  </div>

                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">{t('amount')} (GH₵)</label>
                    <input type="number" value={newDebt.amount} onChange={(e) => setNewDebt({ ...newDebt, amount: e.target.value })} placeholder="0.00"
                      className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body" />
                  </div>

                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">{t('description')}</label>
                    <input type="text" value={newDebt.description} onChange={(e) => setNewDebt({ ...newDebt, description: e.target.value })} placeholder="What is this for?"
                      className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body" />
                  </div>

                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">{t('due_date_optional')}</label>
                    <div className="relative">
                      <CalendarDays size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
                      <input type="date" value={newDebt.due_date} onChange={(e) => setNewDebt({ ...newDebt, due_date: e.target.value })}
                        className="w-full h-12 pl-10 pr-4 bg-light harsh-border rounded-sm text-base font-body" />
                    </div>
                  </div>
                </div>

                {/* Save button - STICKY AT BOTTOM */}
                <div className="px-5 pt-4 pb-24 bg-sand border-t-2 border-ink flex-shrink-0 mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
                  <button onClick={handleAddDebt} disabled={saving}
                    className="btn-tactile w-full h-14 bg-ink text-white font-display text-lg uppercase tracking-wider rounded-sm disabled:opacity-50">
                    {saving ? '...' : t('save_debt')}
                  </button>
                </div>
              </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
