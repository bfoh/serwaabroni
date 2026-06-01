# Grouped Multi-Item Sale + Single Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a multi-product cart as one grouped entry (Latest Sales + Sales History) and open one receipt listing every product, by tagging each cart's rows with a shared `sale_group_id`.

**Architecture:** Add a nullable `sale_group_id` column to `sales`. `AddSaleSheet` stamps one id per cart. A pure `groupSales` helper folds rows into `SaleGroup`s for display; `ReceiptModal` takes a `Sale[]` and renders line items + grand total. Money stats keep summing flat rows, so reports are untouched. Rows with a null group id render as singleton groups (old data unchanged).

**Tech Stack:** React 19, TypeScript, Vite, Supabase JS, framer-motion, lucide-react, Tailwind.

**Testing note:** No unit-test runner exists (package.json scripts: `dev`, `build`, `lint`, `preview`). Per-task verification = `npm run build` (tsc + vite) and `npm run lint`; full manual checks in the final task. Do not add a test framework — out of scope.

**Manual prerequisite (do first, outside code):** Run this in the Supabase SQL editor for the project:

```sql
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_sales_group ON sales(sale_group_id);
```

Until this runs, inserts that include `sale_group_id` will fail against the live DB and the app falls back to the local/offline path. The column is nullable, so existing rows are unaffected.

---

### Task 1: Schema parity + `Sale` type

**Files:**
- Modify: `src/db/schema.sql` (sales table, after the `qr_invoice TEXT,` line, ~line 56)
- Modify: `src/lib/supabase.ts` (`interface Sale`, after `qr_invoice?: string | null`)

- [ ] **Step 1: Add the column to schema.sql**

In `src/db/schema.sql`, change:

```sql
  qr_invoice TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

to:

```sql
  qr_invoice TEXT,
  sale_group_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_group ON sales(sale_group_id);
```

- [ ] **Step 2: Add the field to the `Sale` type**

In `src/lib/supabase.ts`, in `interface Sale`, change:

```ts
  qr_invoice?: string | null
  created_at: string
}
```

to:

```ts
  qr_invoice?: string | null
  sale_group_id?: string | null
  created_at: string
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ built`, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.sql src/lib/supabase.ts
git commit -m "feat: add sale_group_id column and type field"
```

---

### Task 2: `groupSales` helper

**Files:**
- Modify: `src/lib/data.ts` (add `SaleGroup` interface + `groupSales` near the other helpers; `Sale` is already imported at the top via `import type { Product, Sale, Debt, Expense } from './supabase'`)

- [ ] **Step 1: Add the interface and function**

Append to `src/lib/data.ts` (end of file):

```ts
export interface SaleGroup {
  key: string                       // sale_group_id, or row id when ungrouped
  sales: Sale[]                     // line items, input order preserved
  total: number
  profit: number
  itemCount: number
  created_at: string
  customer_name: string | null
  customer_phone: string | null
  payment_method: 'cash' | 'momo' | 'bank'
}

// Fold flat sale rows into groups. Rows sharing a truthy sale_group_id become
// one group (keeping first-seen order); rows without one are singleton groups.
export function groupSales(sales: Sale[]): SaleGroup[] {
  const groups: SaleGroup[] = []
  const byKey = new Map<string, SaleGroup>()
  for (const sale of sales) {
    const gid = sale.sale_group_id
    if (gid) {
      const existing = byKey.get(gid)
      if (existing) {
        existing.sales.push(sale)
        existing.total += sale.total
        existing.profit += sale.profit || 0
        existing.itemCount += sale.quantity
        continue
      }
      const g: SaleGroup = {
        key: gid,
        sales: [sale],
        total: sale.total,
        profit: sale.profit || 0,
        itemCount: sale.quantity,
        created_at: sale.created_at,
        customer_name: sale.customer_name,
        customer_phone: sale.customer_phone,
        payment_method: sale.payment_method,
      }
      byKey.set(gid, g)
      groups.push(g)
    } else {
      groups.push({
        key: sale.id,
        sales: [sale],
        total: sale.total,
        profit: sale.profit || 0,
        itemCount: sale.quantity,
        created_at: sale.created_at,
        customer_name: sale.customer_name,
        customer_phone: sale.customer_phone,
        payment_method: sale.payment_method,
      })
    }
  }
  return groups
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`, no new errors in `data.ts`. (`groupSales`/`SaleGroup` exported; unused until later tasks — fine, they are exports.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/data.ts
git commit -m "feat: add groupSales helper"
```

---

### Task 3: Stamp `sale_group_id` on cart rows

**Files:**
- Modify: `src/components/AddSaleSheet.tsx` (`handleConfirm`, the `const sales = cart.map(...)` block)

- [ ] **Step 1: Generate one group id per cart and stamp each row**

In `handleConfirm`, change:

```ts
      const createdAt = new Date().toISOString()
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
        created_at: createdAt,
      }))
```

to:

```ts
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `✓ built`, no type errors (the sale object now structurally matches `Omit<Sale,'user_id'>` including the optional `sale_group_id`).

- [ ] **Step 3: Commit**

```bash
git add src/components/AddSaleSheet.tsx
git commit -m "feat: stamp sale_group_id on each cart row"
```

---

### Task 4: Multi-item `ReceiptModal`

**Files:**
- Modify: `src/components/ReceiptModal.tsx` (full file replace)

This converts the modal from one `sale` to a `sales: Sale[]` list. Replace the **entire file** with:

- [ ] **Step 1: Replace the whole file**

```tsx
import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Share2, Check, Download, Printer } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatTime } from '@/lib/data'
import type { Sale } from '@/lib/supabase'

interface ReceiptModalProps {
  sales: Sale[]
  isOpen: boolean
  onClose: () => void
}

export default function ReceiptModal({ sales, isOpen, onClose }: ReceiptModalProps) {
  const { state } = useStore()
  const [shared, setShared] = useState(false)
  const receiptRef = useRef<HTMLDivElement>(null)

  if (!isOpen || sales.length === 0) return null

  const head = sales[0]
  const grandTotal = sales.reduce((sum, s) => sum + s.total, 0)
  const businessName = state.businessProfile?.business_name || state.user?.business_name || "SerwaaBroni Shop"
  const logoUrl = state.user?.logo || state.businessProfile?.logo_url
  const now = new Date()
  const receiptKey = (head.sale_group_id ?? head.id).slice(-4).toUpperCase()
  const receiptNo = `SB-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${receiptKey}`

  const itemLines = sales
    .map((s) => `${s.product_name}  ${s.quantity} x ${formatCurrency(s.unit_price)} = ${formatCurrency(s.total)}`)
    .join('\n')

  const receiptText = `*${businessName}*
Receipt: ${receiptNo}
Date: ${formatTime(head.created_at)}
${itemLines}
Total: ${formatCurrency(grandTotal)}
Payment: ${head.payment_method?.toUpperCase() || 'CASH'}
Thank you for your business!`

  const handleShareWhatsApp = () => {
    const encoded = encodeURIComponent(receiptText)
    const phone = head.customer_phone ? `+${head.customer_phone.replace(/^0/, '233')}` : ''
    window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank')
    setShared(true)
    setTimeout(() => setShared(false), 2000)
  }

  const handleShareSMS = () => {
    const encoded = encodeURIComponent(receiptText)
    const phone = head.customer_phone ? `+${head.customer_phone.replace(/^0/, '233')}` : ''
    window.open(`sms:${phone}?body=${encoded}`, '_self')
    setShared(true)
    setTimeout(() => setShared(false), 2000)
  }

  const handleDownloadImage = () => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const lineH = 30
    const itemsTop = 360
    canvas.width = 600
    canvas.height = itemsTop + sales.length * lineH + 220

    // Background
    ctx.fillStyle = '#F5F0E6'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Border
    ctx.strokeStyle = '#1A1A1A'
    ctx.lineWidth = 3
    ctx.strokeRect(15, 15, canvas.width - 30, canvas.height - 30)

    // Content
    ctx.fillStyle = '#1A1A1A'
    ctx.textAlign = 'center'

    ctx.font = 'bold 32px Arial'
    ctx.fillText(businessName.toUpperCase(), 300, 80)

    ctx.font = '16px Arial'
    ctx.fillText('RECEIPT', 300, 110)
    ctx.fillText('- - - - - - - - - - - - - - - -', 300, 130)

    ctx.textAlign = 'left'
    ctx.font = '18px Arial'
    ctx.fillText(`Receipt No: ${receiptNo}`, 40, 170)
    ctx.fillText(`Date: ${formatTime(head.created_at)}`, 40, 200)
    ctx.fillText(`Customer: ${head.customer_name || 'Walk-in'}`, 40, 230)
    if (head.customer_phone) ctx.fillText(`Phone: ${head.customer_phone}`, 40, 260)

    ctx.textAlign = 'center'
    ctx.fillText('- - - - - - - - - - - - - - - -', 300, 290)

    // Items header
    ctx.textAlign = 'left'
    ctx.font = 'bold 20px Arial'
    ctx.fillText('ITEM', 40, 325)
    ctx.fillText('QTY', 360, 325)
    ctx.textAlign = 'right'
    ctx.fillText('AMOUNT', 560, 325)

    // Item rows
    ctx.font = '18px Arial'
    sales.forEach((s, idx) => {
      const y = itemsTop + idx * lineH
      ctx.textAlign = 'left'
      ctx.fillText(s.product_name, 40, y)
      ctx.fillText(String(s.quantity), 360, y)
      ctx.textAlign = 'right'
      ctx.fillText(formatCurrency(s.total), 560, y)
    })

    const afterItems = itemsTop + sales.length * lineH + 10
    ctx.textAlign = 'center'
    ctx.fillText('- - - - - - - - - - - - - - - -', 300, afterItems)

    ctx.textAlign = 'right'
    ctx.font = 'bold 24px Arial'
    ctx.fillText(`TOTAL: ${formatCurrency(grandTotal)}`, 560, afterItems + 40)

    ctx.font = '18px Arial'
    ctx.fillText(`Payment: ${head.payment_method?.toUpperCase() || 'CASH'}`, 560, afterItems + 70)

    ctx.textAlign = 'center'
    ctx.font = '16px Arial'
    ctx.fillStyle = '#888888'
    ctx.fillText('Thank you for your business!', 300, afterItems + 120)
    ctx.fillText('Powered by SerwaaBroni', 300, afterItems + 150)

    const link = document.createElement('a')
    link.download = `receipt-${receiptNo}.png`
    link.href = canvas.toDataURL()
    link.click()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[100]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
            animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
            exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[110] w-[92vw] max-w-sm"
          >
            <style>{`
              @media print {
                body * {
                  visibility: hidden;
                }
                .print-section, .print-section * {
                  visibility: visible;
                  color: black !important;
                  background: white !important;
                }
                .print-section {
                  position: absolute;
                  left: 0;
                  top: 0;
                  width: 100%;
                  padding: 10px;
                  margin: 0;
                  box-shadow: none !important;
                  border: none !important;
                }
                .print-hide {
                  display: none !important;
                }
                @page { margin: 0; }
              }
            `}</style>
            <div ref={receiptRef} className="bg-sand harsh-border rounded-sm p-5 print-section">
              {/* Header */}
              <div className="text-center border-b-2 border-dashed border-ink/30 pb-3 mb-4 flex flex-col items-center">
                {logoUrl && (
                  <img src={logoUrl} alt="Logo" className="w-16 h-16 object-contain mb-2 mix-blend-multiply" />
                )}
                <h2 className="font-display text-2xl text-ink uppercase tracking-tight">{businessName}</h2>
                <p className="text-[10px] text-muted-text uppercase tracking-wider mt-1">Receipt</p>
                <p className="text-[10px] text-muted-text font-mono mt-0.5">{receiptNo}</p>
              </div>

              {/* Details */}
              <div className="space-y-1.5 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-text">Date</span>
                  <span className="font-medium">{formatTime(head.created_at)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-text">Customer</span>
                  <span className="font-medium">{head.customer_name || 'Walk-in'}</span>
                </div>
                {head.customer_phone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-text">Phone</span>
                    <span className="font-medium">{head.customer_phone}</span>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t-2 border-dashed border-ink/30 my-3" />

              {/* Items */}
              <div className="space-y-1.5 mb-3">
                <div className="flex justify-between text-[10px] text-muted-text uppercase">
                  <span>Item</span>
                  <span>Qty x Price</span>
                </div>
                {sales.map((s) => (
                  <div key={s.id} className="flex justify-between items-start gap-2">
                    <span className="text-sm font-medium flex-1 min-w-0 truncate">{s.product_name}</span>
                    <span className="text-sm text-right whitespace-nowrap">
                      {s.quantity} x {formatCurrency(s.unit_price)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Divider */}
              <div className="border-t-2 border-dashed border-ink/30 my-3" />

              {/* Total */}
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-text">Payment</span>
                <span className="text-sm font-medium uppercase">{head.payment_method || 'CASH'}</span>
              </div>
              <div className="flex justify-between items-center bg-ink rounded-sm px-4 py-3 print:bg-white print:border-y-2 print:border-black print:px-0">
                <span className="text-white/70 text-sm uppercase print:text-black">Total</span>
                <span className="font-display text-xl text-white print:text-black">{formatCurrency(grandTotal)}</span>
              </div>

              {/* Footer */}
              <div className="text-center mt-4 pt-3 border-t border-ink/10">
                <p className="text-[10px] text-muted-text">Thank you for your business!</p>
                <p className="text-[9px] text-muted-text mt-0.5">Powered by SerwaaBroni</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-3 grid grid-cols-5 gap-1.5 print-hide">
              <button
                onClick={() => window.print()}
                className="h-11 bg-ink rounded-sm font-display text-[10px] text-white uppercase tracking-wider flex items-center justify-center gap-1"
              >
                <Printer size={14} />
                <span className="hidden sm:inline">Print</span>
              </button>
              <button
                onClick={handleShareWhatsApp}
                className="h-11 bg-[#25D366] rounded-sm font-display text-[10px] text-white uppercase tracking-wider flex items-center justify-center gap-1"
              >
                {shared ? <Check size={14} /> : <Share2 size={14} />}
                WA
              </button>
              <button
                onClick={handleShareSMS}
                className="h-11 bg-accent-green rounded-sm font-display text-[10px] text-white uppercase tracking-wider flex items-center justify-center gap-1"
              >
                {shared ? <Check size={14} /> : <Share2 size={14} />}
                SMS
              </button>
              <button
                onClick={handleDownloadImage}
                className="h-11 bg-ink rounded-sm font-display text-[10px] text-white uppercase tracking-wider flex items-center justify-center gap-1"
              >
                <Download size={14} />
                <span className="hidden sm:inline">Save</span>
              </button>
              <button
                onClick={onClose}
                className="h-11 bg-warm-gray rounded-sm font-display text-[10px] text-ink uppercase tracking-wider flex items-center justify-center gap-1"
              >
                <X size={14} />
                Close
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: type errors in `Dashboard.tsx` and `SalesHistory.tsx` (they still pass `sale={...}`). That is expected and fixed in Tasks 5–6. Do NOT commit yet — `tsc` may fail the build here. Proceed directly to Task 5; commit ReceiptModal together with Task 5.

---

### Task 5: Dashboard renders groups

**Files:**
- Modify: `src/pages/Dashboard.tsx` (state ~line 22, `recentSales` ~line 29, import line 5, the map block ~lines 181-214, ReceiptModal usage ~lines 222-226)

- [ ] **Step 1: Import `groupSales` and `SaleGroup`**

Change line 5:

```ts
import { formatCurrency, formatTime, formatDate } from '@/lib/data'
```

to:

```ts
import { formatCurrency, formatTime, formatDate, groupSales, type SaleGroup } from '@/lib/data'
```

- [ ] **Step 2: Swap receipt state to a list**

Change:

```ts
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
```

to:

```ts
  const [receiptSales, setReceiptSales] = useState<Sale[]>([])
```

- [ ] **Step 3: Group then slice**

Change:

```ts
  const recentSales = useMemo(() => state.sales.slice(0, 6), [state.sales])
```

to:

```ts
  const recentGroups = useMemo(() => groupSales(state.sales).slice(0, 6), [state.sales])
```

- [ ] **Step 4: Replace the sales map block**

Replace the whole `{recentSales.map((sale, index) => ( ... ))}` block (lines ~181-214) with:

```tsx
          {recentGroups.map((group: SaleGroup, index) => {
            const head = group.sales[0]
            const lineCount = group.sales.length
            const title = lineCount > 1 ? `${head.product_name} +${lineCount - 1} more` : head.product_name
            return (
              <motion.button
                key={group.key}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05, duration: 0.25 }}
                onClick={() => { setReceiptSales(group.sales); setShowReceipt(true) }}
                className="w-full bg-light harsh-border rounded-sm px-4 py-3 flex items-center gap-3 text-left"
              >
                <div className="w-10 h-10 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
                  <ProductIcon
                    category={state.products.find((p) => p.id === head.product_id)?.category || 'default'}
                    size={24}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-text">{formatDate(group.created_at)} {formatTime(group.created_at)}</span>
                    {group.customer_name && (
                      <span className="text-[10px] text-accent-green flex items-center gap-0.5">
                        <User size={8} /> {group.customer_name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-display text-base text-accent-green">+{formatCurrency(group.total)}</p>
                  {lineCount > 1 ? (
                    <p className="text-[10px] text-muted-text">{group.itemCount} items</p>
                  ) : (
                    head.quantity > 1 && (
                      <p className="text-[10px] text-muted-text">{head.quantity} x {formatCurrency(head.unit_price)}</p>
                    )
                  )}
                </div>
              </motion.button>
            )
          })}
```

- [ ] **Step 5: Update the ReceiptModal usage**

Change:

```tsx
      <ReceiptModal
        sale={receiptSale}
        isOpen={showReceipt}
        onClose={() => setShowReceipt(false)}
      />
```

to:

```tsx
      <ReceiptModal
        sales={receiptSales}
        isOpen={showReceipt}
        onClose={() => setShowReceipt(false)}
      />
```

- [ ] **Step 6: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: Dashboard type errors gone. SalesHistory may still error (fixed in Task 6). If only SalesHistory errors remain, that is expected.

- [ ] **Step 7: Commit ReceiptModal + Dashboard together**

```bash
git add src/components/ReceiptModal.tsx src/pages/Dashboard.tsx
git commit -m "feat: grouped receipt modal + grouped latest sales"
```

---

### Task 6: Sales History renders groups

**Files:**
- Modify: `src/pages/SalesHistory.tsx` (import line 5, state line 18, `summary` ~lines 56-61, map block ~lines 130-160, ReceiptModal usage ~lines 165-169)

- [ ] **Step 1: Import `groupSales` and `SaleGroup`**

Change line 5:

```ts
import { formatCurrency, formatTime, formatDate } from '@/lib/data'
```

to:

```ts
import { formatCurrency, formatTime, formatDate, groupSales, type SaleGroup } from '@/lib/data'
```

- [ ] **Step 2: Swap receipt state to a list**

Change:

```ts
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
```

to:

```ts
  const [selectedSales, setSelectedSales] = useState<Sale[]>([])
```

- [ ] **Step 3: Derive groups and fix the count**

Replace the `summary` useMemo block:

```ts
  const summary = useMemo(() => {
    const total = filteredSales.reduce((s, sale) => s + sale.total, 0)
    const profit = filteredSales.reduce((s, sale) => s + (sale.profit || 0), 0)
    const count = filteredSales.length
    return { total, profit, count }
  }, [filteredSales])
```

with:

```ts
  const filteredGroups = useMemo(() => groupSales(filteredSales), [filteredSales])

  const summary = useMemo(() => {
    const total = filteredSales.reduce((s, sale) => s + sale.total, 0)
    const profit = filteredSales.reduce((s, sale) => s + (sale.profit || 0), 0)
    const count = filteredGroups.length
    return { total, profit, count }
  }, [filteredSales, filteredGroups])
```

- [ ] **Step 4: Replace the empty-state guard + map block**

Change the empty guard condition `{filteredSales.length === 0 && (` to `{filteredGroups.length === 0 && (`.

Then replace the whole `{filteredSales.map((sale, i) => ( ... ))}` block (lines ~130-160) with:

```tsx
        {filteredGroups.map((group: SaleGroup, i) => {
          const head = group.sales[0]
          const lineCount = group.sales.length
          const title = lineCount > 1 ? `${head.product_name} +${lineCount - 1} more` : head.product_name
          return (
            <motion.button
              key={group.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => { setSelectedSales(group.sales); setShowReceipt(true) }}
              className="w-full bg-light harsh-border rounded-sm p-3 flex items-center gap-3 text-left"
            >
              <div className="w-10 h-10 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
                <ProductIcon
                  category={state.products.find((p) => p.id === head.product_id)?.category || 'default'}
                  size={22}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-text">{formatDate(group.created_at)} {formatTime(group.created_at)}</span>
                  {group.customer_name && (
                    <span className="text-[10px] text-accent-green flex items-center gap-0.5">
                      <User size={8} /> {group.customer_name}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-display text-sm text-ink">{formatCurrency(group.total)}</p>
                {lineCount > 1 ? (
                  <p className="text-[9px] text-muted-text">{group.itemCount} items</p>
                ) : (
                  <p className="text-[9px] text-muted-text">{head.quantity} x {formatCurrency(head.unit_price)}</p>
                )}
              </div>
            </motion.button>
          )
        })}
```

- [ ] **Step 5: Update the ReceiptModal usage**

Change:

```tsx
      <ReceiptModal
        sale={selectedSale}
        isOpen={showReceipt}
        onClose={() => setShowReceipt(false)}
      />
```

to:

```tsx
      <ReceiptModal
        sales={selectedSales}
        isOpen={showReceipt}
        onClose={() => setShowReceipt(false)}
      />
```

- [ ] **Step 6: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`, no type errors. No new lint errors in `SalesHistory.tsx` / `Dashboard.tsx` / `ReceiptModal.tsx` (pre-existing repo lint errors in `Reports.tsx` and `supabaseApi.ts:363/385` are unrelated and remain).

- [ ] **Step 7: Commit**

```bash
git add src/pages/SalesHistory.tsx
git commit -m "feat: grouped sales history + receipt count"
```

---

### Task 7: Manual verification

**Files:** none (manual). Requires the Supabase `ALTER TABLE` from the prerequisite to have been run.

- [ ] **Step 1: Run the app**

Run: `npm run dev`
Open the served URL, log in.

- [ ] **Step 2: Multi-item group**

New Sale → add product A → "Add More Products" → add product B (distinct quantities) → MOMO → add customer name + phone → CONFIRM.
Verify on Dashboard "Latest Sales": **one** entry titled "<A> +1 more", right side shows grand total and "N items" (sum of qtys).

- [ ] **Step 3: Grouped receipt**

Tap that entry. Receipt lists **both** products, each `qty x unit_price`, and one grand total matching the sum. Customer + payment shown once. Tap WA / SMS — message body lists both items + total. Tap Save — downloaded PNG shows both item rows + total. Print preview shows both items.

- [ ] **Step 4: Single-item regression**

Sell one product. Latest Sales shows one entry with the product name and (if qty>1) `qty x unit_price`. Receipt shows the single item. Identical to old behavior.

- [ ] **Step 5: Old data**

Confirm previously recorded single sales (null `sale_group_id`) still appear individually and open a working single-item receipt.

- [ ] **Step 6: Sales History**

Open Sales History (View All). The multi-item cart appears as one row; "Sales" stat counts receipts (groups), Revenue/Profit unchanged. Tap → same grouped receipt.

- [ ] **Step 7: Stats unchanged**

Confirm Dashboard today-sales total and Sales-History Revenue equal the sum of all line totals (grouping does not change money math).

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "chore: verify grouped sale + receipt flow" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- `sale_group_id` column + index → Task 1 + prerequisite SQL ✓
- `Sale` type field → Task 1 ✓
- Stamp one id per cart → Task 3 ✓
- `groupSales` / `SaleGroup` (id grouping, null = singleton, order preserved, aggregates) → Task 2 ✓
- Dashboard groups + slice groups not rows + "+N more" + "N items" + group receipt → Task 5 ✓
- Sales History groups + count = groups, revenue/profit sum rows → Task 6 ✓
- Multi-item ReceiptModal (`sales: Sale[]`, line items, grand total, receiptNo from group key, WA/SMS/canvas/print loop items) → Task 4 ✓
- Old null-group rows render solo → Tasks 5/6 via `groupSales` singleton path; verified Task 7 Step 5 ✓
- Money stats untouched → no task changes stat math; verified Task 7 Step 7 ✓

**Placeholder scan:** none — every code step shows full code; commands have expected output.

**Type consistency:**
- `groupSales(sales: Sale[]): SaleGroup[]` defined Task 2, called identically Tasks 5/6.
- `SaleGroup` fields (`key, sales, total, profit, itemCount, created_at, customer_name, customer_phone, payment_method`) used consistently in render (`group.key`, `group.total`, `group.itemCount`, `group.customer_name`, `group.created_at`, `group.sales`).
- ReceiptModal prop renamed `sale: Sale | null` → `sales: Sale[]` (Task 4); both callers updated to `sales={...}` (Tasks 5/6). State renamed consistently: Dashboard `receiptSales`/`setReceiptSales`, SalesHistory `selectedSales`/`setSelectedSales`.
- `sale_group_id` optional field added Task 1; written Task 3; read in `groupSales` (Task 2) and `ReceiptModal` receiptNo (Task 4).

**Build-order note:** Task 4 intentionally leaves the tree non-compiling (callers not yet updated); Tasks 5–6 fix it. ReceiptModal is committed with Task 5 (Step 7), not standalone. Flagged in Task 4 Step 2.
