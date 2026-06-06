import { useState } from 'react'
import { useNavigate } from 'react-router'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Phone, User, CalendarDays, CheckCircle, Send, Pencil, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatDate, uid, remainingAmount } from '@/lib/data'
import { sendNotification } from '@/services/notify'
import type { Debt, DebtPayment } from '@/lib/supabase'

type DebtTab = 'owed' | 'owing'

const colorFor = (tab: DebtTab) =>
  tab === 'owed'
    ? { amount: 'text-accent-green', avatar: 'bg-ink', bar: 'bg-accent-green', mark: 'text-accent-green' }
    : { amount: 'text-accent-red', avatar: 'bg-accent-red', bar: 'bg-accent-red', mark: 'text-accent-red' }

export default function Debts() {
  const { state, dispatch, showToast, t, addDebt, updateDebt, removeDebt } = useStore()
  const navigate = useNavigate()
  const [activeDebtTab, setActiveDebtTab] = useState<DebtTab>('owed')
  const [showAddDebt, setShowAddDebt] = useState(false)
  const [paymentDebtId, setPaymentDebtId] = useState<string | null>(null)
  const [paymentInput, setPaymentInput] = useState('')
  const [paymentInput, setPaymentInput] = useState('')
  const [saving, setSaving] = useState(false)
  
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null)
  const [editingPayment, setEditingPayment] = useState<{ debtId: string, index: number, amount: number } | null>(null)

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

  const totalOwed = owedDebts.reduce((s, d) => s + remainingAmount(d), 0)
  const totalOwing = owingDebts.reduce((s, d) => s + remainingAmount(d), 0)

  const paymentDebt = paymentDebtId ? state.debts.find((d) => d.id === paymentDebtId) : null

  const handleAddDebt = async () => {
    if (!newDebt.person_name || !newDebt.amount) {
      showToast('Please fill in name and amount', 'error')
      return
    }

    setSaving(true)

    setSaving(true)

    try {
      if (editingDebtId) {
        await updateDebt(editingDebtId, {
          person_name: newDebt.person_name,
          phone: newDebt.phone || null,
          amount: parseFloat(newDebt.amount),
          description: newDebt.description || null,
          type: newDebt.type,
          due_date: newDebt.due_date || null,
        })
        showToast('Debt updated!', 'success')
      } else {
        await addDebt({
          id: uid(),
        person_name: newDebt.person_name,
        phone: newDebt.phone || null,
        amount: parseFloat(newDebt.amount),
        amount_paid: 0,
        payments: [],
        description: newDebt.description || null,
        type: newDebt.type,
        due_date: newDebt.due_date || null,
        is_paid: false,
        paid_at: null,
        paid_at: null,
        created_at: new Date().toISOString(),
      })
        showToast('Debt recorded!', 'success')
      }
      setShowAddDebt(false)
      setEditingDebtId(null)
      setNewDebt({ person_name: '', phone: '', amount: '', description: '', type: 'owed', due_date: '' })
    } catch {
      showToast('Failed to save debt', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Apply a payment of `payAmount` toward a debt. Clamps to the remaining balance,
  // flips is_paid when the debt is fully settled, and adjusts running balances for
  // money owed to the user (the increment only, never the full debt).
  const recordPayment = async (debtId: string, payAmount: number) => {
    const debt = state.debts.find((d) => d.id === debtId)
    if (!debt) return

    const remaining = remainingAmount(debt)
    const pay = Math.min(payAmount, remaining)
    if (pay <= 0) return

    const newPaid = (debt.amount_paid || 0) + pay
    const fullyPaid = newPaid >= debt.amount - 0.001
    const now = new Date().toISOString()
    const newPayments: DebtPayment[] = [...(debt.payments || []), { amount: pay, date: now }]

    try {
      await updateDebt(debtId, {
        amount_paid: fullyPaid ? debt.amount : newPaid,
        payments: newPayments,
        is_paid: fullyPaid,
        paid_at: fullyPaid ? now : null,
      })

      if (debt.type === 'owed') {
        dispatch({ type: 'SET_BALANCE', value: state.balance + pay })
        dispatch({ type: 'SET_PENDING_DEBTS', value: Math.max(0, state.pendingDebts - pay) })
      }

      showToast(fullyPaid ? `${debt.person_name} marked as paid!` : t('payment_recorded'), 'success')
    } catch {
      showToast('Failed to record payment', 'error')
    }
  }

  const handleDeleteDebt = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Are you sure you want to delete this debt?')) {
      await removeDebt(id)
    }
  }

  const handleEditDebtClick = (debt: Debt, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingDebtId(debt.id)
    setNewDebt({
      person_name: debt.person_name,
      phone: debt.phone || '',
      amount: String(debt.amount),
      description: debt.description || '',
      type: debt.type,
      due_date: debt.due_date || '',
    })
    setShowAddDebt(true)
  }

  const handleDeletePayment = async (debt: Debt, index: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this payment?')) return
    
    const p = debt.payments![index]
    const newPayments = [...debt.payments!]
    newPayments.splice(index, 1)
    
    const newPaid = Math.max(0, (debt.amount_paid || 0) - p.amount)
    const fullyPaid = newPaid >= debt.amount - 0.001
    
    try {
      await updateDebt(debt.id, {
        amount_paid: newPaid,
        payments: newPayments,
        is_paid: fullyPaid,
        paid_at: fullyPaid ? debt.paid_at : null,
      })
      if (debt.type === 'owed') {
        dispatch({ type: 'SET_BALANCE', value: state.balance - p.amount })
        dispatch({ type: 'SET_PENDING_DEBTS', value: state.pendingDebts + p.amount })
      }
      showToast('Payment deleted', 'success')
    } catch {
      showToast('Failed to delete payment', 'error')
    }
  }
  
  const handleEditPaymentClick = (debt: Debt, index: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingPayment({ debtId: debt.id, index, amount: debt.payments![index].amount })
  }

  const submitEditPayment = async () => {
    if (!editingPayment) return
    const debt = state.debts.find(d => d.id === editingPayment.debtId)
    if (!debt) return
    
    const oldP = debt.payments![editingPayment.index]
    const diff = editingPayment.amount - oldP.amount
    
    const newPayments = [...debt.payments!]
    newPayments[editingPayment.index] = { ...oldP, amount: editingPayment.amount }
    
    const newPaid = Math.max(0, (debt.amount_paid || 0) + diff)
    const fullyPaid = newPaid >= debt.amount - 0.001

    try {
      await updateDebt(debt.id, {
        amount_paid: fullyPaid ? debt.amount : newPaid,
        payments: newPayments,
        is_paid: fullyPaid,
        paid_at: fullyPaid ? new Date().toISOString() : null,
      })
      if (debt.type === 'owed') {
        dispatch({ type: 'SET_BALANCE', value: state.balance + diff })
        dispatch({ type: 'SET_PENDING_DEBTS', value: Math.max(0, state.pendingDebts - diff) })
      }
      showToast('Payment updated', 'success')
      setEditingPayment(null)
    } catch {
      showToast('Failed to update payment', 'error')
    }
  }

  const handleMarkPaid = (debtId: string) => {
    const debt = state.debts.find((d) => d.id === debtId)
    if (!debt) return
    recordPayment(debtId, remainingAmount(debt))
  }

  const handleRemind = async (debt: Debt) => {
    if (!debt.phone) {
      showToast('No phone number for this debtor', 'error')
      return
    }
    const ok = await sendNotification({
      type: 'debt_reminder',
      data: {
        businessName: state.businessProfile?.business_name || 'Your vendor',
        ownerName: state.businessProfile?.owner_name,
        personName: debt.person_name,
        amount: remainingAmount(debt),
        dueDate: debt.due_date ? formatDate(debt.due_date) : undefined,
      },
      phoneTo: debt.phone,
      refId: debt.id,
    })
    showToast(ok ? `Reminder sent to ${debt.person_name}` : 'Could not send reminder', ok ? 'success' : 'error')
  }

  const openPayment = (debtId: string) => {
    setPaymentInput('')
    setPaymentDebtId(debtId)
  }

  const submitPayment = () => {
    if (!paymentDebt) return
    const amt = parseFloat(paymentInput)
    if (!amt || amt <= 0) {
      showToast(t('enter_valid_amount'), 'error')
      return
    }
    if (amt > remainingAmount(paymentDebt) + 0.001) {
      showToast(t('payment_exceeds'), 'error')
      return
    }
    recordPayment(paymentDebt.id, amt)
    setPaymentDebtId(null)
    setPaymentInput('')
  }

  const getDaysOverdue = (dueDate: string | null) => {
    if (!dueDate) return null
    const due = new Date(dueDate)
    const now = new Date()
    const diff = Math.ceil((now.getTime() - due.getTime()) / 86400000)
    return diff > 0 ? diff : 0
  }

  const renderDebtCard = (debt: Debt, index: number, tab: DebtTab) => {
    const c = colorFor(tab)
    const overdue = getDaysOverdue(debt.due_date)
    const paid = debt.amount_paid || 0
    const remaining = remainingAmount(debt)
    const pct = debt.amount > 0 ? Math.min(100, (paid / debt.amount) * 100) : 0

    return (
      <motion.div key={debt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
        className={`bg-light harsh-border rounded-sm overflow-hidden ${overdue && overdue > 0 ? 'border-l-4 border-l-accent-red' : ''}`}>
        <div className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${c.avatar} flex items-center justify-center flex-shrink-0`}>
                <span className="font-display text-sm text-white">{debt.person_name.charAt(0).toUpperCase()}</span>
              </div>
              <div>
                <p className="font-medium text-sm">{debt.person_name}</p>
                {debt.phone && <p className="text-xs text-muted-text flex items-center gap-1"><Phone size={10} />{debt.phone}</p>}
              </div>
            </div>
            <div className="text-right">
              <div className="flex justify-end gap-1.5 mb-1 opacity-60">
                <button onClick={(e) => handleEditDebtClick(debt, e)} className="p-1 hover:bg-ink/10 rounded-sm" aria-label="Edit debt"><Pencil size={12} /></button>
                <button onClick={(e) => handleDeleteDebt(debt.id, e)} className="p-1 hover:bg-accent-red/10 text-accent-red rounded-sm" aria-label="Delete debt"><Trash2 size={12} /></button>
              </div>
              <p className={`font-display text-lg ${c.amount}`}>{formatCurrency(remaining)}</p>
              {paid > 0 && (
                <p className="text-[10px] text-muted-text">{t('paid_label')} {formatCurrency(paid)} {t('of_total')} {formatCurrency(debt.amount)}</p>
              )}
              {overdue !== null && overdue > 0 && <p className="text-[10px] text-accent-red font-medium">{overdue} days overdue</p>}
            </div>
          </div>
          {debt.description && <p className="text-xs text-muted-text mt-2">{debt.description}</p>}
          {debt.due_date && <p className="text-xs text-muted-text mt-1 flex items-center gap-1"><CalendarDays size={10} />Due: {formatDate(debt.due_date)}</p>}
          {paid > 0 && (
            <div className="mt-3 h-1.5 bg-warm-gray rounded-full overflow-hidden">
              <div className={`h-full ${c.bar} transition-all`} style={{ width: `${pct}%` }} />
            </div>
          )}
          {debt.payments && debt.payments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-ink/5">
              <p className="text-[10px] text-muted-text uppercase tracking-wider mb-1.5">{t('payment_history')}</p>
              <div className="space-y-1">
                {debt.payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-0.5">
                    <span className="text-muted-text flex items-center gap-1"><CalendarDays size={10} />{formatDate(p.date)}</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-display ${c.amount}`}>{formatCurrency(p.amount)}</span>
                      <button onClick={(e) => handleEditPaymentClick(debt, i, e)} className="text-gray-400 hover:text-ink"><Pencil size={10}/></button>
                      <button onClick={(e) => handleDeletePayment(debt, i, e)} className="text-gray-400 hover:text-accent-red"><Trash2 size={10}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex border-t border-ink/10">
          {tab === 'owed' && debt.phone && (
            <button onClick={() => handleRemind(debt)} className="flex-1 py-2.5 text-micro text-ink hover:bg-warm-gray/30 transition-colors flex items-center justify-center gap-1"><Send size={11} />{t('remind')}</button>
          )}
          <button onClick={() => openPayment(debt.id)} className="flex-1 py-2.5 text-micro text-ink border-l border-ink/10 hover:bg-warm-gray/30 transition-colors">{t('record_payment')}</button>
          <button onClick={() => handleMarkPaid(debt.id)} className={`flex-1 py-2.5 text-micro ${c.mark} border-l border-ink/10 hover:bg-warm-gray/30 transition-colors`}>{t('mark_paid')}</button>
        </div>
      </motion.div>
    )
  }

  return (
    <div className="min-h-screen bg-sand pb-20">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3 pt-safe">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display text-2xl text-ink uppercase tracking-tight">{t('debts')}</h1>
          <button
            onClick={() => {
              setEditingDebtId(null)
              setNewDebt({ person_name: '', phone: '', amount: '', description: '', type: 'owed', due_date: '' })
              setShowAddDebt(true)
            }}
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
          <button
            onClick={() => navigate('/capital')}
            className="flex-1 py-2.5 font-display text-sm uppercase tracking-wider text-muted-text transition-colors"
          >
            Capital →
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
              {owedDebts.map((debt, index) => renderDebtCard(debt, index, 'owed'))}
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
              {owingDebts.map((debt, index) => renderDebtCard(debt, index, 'owing'))}
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

      {/* Record Payment Sheet */}
      <AnimatePresence>
        {paymentDebt && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-50" onClick={() => setPaymentDebtId(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9, x: "-50%", y: "-50%" }} animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }} exit={{ opacity: 0, scale: 0.9, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm p-6 z-50 w-[85vw] max-w-sm">
              <p className="font-display text-lg text-ink uppercase text-center mb-1">{t('record_payment_title')}</p>
              <p className="text-sm text-muted-text text-center mb-4">{paymentDebt.person_name}</p>

              <div className="flex justify-between text-xs text-muted-text mb-2">
                <span>{t('remaining_label')}</span>
                <span className="font-display text-ink">{formatCurrency(remainingAmount(paymentDebt))}</span>
              </div>

              <label className="text-micro text-muted-text mb-1.5 block">{t('payment_amount')} (GH₵)</label>
              <input
                type="number"
                inputMode="decimal"
                autoFocus
                value={paymentInput}
                onChange={(e) => setPaymentInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitPayment()}
                placeholder="0.00"
                className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body mb-2"
              />
              <button
                onClick={() => setPaymentInput(String(remainingAmount(paymentDebt)))}
                className="text-micro text-accent-green mb-5"
              >
                {t('pay_full')} ({formatCurrency(remainingAmount(paymentDebt))})
              </button>

              <div className="flex gap-3">
                <button onClick={() => setPaymentDebtId(null)} className="btn-tactile flex-1 h-12 bg-warm-gray font-display text-sm uppercase tracking-wider rounded-sm">{t('cancel')}</button>
                <button onClick={submitPayment} className="btn-tactile flex-1 h-12 bg-accent-green font-display text-sm uppercase tracking-wider text-white rounded-sm">{t('confirm')}</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Edit Payment Sheet */}
      <AnimatePresence>
        {editingPayment && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-50" onClick={() => setEditingPayment(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9, x: "-50%", y: "-50%" }} animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }} exit={{ opacity: 0, scale: 0.9, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm p-6 z-50 w-[85vw] max-w-sm">
              <p className="font-display text-lg text-ink uppercase text-center mb-4">Edit Payment</p>

              <label className="text-micro text-muted-text mb-1.5 block">{t('payment_amount')} (GH₵)</label>
              <input
                type="number"
                inputMode="decimal"
                autoFocus
                value={editingPayment.amount || ''}
                onChange={(e) => setEditingPayment({ ...editingPayment, amount: parseFloat(e.target.value) || 0 })}
                onKeyDown={(e) => e.key === 'Enter' && submitEditPayment()}
                placeholder="0.00"
                className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body mb-5"
              />

              <div className="flex gap-3">
                <button onClick={() => setEditingPayment(null)} className="btn-tactile flex-1 h-12 bg-warm-gray font-display text-sm uppercase tracking-wider rounded-sm">{t('cancel')}</button>
                <button onClick={submitEditPayment} className="btn-tactile flex-1 h-12 bg-ink font-display text-sm uppercase tracking-wider text-white rounded-sm">Save</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add/Edit Debt Sheet */}
      <AnimatePresence>
        {showAddDebt && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-50" onClick={() => setShowAddDebt(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 shadow-sheet flex flex-col" style={{ maxHeight: '92dvh' }}>
              <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink flex-shrink-0">
                <h2 className="font-display text-2xl text-ink uppercase tracking-tight">{editingDebtId ? 'Edit Debt' : t('debts')}</h2>
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
                <div className="px-5 pt-4 pb-sheet bg-sand border-t-2 border-ink flex-shrink-0 mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
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
