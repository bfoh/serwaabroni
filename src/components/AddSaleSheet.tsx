import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Minus, Plus, Check, User, Phone, Trash2, ArrowLeft, ScanLine } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, uid } from '@/lib/data'
import ProductIcon from './ProductIcon'
import SaleScanner from './SaleScanner'

type CartItem = {
  product_id: string
  name: string
  category: string
  unit_price: number
  cost_price: number
  quantity: number
  stock: number
}

export default function AddSaleSheet() {
  const { state, dispatch, showToast, addSaleBatch, updateCustomer, addCustomer } = useStore()
  const [cart, setCart] = useState<CartItem[]>([])
  const [view, setView] = useState<'grid' | 'cart'>('grid')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'momo' | 'bank'>('cash')
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showScan, setShowScan] = useState(false)

  const total = useMemo(
    () => cart.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
    [cart]
  )
  const profit = useMemo(
    () => cart.reduce((sum, i) => sum + (i.unit_price - i.cost_price) * i.quantity, 0),
    [cart]
  )
  const itemCount = useMemo(
    () => cart.reduce((sum, i) => sum + i.quantity, 0),
    [cart]
  )

  const filteredProducts = useMemo(() => {
    let list = state.products
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q))
    }
    return list.slice(0, 20)
  }, [state.products, searchQuery])

  const handleClose = () => {
    dispatch({ type: 'TOGGLE_ADD_SHEET', show: false })
    setCart([])
    setView('grid')
    setCustomerName('')
    setCustomerPhone('')
    setShowCustomerForm(false)
    setConfirmed(false)
    setSearchQuery('')
    setPaymentMethod('cash')
  }

  // Add a product to the cart (or increment if already present), capped at stock.
  const addToCart = (productId: string) => {
    const p = state.products.find((x) => x.id === productId)
    if (!p) return
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === productId)
      if (existing) {
        return prev.map((i) =>
          i.product_id === productId
            ? { ...i, quantity: Math.min(i.stock, i.quantity + 1) }
            : i
        )
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          category: p.category,
          unit_price: p.selling_price,
          cost_price: p.cost_price,
          quantity: Math.min(1, p.quantity),
          stock: p.quantity,
        },
      ]
    })
    setView('cart')
  }

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev.map((i) =>
        i.product_id === productId
          ? { ...i, quantity: Math.max(1, Math.min(i.stock, i.quantity + delta)) }
          : i
      )
    )
  }

  const removeFromCart = (productId: string) => {
    setCart((prev) => {
      const next = prev.filter((i) => i.product_id !== productId)
      if (next.length === 0) setView('grid')
      return next
    })
  }

  const handleConfirm = async () => {
    if (cart.length === 0) return
    setSaving(true)
    try {
      const createdAt = new Date().toISOString()
      const groupId = uid()
      const sales = cart.map((i) => ({
        id: uid(),
        product_id: i.product_id,
        product_name: i.name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total: i.unit_price * i.quantity,
        profit: (i.unit_price - i.cost_price) * i.quantity,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        payment_method: paymentMethod,
        sale_group_id: groupId,
        created_at: createdAt,
      }))
      const items = cart.map((i) => ({ productId: i.product_id, qty: i.quantity }))

      await addSaleBatch(sales, items)

      if (customerName) {
        const existingCustomer = state.customers.find(
          (c) => c.name.toLowerCase() === customerName.trim().toLowerCase()
        )
        if (existingCustomer) {
          updateCustomer(existingCustomer.id, {
            total_purchases: (existingCustomer.total_purchases || 0) + total,
            phone: customerPhone || existingCustomer.phone,
          }).catch(() => {})
        } else {
          addCustomer({
            id: uid(),
            name: customerName.trim(),
            phone: customerPhone || null,
            email: null,
            total_purchases: total,
            created_at: new Date().toISOString(),
          }).catch(() => {})
        }
      }

      setConfirmed(true)
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
            className="fixed inset-0 bg-black/40 z-[60]"
            onClick={handleClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-[61] shadow-sheet"
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
                <p className="text-muted-text mt-2">
                  {formatCurrency(total)} · {itemCount} {itemCount === 1 ? 'item' : 'items'}
                </p>
                {customerPhone && <p className="text-xs text-accent-green mt-1">Receipt sent via SMS</p>}
              </div>
            ) : (
              <div className="flex flex-col h-full" style={{ maxHeight: '92dvh' }}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink flex-shrink-0">
                  <div className="flex items-center gap-3">
                    {view === 'grid' && cart.length > 0 && (
                      <button
                        onClick={() => setView('cart')}
                        className="btn-tactile w-11 h-11 flex items-center justify-center rounded-sm bg-warm-gray"
                      >
                        <ArrowLeft size={20} strokeWidth={2.5} className="text-ink" />
                      </button>
                    )}
                    <h2 className="font-display text-2xl text-ink uppercase tracking-tight">
                      {view === 'grid' ? 'Add Product' : 'New Sale'}
                    </h2>
                  </div>
                  <button onClick={handleClose} className="btn-tactile w-11 h-11 flex items-center justify-center rounded-sm bg-warm-gray">
                    <X size={20} strokeWidth={2.5} className="text-ink" />
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-4 min-h-0">
                  {/* Product Grid */}
                  {view === 'grid' && (
                    <div className="mt-4">
                      <div className="mb-4 flex gap-2">
                        <input
                          type="text"
                          placeholder="Search products..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="flex-1 h-12 px-4 bg-light harsh-border rounded-sm text-base font-body focus:outline-none focus:ring-2 focus:ring-ink"
                        />
                        <button
                          type="button"
                          onClick={() => setShowScan(true)}
                          aria-label="Scan barcode"
                          className="btn-tactile w-12 h-12 flex-shrink-0 bg-ink rounded-sm flex items-center justify-center"
                        >
                          <ScanLine size={22} className="text-white" />
                        </button>
                      </div>

                      {filteredProducts.length === 0 ? (
                        <div className="bg-light harsh-border rounded-sm p-8 text-center">
                          <p className="text-sm font-medium text-ink">No products found</p>
                          <p className="text-xs text-muted-text mt-1">Try another search or add products in Inventory.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 pb-6">
                          {filteredProducts.map((p) => {
                            const inCart = cart.find((i) => i.product_id === p.id)
                            return (
                              <button
                                key={p.id}
                                onClick={() => addToCart(p.id)}
                                disabled={p.quantity < 1}
                                className="btn-tactile relative bg-light harsh-border rounded-sm p-3 flex flex-col items-center gap-2 active:bg-warm-gray disabled:opacity-40"
                              >
                                {inCart && (
                                  <span className="absolute top-1 right-1 min-w-5 h-5 px-1 rounded-full bg-accent-red text-white text-xs font-bold flex items-center justify-center">
                                    {inCart.quantity}
                                  </span>
                                )}
                                <ProductIcon category={p.category} size={36} />
                                <span className="text-sm font-medium text-center leading-tight">{p.name}</span>
                                <span className="text-xs text-muted-text">{formatCurrency(p.selling_price)}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cart */}
                  {view === 'cart' && (
                    <div className="mt-4">
                      {/* Cart lines */}
                      <div className="space-y-3 mb-4">
                        {cart.map((i) => (
                          <div key={i.product_id} className="bg-light harsh-border rounded-sm p-3 flex items-center gap-3">
                            <ProductIcon category={i.category} size={32} />
                            <div className="flex-1 min-w-0">
                              <p className="font-display text-base uppercase truncate">{i.name}</p>
                              <p className="text-xs text-muted-text">
                                {formatCurrency(i.unit_price)} · {formatCurrency(i.unit_price * i.quantity)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => changeQty(i.product_id, -1)}
                                className="btn-tactile w-11 h-11 bg-warm-gray flex items-center justify-center rounded-sm"
                              >
                                <Minus size={16} strokeWidth={2.5} className="text-ink" />
                              </button>
                              <span className="font-display text-xl text-ink w-7 text-center">{i.quantity}</span>
                              <button
                                onClick={() => changeQty(i.product_id, 1)}
                                className="btn-tactile w-11 h-11 bg-warm-gray flex items-center justify-center rounded-sm"
                              >
                                <Plus size={16} strokeWidth={2.5} className="text-ink" />
                              </button>
                              <button
                                onClick={() => removeFromCart(i.product_id)}
                                className="btn-tactile w-11 h-11 flex items-center justify-center rounded-sm"
                              >
                                <Trash2 size={16} className="text-accent-red" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Add more / scan next */}
                      <div className="flex gap-2 mb-4">
                        <button
                          onClick={() => setView('grid')}
                          className="btn-tactile flex-1 py-3 bg-light harsh-border rounded-sm font-display text-sm uppercase tracking-wider text-ink flex items-center justify-center gap-2"
                        >
                          <Plus size={16} strokeWidth={2.5} /> Add More
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowScan(true)}
                          aria-label="Scan next product"
                          className="btn-tactile px-4 py-3 bg-ink rounded-sm font-display text-sm uppercase tracking-wider text-white flex items-center justify-center gap-2"
                        >
                          <ScanLine size={18} /> Scan
                        </button>
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
                            {state.customers.length > 0 && (
                              <div className="relative">
                                <select
                                  onChange={(e) => {
                                    if (!e.target.value) return
                                    const c = state.customers.find((c) => c.id === e.target.value)
                                    if (c) {
                                      setCustomerName(c.name)
                                      setCustomerPhone(c.phone || '')
                                    }
                                  }}
                                  className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body text-ink"
                                >
                                  <option value="">Select saved customer...</option>
                                  {state.customers.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              </div>
                            )}
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
                          <span className="text-white/60 text-micro">TOTAL · {itemCount} {itemCount === 1 ? 'ITEM' : 'ITEMS'}</span>
                          <span className="font-display text-3xl text-white">{formatCurrency(total)}</span>
                        </div>
                        <div className="flex justify-between items-baseline mt-1">
                          <span className="text-white/40 text-xs">PROFIT</span>
                          <span className="text-accent-green text-sm font-medium">+{formatCurrency(profit)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Save button - STICKY AT BOTTOM */}
                {view === 'cart' && cart.length > 0 && (
                  <div className="px-5 pt-4 pb-sheet bg-sand border-t-2 border-ink flex-shrink-0 mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
                    <button
                      onClick={handleConfirm}
                      disabled={cart.length === 0 || saving}
                      className="btn-tactile w-full h-14 bg-ink text-white font-display text-lg uppercase tracking-wider rounded-sm disabled:opacity-50"
                    >
                      {saving ? '...' : 'CONFIRM SALE'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>

          <SaleScanner
            isOpen={showScan}
            onClose={() => setShowScan(false)}
            onProductScanned={(p) => addToCart(p.id)}
            itemCount={itemCount}
            total={total}
          />
        </>
      )}
    </AnimatePresence>
  )
}
