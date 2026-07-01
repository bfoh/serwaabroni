import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Minus, Search, Package, X, Mic, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, uid, loadData } from '@/lib/data'
import type { Product, Debt } from '@/lib/supabase'
import type { InjectionStockSummary } from '@/lib/capitalStock'
import ProductIcon from '@/components/ProductIcon'
import { formatStock } from '@/lib/units'

export default function Inventory() {
  const { state, dispatch, showToast, t, addProduct, updateProduct, removeProduct, addDebt } = useStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<string | null>(null)
  const [editQty, setEditQty] = useState(0)
  const [restockUnitCost, setRestockUnitCost] = useState('')
  const [restockInjectionId, setRestockInjectionId] = useState<string>('')
  const [restockPayFrom, setRestockPayFrom] = useState<'cash' | 'bank'>('cash')
  const [restockUnpaid, setRestockUnpaid] = useState(false)
  const [supplierName, setSupplierName] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [addProductInjectionId, setAddProductInjectionId] = useState<string>('')
  const [addPayFrom, setAddPayFrom] = useState<'cash' | 'bank'>('cash')
  const [addUnpaid, setAddUnpaid] = useState(false)
  const [addSupplierName, setAddSupplierName] = useState('')
  const [addSupplierPhone, setAddSupplierPhone] = useState('')
  const [activeInjections, setActiveInjections] = useState<{ id: string; lender_name: string | null; source: string }[]>([])
  const [allInjections, setAllInjections] = useState<{ id: string; lender_name: string | null; source: string; status: string }[]>([])
  const [filterInjectionId, setFilterInjectionId] = useState<string>('')
  const [injectionSummary, setInjectionSummary] = useState<InjectionStockSummary | null>(null)
  const [addingProduct, setAddingProduct] = useState(false)

  // Inline edit state
  const [inlineEditId, setInlineEditId] = useState<string | null>(null)
  const [inlineEditName, setInlineEditName] = useState('')
  const [inlineEditCost, setInlineEditCost] = useState('')
  const [inlineEditPrice, setInlineEditPrice] = useState('')
  const [inlineEditQty, setInlineEditQty] = useState('')
  const [inlineEditUnit, setInlineEditUnit] = useState('')
  const [inlineEditCategory, setInlineEditCategory] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [deletingProduct, setDeletingProduct] = useState(false)

  const [newProduct, setNewProduct] = useState({
    name: '',
    cost_price: '',
    selling_price: '',
    quantity: '',
    unit: 'piece',
    category: 'Groceries',
    multiUnit: false,
    packUnit: 'box',
    unitsPerPack: '',
    qtyUnitKind: 'base' as 'pack' | 'base',
  })

  // Seed data on first visit if store is empty
  useEffect(() => {
    if (state.products.length === 0) {
      const data = loadData()
      if (data.products.length > 0) {
        data.products.forEach((p) => {
          dispatch({ type: 'ADD_PRODUCT', product: p })
        })
      }
    }
  }, [state.products.length, dispatch])

  // Load active capital injections so restock can be tagged to its funding source.
  useEffect(() => {
    import('@/services/capitalApi').then(({ fetchInjections }) =>
      fetchInjections().then((list) => {
        setAllInjections(list.map(i => ({ id: i.id, lender_name: i.lender_name, source: i.source, status: i.status })))
        setActiveInjections(
          list.filter((i) => i.status !== 'repaid').map((i) => ({ id: i.id, lender_name: i.lender_name, source: i.source }))
        )
      }).catch(() => {})
    )
  }, [])

  useEffect(() => {
    if (!filterInjectionId) {
      setInjectionSummary(null)
      return
    }
    setInjectionSummary(null) // Reset while loading
    import('@/services/capitalApi').then(({ fetchInjectionStockSummary }) =>
      fetchInjectionStockSummary(filterInjectionId).then(setInjectionSummary).catch(() => {})
    )
  }, [filterInjectionId])

  const baseFilteredProducts = state.products.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredProducts = filterInjectionId && injectionSummary
    ? baseFilteredProducts.filter(p => injectionSummary.rows.some(r => r.product_id === p.id))
    : baseFilteredProducts

  const totalStockValue = filterInjectionId && injectionSummary 
    ? injectionSummary.totalCost 
    : state.products.reduce((s, p) => s + p.cost_price * p.quantity, 0)

  const projectedProfit = filterInjectionId && injectionSummary 
    ? injectionSummary.projectedProfit 
    : state.products.reduce((s, p) => s + (p.selling_price - p.cost_price) * p.quantity, 0)

  const itemsCount = filterInjectionId && injectionSummary
    ? injectionSummary.rows.length
    : state.products.length

  const handleAddProduct = async () => {
    if (!newProduct.name || !newProduct.cost_price || !newProduct.selling_price || !newProduct.quantity) {
      showToast(t('fill_fields') || 'Please fill all fields', 'error')
      return
    }

    const costPrice = parseFloat(newProduct.cost_price)
    const sellingPrice = parseFloat(newProduct.selling_price)
    const qty = parseInt(newProduct.quantity)

    if (sellingPrice <= costPrice) {
      showToast('Selling price must be higher than cost price', 'error')
      return
    }
    const factor = newProduct.multiUnit ? parseInt(newProduct.unitsPerPack) : 1
    if (newProduct.multiUnit && (!Number.isInteger(factor) || factor < 2 || !newProduct.packUnit.trim())) {
      showToast('For pack products set a pack name and units-per-pack of 2 or more', 'error')
      return
    }
    const baseQty = newProduct.qtyUnitKind === 'pack' ? qty * factor : qty
    if (addUnpaid && !addSupplierName.trim()) {
      showToast('Supplier name required for supplier credit', 'error')
      return
    }

    setAddingProduct(true)

    try {
      await addProduct({
        id: uid(),
        name: newProduct.name,
        cost_price: costPrice,
        selling_price: sellingPrice,
        quantity: baseQty,
        unit: newProduct.unit,
        pack_unit: newProduct.multiUnit ? newProduct.packUnit.trim() : null,
        units_per_pack: factor,
        category: newProduct.category,
        low_stock_threshold: Math.max(3, Math.floor(baseQty * 0.2)),
        barcode: null,
        qr_code: null,
        created_at: new Date().toISOString(),
      }, addProductInjectionId || null, { account: addPayFrom, unpaid: addUnpaid })
      // Supplier credit → record what you owe the supplier as an "I owe them" debt.
      if (addUnpaid) {
        const cost = Math.round(costPrice * baseQty * 100) / 100
        await addDebt({
          id: uid(),
          person_name: addSupplierName.trim(),
          phone: addSupplierPhone || null,
          amount: cost,
          amount_paid: 0,
          payments: [],
          description: `Stock: ${newProduct.name} (${baseQty} ${newProduct.unit})`,
          type: 'owing',
          due_date: null,
          injection_id: null,
          sale_group_id: null,
          is_paid: false,
          paid_at: null,
          created_at: new Date().toISOString(),
        } as Omit<Debt, 'user_id'>)
      }
      showToast(addUnpaid ? `Product added — owe ${addSupplierName.trim()}` : (t('product_added') || 'Product added!'), 'success')
      setShowAddProduct(false)
      setNewProduct({ name: '', cost_price: '', selling_price: '', quantity: '', unit: 'piece', category: 'Groceries', multiUnit: false, packUnit: 'box', unitsPerPack: '', qtyUnitKind: 'base' })
      setAddProductInjectionId('')
      setAddPayFrom('cash')
      setAddUnpaid(false)
      setAddSupplierName('')
      setAddSupplierPhone('')
    } catch {
      showToast('Failed to add product', 'error')
    } finally {
      setAddingProduct(false)
    }
  }

  const handleRestock = (productId: string) => {
    const product = state.products.find((p) => p.id === productId)
    if (!product) return
    setEditingProduct(productId)
    setEditQty(0)
    setRestockUnitCost(String(product.cost_price))
  }

  const handleSaveRestock = async () => {
    const product = state.products.find((p) => p.id === editingProduct)
    if (!product || editQty <= 0) {
      setEditingProduct(null)
      return
    }
    if (restockUnpaid && !supplierName.trim()) {
      showToast('Supplier name required for supplier credit', 'error')
      return
    }
    const unitCost = parseFloat(restockUnitCost) || product.cost_price
    const newQty = product.quantity + editQty
    const updated = { ...product, quantity: newQty, updated_at: new Date().toISOString() }
    // Optimistic cache bump.
    dispatch({ type: 'UPDATE_PRODUCT', product: updated })
    updateProduct(product.id, { quantity: newQty }).catch(() => {})
    // Create the costed batch (online; offline restock still bumps the cache above).
    try {
      const { receiveStock } = await import('@/services/batchApi')
      await receiveStock({ productId: product.id, qty: editQty, unitCost, injectionId: restockInjectionId || null, account: restockPayFrom, unpaid: restockUnpaid })
    } catch {
      /* offline or error — cache already bumped; batch can be reconciled later */
    }
    // Supplier credit → record what you owe the supplier as an "I owe them" debt.
    if (restockUnpaid) {
      const cost = Math.round(unitCost * editQty * 100) / 100
      await addDebt({
        id: uid(),
        person_name: supplierName.trim(),
        phone: supplierPhone || null,
        amount: cost,
        amount_paid: 0,
        payments: [],
        description: `Stock: ${product.name} (${editQty} ${product.unit})`,
        type: 'owing',
        due_date: null,
        injection_id: null,
        sale_group_id: null,
        is_paid: false,
        paid_at: null,
        created_at: new Date().toISOString(),
      } as Omit<Debt, 'user_id'>)
    }
    showToast(restockUnpaid ? `Restocked — owe ${supplierName.trim()}` : `Restocked ${editQty} ${product.unit}(s)`, 'success')
    setEditingProduct(null)
    setEditQty(0)
    setRestockUnitCost('')
    setRestockInjectionId('')
    setRestockPayFrom('cash')
    setRestockUnpaid(false)
    setSupplierName('')
    setSupplierPhone('')
  }

  const handleOpenEdit = (productId: string) => {
    const product = state.products.find((p) => p.id === productId)
    if (!product) return
    setInlineEditId(product.id)
    setInlineEditName(product.name)
    setInlineEditCost(String(product.cost_price))
    setInlineEditPrice(String(product.selling_price))
    setInlineEditQty(String(product.quantity))
    setInlineEditUnit(product.unit || 'piece')
    setInlineEditCategory(product.category || 'Groceries')
  }

  const handleSaveEdit = async () => {
    if (!inlineEditId) return
    if (!inlineEditName || !inlineEditCost || !inlineEditPrice || !inlineEditQty) {
      showToast('Please fill all fields', 'error')
      return
    }

    const costPrice = parseFloat(inlineEditCost)
    const sellingPrice = parseFloat(inlineEditPrice)
    const qty = parseInt(inlineEditQty)

    if (sellingPrice <= costPrice) {
      showToast('Selling price must be higher than cost price', 'error')
      return
    }

    setSavingEdit(true)

    try {
      const original = state.products.find((p) => p.id === inlineEditId)
      if (!original) {
        showToast('Product not found', 'error')
        setSavingEdit(false)
        return
      }

      const updated: Product = {
        ...original,
        name: inlineEditName,
        cost_price: costPrice,
        selling_price: sellingPrice,
        quantity: qty,
        unit: inlineEditUnit,
        category: inlineEditCategory,
        updated_at: new Date().toISOString(),
      }

      dispatch({ type: 'UPDATE_PRODUCT', product: updated })
      updateProduct(inlineEditId, {
        name: inlineEditName,
        cost_price: costPrice,
        selling_price: sellingPrice,
        quantity: qty,
        unit: inlineEditUnit,
        category: inlineEditCategory,
      }).catch(() => {})

      showToast('Product updated!', 'success')
      setInlineEditId(null)
    } catch {
      showToast('Failed to update product', 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async (productId: string) => {
    setDeletingProduct(true)
    try {
      dispatch({ type: 'DELETE_PRODUCT', id: productId })
      removeProduct(productId).catch(() => {})
      setShowDeleteConfirm(null)
    } catch {
      showToast('Failed to delete', 'error')
    } finally {
      setDeletingProduct(false)
    }
  }

  const categories = ['Groceries', 'Dairy', 'Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles', 'Bakery']

  return (
    <div className="min-h-screen bg-sand pb-20">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3 pt-safe">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display text-2xl text-ink uppercase tracking-tight">{t('my_stock')}</h1>
          <button
            onClick={() => setShowAddProduct(true)}
            className="btn-tactile w-10 h-10 bg-accent-red flex items-center justify-center rounded-sm"
          >
            <Plus size={20} strokeWidth={2.5} className="text-white" />
          </button>
        </div>

        {/* Summary cards */}
        <div className="flex gap-2">
          <div className="flex-1 bg-ink rounded-sm px-3 py-2">
            <p className="text-[10px] text-white/50 uppercase">{filterInjectionId ? 'Cost (loan)' : t('stock_value')}</p>
            <p className="font-display text-sm text-white">
              {filterInjectionId && !injectionSummary ? '...' : formatCurrency(totalStockValue)}
            </p>
          </div>
          <div className="flex-1 bg-accent-green rounded-sm px-3 py-2">
            <p className="text-[10px] text-white/50 uppercase">{filterInjectionId ? 'Proj. profit' : t('proj_profit')}</p>
            <p className="font-display text-sm text-white">
              {filterInjectionId && !injectionSummary ? '...' : formatCurrency(projectedProfit)}
            </p>
            {filterInjectionId && injectionSummary && (
              <p className="text-[9px] text-white/80 leading-none mt-1">
                realized {formatCurrency(injectionSummary.realizedProfit)} · left {formatCurrency(injectionSummary.remainingProfit)}
              </p>
            )}
          </div>
          <div className="flex-1 bg-warm-gray rounded-sm px-3 py-2">
            <p className="text-[10px] text-ink/50 uppercase">{t('items')}</p>
            <p className="font-display text-sm text-ink">
              {filterInjectionId && !injectionSummary ? '...' : itemsCount}
            </p>
          </div>
        </div>

        {filterInjectionId && injectionSummary && (
          <p className="text-xs text-muted-text mt-2 mb-1">
            Showing stock bought with {allInjections.find(i => i.id === filterInjectionId)?.lender_name || allInjections.find(i => i.id === filterInjectionId)?.source}
          </p>
        )}

        {/* Search */}
        <div className="relative mt-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_products')}
            className="w-full h-10 pl-10 pr-10 bg-light harsh-border rounded-sm text-sm font-body"
          />
          <button className="absolute right-3 top-1/2 -translate-y-1/2">
            <Mic size={14} className="text-muted-text" />
          </button>
        </div>

        {/* Filter Dropdown */}
        {allInjections.length > 0 && (
          <div className="mt-2">
            <select
              value={filterInjectionId}
              onChange={(e) => setFilterInjectionId(e.target.value)}
              className="w-full h-10 px-3 bg-white harsh-border rounded-sm text-sm font-body text-ink"
            >
              <option value="">All stock</option>
              {allInjections.map(i => (
                <option key={i.id} value={i.id}>
                  {i.lender_name || i.source} {i.status === 'repaid' ? '(repaid)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {/* Product List */}
      <section className="px-5 pt-4 space-y-3">
        {filteredProducts.length === 0 && (
          <div className="text-center py-12">
            <Package size={40} className="text-muted-text mx-auto mb-3" />
            <p className="text-muted-text text-sm">
              {searchQuery ? 'No products found' : 'No products yet'}
            </p>
          </div>
        )}
        {filteredProducts.map((product, index) => (
          <motion.div
            key={product.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className="bg-light harsh-border rounded-sm overflow-hidden"
          >
            {inlineEditId === product.id ? (
              /* Inline Edit Form */
              <div className="p-3 space-y-2">
                <input
                  type="text"
                  value={inlineEditName}
                  onChange={(e) => setInlineEditName(e.target.value)}
                  className="w-full h-8 px-2.5 bg-white harsh-border rounded-sm text-sm font-body"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    value={inlineEditCost}
                    onChange={(e) => setInlineEditCost(e.target.value)}
                    className="w-full h-8 px-2.5 bg-white harsh-border rounded-sm text-sm font-body"
                    placeholder="Cost"
                  />
                  <input
                    type="number"
                    value={inlineEditPrice}
                    onChange={(e) => setInlineEditPrice(e.target.value)}
                    className="w-full h-8 px-2.5 bg-white harsh-border rounded-sm text-sm font-body"
                    placeholder="Price"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    value={inlineEditQty}
                    onChange={(e) => setInlineEditQty(e.target.value)}
                    className="w-full h-8 px-2.5 bg-white harsh-border rounded-sm text-sm font-body"
                    placeholder="Qty"
                  />
                  <select
                    value={inlineEditUnit}
                    onChange={(e) => setInlineEditUnit(e.target.value)}
                    className="w-full h-8 px-2.5 bg-white harsh-border rounded-sm text-sm font-body"
                  >
                    <option value="piece">Pc</option>
                    <option value="tin">Tin</option>
                    <option value="bag">Bag</option>
                    <option value="bottle">Btl</option>
                    <option value="pack">Pack</option>
                    <option value="loaf">Loaf</option>
                    <option value="kg">Kg</option>
                  </select>
                  <select
                    value={inlineEditCategory}
                    onChange={(e) => setInlineEditCategory(e.target.value)}
                    className="w-full h-8 px-2.5 bg-white harsh-border rounded-sm text-sm font-body"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setInlineEditId(null)}
                    className="flex-1 h-9 bg-warm-gray rounded-sm font-display text-xs text-ink uppercase tracking-wider"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    className="flex-1 h-9 bg-ink rounded-sm font-display text-xs text-white uppercase tracking-wider disabled:opacity-50"
                  >
                    {savingEdit ? '...' : 'SAVE'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 flex items-center gap-3">
                  <div className="w-12 h-12 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
                    <ProductIcon category={product.category} size={28} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{product.name}</p>
                      {product.quantity <= product.low_stock_threshold && (
                        <span className="text-[10px] bg-accent-red text-white px-1.5 py-0.5 rounded-sm font-display">{t('low')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-text">{formatStock(product)}</span>
                      <span className="text-xs text-accent-green">{formatCurrency(product.selling_price)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-muted-text">{t('cost')}</p>
                    <p className="font-display text-sm">{formatCurrency(product.cost_price)}</p>
                  </div>
                </div>

                {/* Profit bar */}
                <div className="px-4 pb-3">
                  <div className="flex items-center justify-between text-[10px] text-muted-text mb-1">
                    <span>Profit per unit</span>
                    <span className="text-accent-green font-medium">
                      {formatCurrency(product.selling_price - product.cost_price)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-warm-gray rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{
                        width: `${Math.min(100, ((product.selling_price - product.cost_price) / product.cost_price) * 100)}%`,
                      }}
                      transition={{ duration: 0.5, delay: index * 0.05 }}
                      className="h-full bg-accent-green rounded-full"
                    />
                  </div>
                </div>

                {/* Action buttons row: Re-stock | Edit | Delete */}
                {editingProduct === product.id ? (
                  <div className="border-t-2 border-ink px-4 py-3 bg-warm-gray/30">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">Add:</span>
                      <div className="flex items-center gap-2 flex-1">
                        <button
                          onClick={() => setEditQty(Math.max(0, editQty - 1))}
                          className="btn-tactile w-9 h-9 bg-light harsh-border rounded-sm flex items-center justify-center"
                        >
                          <Minus size={16} strokeWidth={2.5} />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={editQty || ''}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const raw = e.target.value
                            const val = raw === '' ? 0 : parseInt(raw)
                            if (!isNaN(val)) setEditQty(Math.max(0, val))
                          }}
                          onBlur={() => {
                            if (editQty < 0) setEditQty(0)
                          }}
                          className="font-display text-xl w-14 text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-ink rounded-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                          onClick={() => setEditQty(editQty + 1)}
                          className="btn-tactile w-9 h-9 bg-light harsh-border rounded-sm flex items-center justify-center"
                        >
                          <Plus size={16} strokeWidth={2.5} />
                        </button>
                      </div>
                      <button
                        onClick={handleSaveRestock}
                        className="btn-tactile w-9 h-9 bg-accent-green rounded-sm flex items-center justify-center"
                      >
                        <CheckIcon />
                      </button>
                      <button
                        onClick={() => setEditingProduct(null)}
                        className="btn-tactile w-9 h-9 bg-light harsh-border rounded-sm flex items-center justify-center"
                      >
                        <X size={16} strokeWidth={2.5} />
                      </button>
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={restockUnitCost}
                      onChange={(e) => setRestockUnitCost(e.target.value)}
                      placeholder="Unit cost (GHS)"
                      className="w-full harsh-border rounded-sm px-3 py-2 text-sm mt-3"
                    />
                    {activeInjections.length > 0 && (
                      <select
                        value={restockInjectionId}
                        onChange={(e) => { setRestockInjectionId(e.target.value); if (e.target.value) setRestockUnpaid(false) }}
                        className="w-full harsh-border rounded-sm px-3 py-2 text-sm mt-2"
                      >
                        <option value="">Not funded by tracked capital</option>
                        {activeInjections.map((i) => (
                          <option key={i.id} value={i.id}>
                            Bought with: {i.lender_name || i.source}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {(['cash','bank'] as const).map((a) => (
                        <button key={a} type="button" onClick={() => { setRestockPayFrom(a); setRestockUnpaid(false) }}
                          className={`py-2 text-xs uppercase tracking-wide rounded-sm border-2 ${!restockUnpaid && restockPayFrom === a ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                          {a === 'cash' ? 'Paid cash' : 'Paid bank'}
                        </button>
                      ))}
                    </div>
                    {!restockInjectionId && (
                      <button type="button" onClick={() => setRestockUnpaid((v) => !v)}
                        className={`mt-2 w-full py-2 text-xs uppercase tracking-wide rounded-sm border-2 ${restockUnpaid ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                        {restockUnpaid ? '✓ Unpaid (supplier credit)' : 'Unpaid (supplier credit)'}
                      </button>
                    )}
                    {restockUnpaid && !restockInjectionId && (
                      <div className="mt-2 space-y-2">
                        <input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)}
                          placeholder="Supplier name (required)"
                          className="block w-full min-w-0 max-w-full harsh-border rounded-sm px-3 py-2 text-sm" />
                        <input type="tel" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)}
                          placeholder="Supplier phone (optional)"
                          className="block w-full min-w-0 max-w-full harsh-border rounded-sm px-3 py-2 text-sm" />
                        <p className="text-[10px] text-muted-text">Saved to “I owe them” for {formatCurrency((parseFloat(restockUnitCost) || 0) * editQty)}.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex border-t border-ink/10">
                    <button
                      onClick={() => handleRestock(product.id)}
                      className="flex-1 py-2.5 text-micro text-accent-red hover:bg-warm-gray/30 transition-colors"
                    >
                      {t('re_stock')}
                    </button>
                    <div className="w-px bg-ink/10 my-2" />
                    <button
                      onClick={() => handleOpenEdit(product.id)}
                      className="px-4 py-2.5 text-muted-text hover:bg-warm-gray/30 transition-colors flex items-center justify-center"
                    >
                      <Pencil size={14} strokeWidth={2} />
                    </button>
                    <div className="w-px bg-ink/10 my-2" />
                    <button
                      onClick={() => setShowDeleteConfirm(product.id)}
                      className="px-4 py-2.5 text-accent-red/60 hover:bg-accent-red/5 hover:text-accent-red transition-colors flex items-center justify-center"
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </div>
                )}
              </>
            )}
          </motion.div>
        ))}
      </section>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-[60]"
              onClick={() => setShowDeleteConfirm(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              transition={{ type: 'spring', damping: 25, stiffness: 400 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[70] w-[85vw] max-w-sm p-5"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-accent-red/10 rounded-full flex items-center justify-center">
                  <AlertTriangle size={20} className="text-accent-red" />
                </div>
                <div>
                  <h3 className="font-display text-lg text-ink uppercase tracking-tight">Delete Product?</h3>
                  <p className="text-xs text-muted-text">This cannot be undone</p>
                </div>
              </div>

              <p className="text-sm text-ink mb-5">
                Are you sure you want to delete <strong>{state.products.find((p) => p.id === showDeleteConfirm)?.name}</strong>?
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="flex-1 h-12 bg-warm-gray rounded-sm font-display text-sm text-ink uppercase tracking-wider"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
                  disabled={deletingProduct}
                  className="flex-1 h-12 bg-accent-red rounded-sm font-display text-sm text-white uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {deletingProduct ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Trash2 size={14} />
                      DELETE
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Product Sheet */}
      <AnimatePresence>
        {showAddProduct && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => setShowAddProduct(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 shadow-sheet flex flex-col"
              style={{ maxHeight: '92dvh' }}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink flex-shrink-0">
                <h2 className="font-display text-2xl text-ink uppercase tracking-tight">{t('add_product')}</h2>
                <button onClick={() => setShowAddProduct(false)} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
                  <X size={20} strokeWidth={2.5} className="text-ink" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">{t('product_name')}</label>
                    <input
                      type="text"
                      value={newProduct.name}
                      onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                      placeholder="e.g. Ideal Milk 320g"
                      className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-micro text-muted-text mb-1.5 block">{t('cost_price')} (GH₵)</label>
                      <input
                        type="number"
                        value={newProduct.cost_price}
                        onChange={(e) => setNewProduct({ ...newProduct, cost_price: e.target.value })}
                        placeholder="0.00"
                        className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body"
                      />
                    </div>
                    <div>
                      <label className="text-micro text-muted-text mb-1.5 block">{t('selling_price')} (GH₵)</label>
                      <input
                        type="number"
                        value={newProduct.selling_price}
                        onChange={(e) => setNewProduct({ ...newProduct, selling_price: e.target.value })}
                        placeholder="0.00"
                        className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body"
                      />
                      {newProduct.multiUnit && newProduct.selling_price && parseInt(newProduct.unitsPerPack) > 1 && (
                        <p className="mt-1 text-micro text-muted-text">
                          = {formatCurrency(parseFloat(newProduct.selling_price) * parseInt(newProduct.unitsPerPack))} / {newProduct.packUnit || 'pack'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mb-1">
                    <label className="flex items-center gap-2 text-micro text-muted-text">
                      <input
                        type="checkbox"
                        checked={newProduct.multiUnit}
                        onChange={(e) => setNewProduct({ ...newProduct, multiUnit: e.target.checked, qtyUnitKind: e.target.checked ? newProduct.qtyUnitKind : 'base' })}
                      />
                      SOLD IN PACKS (e.g. box of sachets)
                    </label>
                    {newProduct.multiUnit && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={newProduct.packUnit}
                          onChange={(e) => setNewProduct({ ...newProduct, packUnit: e.target.value })}
                          placeholder="Pack name (box)"
                          className="h-12 px-3 bg-light harsh-border rounded-sm text-base font-body"
                        />
                        <input
                          type="number"
                          inputMode="numeric"
                          value={newProduct.unitsPerPack}
                          onChange={(e) => setNewProduct({ ...newProduct, unitsPerPack: e.target.value })}
                          placeholder={`${newProduct.unit}s per ${newProduct.packUnit || 'pack'}`}
                          className="h-12 px-3 bg-light harsh-border rounded-sm text-base font-body"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-micro text-muted-text mb-1.5 block">{t('quantity')}</label>
                      <input
                        type="number"
                        value={newProduct.quantity}
                        onChange={(e) => setNewProduct({ ...newProduct, quantity: e.target.value })}
                        placeholder="0"
                        className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body"
                      />
                      {newProduct.multiUnit && (
                        <div className="mt-1.5 flex gap-1">
                          {(['pack', 'base'] as const).map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => setNewProduct({ ...newProduct, qtyUnitKind: k })}
                              className={`flex-1 py-1.5 text-micro uppercase rounded-sm border-2 border-ink ${newProduct.qtyUnitKind === k ? 'bg-ink text-white' : 'bg-light text-ink'}`}
                            >
                              {k === 'pack' ? (newProduct.packUnit || 'pack') : newProduct.unit}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-micro text-muted-text mb-1.5 block">{newProduct.multiUnit ? 'SMALLER UNIT' : 'UNIT'}</label>
                      <select
                        value={newProduct.unit}
                        onChange={(e) => setNewProduct({ ...newProduct, unit: e.target.value })}
                        className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body"
                      >
                        <option value="piece">Piece</option>
                        <option value="tin">Tin</option>
                        <option value="bag">Bag</option>
                        <option value="bottle">Bottle</option>
                        <option value="pack">Pack</option>
                        <option value="loaf">Loaf</option>
                        <option value="kg">Kg</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">CATEGORY</label>
                    <div className="grid grid-cols-4 gap-2">
                      {categories.map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setNewProduct({ ...newProduct, category: cat })}
                          className={`btn-tactile py-2.5 text-xs font-display uppercase tracking-wider rounded-sm border-2 transition-colors ${
                            newProduct.category === cat
                              ? 'bg-ink text-white border-ink'
                              : 'bg-light text-ink border-ink'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {activeInjections.length > 0 && (
                    <div>
                      <label className="text-micro text-muted-text mb-1.5 block">BOUGHT WITH CAPITAL</label>
                      <select
                        value={addProductInjectionId}
                        onChange={(e) => { setAddProductInjectionId(e.target.value); if (e.target.value) setAddUnpaid(false) }}
                        className="w-full harsh-border rounded-sm px-3 py-2 text-sm"
                      >
                        <option value="">Not funded by tracked capital</option>
                        {activeInjections.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.lender_name || i.source}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* How the stock was paid for */}
                  <div>
                    <label className="text-micro text-muted-text mb-1.5 block">PAID FOR WITH</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['cash','bank'] as const).map((a) => (
                        <button key={a} type="button" onClick={() => { setAddPayFrom(a); setAddUnpaid(false) }}
                          className={`py-2 text-xs uppercase tracking-wide rounded-sm border-2 ${!addUnpaid && addPayFrom === a ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                          {a === 'cash' ? 'Paid cash' : 'Paid bank'}
                        </button>
                      ))}
                    </div>
                    {!addProductInjectionId && (
                      <button type="button" onClick={() => setAddUnpaid((v) => !v)}
                        className={`mt-2 w-full py-2 text-xs uppercase tracking-wide rounded-sm border-2 ${addUnpaid ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                        {addUnpaid ? '✓ Unpaid (supplier credit)' : 'Unpaid (supplier credit)'}
                      </button>
                    )}
                    {addUnpaid && !addProductInjectionId && (
                      <div className="mt-2 space-y-2">
                        <input type="text" value={addSupplierName} onChange={(e) => setAddSupplierName(e.target.value)}
                          placeholder="Supplier name (required)"
                          className="block w-full min-w-0 max-w-full harsh-border rounded-sm px-3 py-2 text-sm" />
                        <input type="tel" value={addSupplierPhone} onChange={(e) => setAddSupplierPhone(e.target.value)}
                          placeholder="Supplier phone (optional)"
                          className="block w-full min-w-0 max-w-full harsh-border rounded-sm px-3 py-2 text-sm" />
                        <p className="text-[10px] text-muted-text">Saved to “I owe them” for {formatCurrency((parseFloat(newProduct.cost_price) || 0) * (parseInt(newProduct.quantity) || 0))}.</p>
                      </div>
                    )}
                  </div>

                  {/* Projected profit preview */}
                  {newProduct.cost_price && newProduct.selling_price && (
                    <div className="bg-ink rounded-sm p-4">
                      <div className="flex justify-between items-center">
                        <span className="text-white/60 text-micro">{t('profit_per_unit')}</span>
                        <span className="font-display text-lg text-accent-green">
                          {formatCurrency(parseFloat(newProduct.selling_price || '0') - parseFloat(newProduct.cost_price || '0'))}
                        </span>
                      </div>
                      {newProduct.quantity && (
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-white/40 text-xs">{t('total_projected_profit')}</span>
                          <span className="text-white text-sm font-medium">
                            {formatCurrency(
                              (parseFloat(newProduct.selling_price || '0') - parseFloat(newProduct.cost_price || '0')) *
                                parseInt(newProduct.quantity || '0')
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                </div>

                {/* Save button - STICKY AT BOTTOM */}
                <div className="px-5 pt-4 pb-sheet bg-sand border-t-2 border-ink flex-shrink-0 mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
                  <button
                    onClick={handleAddProduct}
                    disabled={addingProduct}
                    className="btn-tactile w-full h-14 bg-ink text-white font-display text-lg uppercase tracking-wider rounded-sm disabled:opacity-50"
                  >
                    {addingProduct ? '...' : t('add_to_stock')}
                  </button>
                </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 8L6.5 11.5L13 4.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
