import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Search, Users, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, uid } from '@/lib/data'

export default function Customers() {
  const { state, showToast, addCustomer } = useStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [adding, setAdding] = useState(false)

  const [newCustomer, setNewCustomer] = useState({
    name: '',
    phone: '',
    email: '',
  })

  const filteredCustomers = state.customers.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (c.phone && c.phone.includes(searchQuery))
  )

  const handleAddCustomer = async () => {
    if (!newCustomer.name) {
      showToast('Please enter customer name', 'error')
      return
    }

    setAdding(true)
    try {
      await addCustomer({
        id: uid(),
        name: newCustomer.name,
        phone: newCustomer.phone || null,
        email: newCustomer.email || null,
        total_purchases: 0,
        created_at: new Date().toISOString(),
      })
      showToast('Customer added!', 'success')
      setShowAddCustomer(false)
      setNewCustomer({ name: '', phone: '', email: '' })
    } catch {
      showToast('Failed to add customer', 'error')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="min-h-screen bg-sand pb-20">
      <header className="sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display text-2xl text-ink uppercase tracking-tight">Customers</h1>
          <button
            onClick={() => setShowAddCustomer(true)}
            className="btn-tactile w-10 h-10 bg-accent-red flex items-center justify-center rounded-sm"
          >
            <Plus size={20} strokeWidth={2.5} className="text-white" />
          </button>
        </div>

        <div className="relative mt-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search customers..."
            className="w-full h-10 pl-10 pr-4 bg-light harsh-border rounded-sm text-sm font-body"
          />
        </div>
      </header>

      <section className="px-5 pt-4 space-y-3">
        {filteredCustomers.length === 0 && (
          <div className="text-center py-12">
            <Users size={40} className="text-muted-text mx-auto mb-3" />
            <p className="text-muted-text text-sm">
              {searchQuery ? 'No customers found' : 'No customers yet'}
            </p>
          </div>
        )}
        {filteredCustomers.map((customer, index) => (
          <motion.div
            key={customer.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className="bg-light harsh-border rounded-sm p-4 flex items-center gap-4"
          >
            <div className="w-12 h-12 bg-warm-gray rounded-full flex items-center justify-center flex-shrink-0">
              <span className="font-display text-xl text-ink">
                {customer.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate text-ink">{customer.name}</p>
              {customer.phone && (
                <p className="text-xs text-muted-text mt-0.5">{customer.phone}</p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[10px] text-muted-text uppercase tracking-wider mb-0.5">Purchases</p>
              <p className="font-display text-base text-accent-green">
                {formatCurrency(customer.total_purchases)}
              </p>
            </div>
          </motion.div>
        ))}
      </section>

      <AnimatePresence>
        {showAddCustomer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => setShowAddCustomer(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 shadow-sheet"
              style={{ maxHeight: '90dvh' }}
            >
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink flex-shrink-0">
                  <h2 className="font-display text-2xl text-ink uppercase tracking-tight">New Customer</h2>
                  <button onClick={() => setShowAddCustomer(false)} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
                    <X size={20} strokeWidth={2.5} className="text-ink" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">CUSTOMER NAME *</label>
                    <input
                      type="text"
                      value={newCustomer.name}
                      onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                      placeholder="e.g. Auntie Ama"
                      className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body"
                    />
                  </div>

                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">PHONE NUMBER (OPTIONAL)</label>
                    <input
                      type="tel"
                      value={newCustomer.phone}
                      onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                      placeholder="024 XXX XXXX"
                      className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body"
                    />
                  </div>

                  <div className="pt-4 pb-2">
                    <button
                      onClick={handleAddCustomer}
                      disabled={!newCustomer.name || adding}
                      className="btn-tactile w-full h-14 bg-ink text-white font-display text-lg uppercase tracking-wider rounded-sm disabled:opacity-50"
                    >
                      {adding ? '...' : 'SAVE CUSTOMER'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
