import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Minus, Plus, Check, User, Phone } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, uid } from '@/lib/data'
import ProductIcon from './ProductIcon'

export default function AddSaleSheet() {
  const { state, dispatch, showToast, addSale } = useStore()
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'momo' | 'bank'>('cash')
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)

  const product = useMemo(
    () => state.products.find((p) => p.id === selectedProduct),
    [selectedProduct, state.products]
  )

  const total = product ? product.selling_price * quantity : 0
  const profit = product ? (product.selling_price - product.cost_price) * quantity : 0

  const recentProducts = state.products.slice(0, 8)

  const handleClose = () => {
    dispatch({ type: 'TOGGLE_ADD_SHEET', show: false })
    setSelectedProduct(null)
    setQuantity(1)
    setCustomerName('')
    setCustomerPhone('')
    setShowCustomerForm(false)
    setConfirmed(false)
  }

  const handleConfirm = async () => {
    if (!product) return

    setSaving(true)

    try {
      const saleData = {
        id: uid(),
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_price: product.selling_price,
        total,
        profit,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        payment_method: paymentMethod,
        created_at: new Date().toISOString(),
      }

      await addSale(saleData, product.id, quantity)

      setConfirmed(true)
      showToast('Sale recorded!', 'success')

      setTimeout(() => {
        handleClose()
      }, 1200)
    } catch {
      showToast('Failed to record sale', 'error')
    } finally {
      setSaving(false)
    }
  }

  const paymentOptions: { key: 'cash' | 'momo' | 'bank'; label: string }[] = [
    { key: 'cash', label: 'CASH' },
    { key: 'momo', label: 'MOMO' },
    { key: 'bank', label: 'BANK' },
  ]

  return (
    <AnimatePresence>
      {state.showAddSheet && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-50"
            onClick={handleClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 shadow-sheet"
            style={{ maxHeight: '90dvh' }}
          >
            {confirmed ? (
              <div className="flex flex-col items-center justify-center py-20 px-6">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 12 }}
                  className="w-20 h-20 rounded-full bg-accent-green flex items-center justify-center mb-6"
                >
                  <Check size={40} strokeWidth={3} className="text-white" />
                </motion.div>
                <p className="font-display text-2xl text-ink uppercase tracking-wide">Sale Recorded!</p>
                <p className="text-muted-text mt-2">{formatCurrency(total)} added</p>
                {customerPhone && <p className="text-xs text-accent-green mt-1">Receipt sent via SMS</p>}
              </div>
            ) : (
              <div className="flex flex-col h-full" style={{ maxHeight: '92dvh' }}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink flex-shrink-0">
                  <h2 className="font-display text-2xl text-ink uppercase tracking-tight">New Sale</h2>
                  <button onClick={handleClose} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
                    <X size={20} strokeWidth={2.5} className="text-ink" />
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-4 min-h-0">
                  {/* Product Grid */}
                  {!selectedProduct && (
                    <div className="mt-4">
                      <p className="text-micro text-muted-text mb-3">SELECT PRODUCT</p>
                      {recentProducts.length === 0 ? (
                        <div className="bg-light harsh-border rounded-sm p-8 text-center">
                          <p className="text-sm font-medium text-ink">No products found</p>
                          <p className="text-xs text-muted-text mt-1">Add products in Inventory first.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {recentProducts.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => setSelectedProduct(p.id)}
                              className="btn-tactile bg-light harsh-border rounded-sm p-3 flex flex-col items-center gap-2 active:bg-warm-gray"
                            >
                              <ProductIcon category={p.category} size={36} />
                              <span className="text-sm font-medium text-center leading-tight">{p.name}</span>
                              <span className="text-xs text-muted-text">{formatCurrency(p.selling_price)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Selected Product + Quantity */}
                  {selectedProduct && product && (
                    <div className="mt-4">
                      <button
                        onClick={() => setSelectedProduct(null)}
                        className="w-full bg-light harsh-border rounded-sm p-4 flex items-center gap-4 mb-4 text-left"
                      >
                        <ProductIcon category={product.category} size={40} />
                        <div className="flex-1">
                          <p className="font-display text-lg uppercase">{product.name}</p>
                          <p className="text-sm text-muted-text">{formatCurrency(product.selling_price)} each</p>
                        </div>
                        <span className="text-micro text-accent-red">CHANGE</span>
                      </button>

                      {/* Quantity Selector */}
                      <div className="bg-light harsh-border rounded-sm p-5 mb-4">
                        <p className="text-micro text-muted-text mb-3 text-center">QUANTITY</p>
                        <div className="flex items-center justify-center gap-6">
                          <button
                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                            className="btn-tactile w-14 h-14 bg-warm-gray flex items-center justify-center rounded-sm active:bg-muted-text"
                          >
                            <Minus size={24} strokeWidth={2.5} className="text-ink" />
                          </button>
                          <span className="font-display text-5xl text-ink w-16 text-center">
                            {quantity.toString().padStart(2, '0')}
                          </span>
                          <button
                            onClick={() => setQuantity(Math.min(product.quantity, quantity + 1))}
                            className="btn-tactile w-14 h-14 bg-warm-gray flex items-center justify-center rounded-sm active:bg-muted-text"
                          >
                            <Plus size={24} strokeWidth={2.5} className="text-ink" />
                          </button>
                        </div>
                        <p className="text-center text-xs text-muted-text mt-2">{product.quantity} in stock</p>
                      </div>

                      {/* Payment Method */}
                      <div className="mb-4">
                        <p className="text-micro text-muted-text mb-2">PAYMENT METHOD</p>
                        <div className="flex gap-2">
                          {paymentOptions.map((opt) => (
                            <button
                              key={opt.key}
                              onClick={() => setPaymentMethod(opt.key)}
                              className={`btn-tactile flex-1 py-3 font-display text-sm uppercase tracking-wider rounded-sm border-2 transition-colors ${
                                paymentMethod === opt.key
                                  ? 'bg-ink text-white border-ink'
                                  : 'bg-light text-ink border-ink'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Customer (optional) */}
                      <div className="mb-4">
                        <button
                          onClick={() => setShowCustomerForm(!showCustomerForm)}
                          className="flex items-center gap-2 text-micro text-muted-text"
                        >
                          <User size={14} />
                          {showCustomerForm ? 'HIDE CUSTOMER INFO' : 'ADD CUSTOMER (OPTIONAL)'}
                        </button>
                        {showCustomerForm && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            className="mt-3 space-y-3 overflow-hidden"
                          >
                            <div className="relative">
                              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
                              <input
                                type="text"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="Customer name"
                                className="w-full h-12 pl-10 pr-4 bg-light harsh-border rounded-sm text-base font-body"
                              />
                            </div>
                            <div className="relative">
                              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
                              <input
                                type="tel"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                placeholder="Phone number (for receipt)"
                                className="w-full h-12 pl-10 pr-4 bg-light harsh-border rounded-sm text-base font-body"
                              />
                            </div>
                          </motion.div>
                        )}
                      </div>

                      {/* Total Display */}
                      <div className="bg-ink rounded-sm p-5 mb-4">
                        <div className="flex justify-between items-baseline">
                          <span className="text-white/60 text-micro">TOTAL</span>
                          <span className="font-display text-3xl text-white">{formatCurrency(total)}</span>
                        </div>
                        <div className="flex justify-between items-baseline mt-1">
                          <span className="text-white/40 text-xs">PROFIT</span>
                          <span className="text-accent-green text-sm font-medium">+{formatCurrency(profit)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Save button */}
                  {selectedProduct && (
                    <div className="pt-4 pb-2">
                      <button
                        onClick={handleConfirm}
                        disabled={!selectedProduct || quantity < 1 || saving}
                        className="btn-tactile w-full h-14 bg-ink text-white font-display text-lg uppercase tracking-wider rounded-sm disabled:opacity-50"
                      >
                        {saving ? '...' : 'CONFIRM SALE'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
