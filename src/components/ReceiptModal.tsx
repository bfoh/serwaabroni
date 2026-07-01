import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Share2, Check, Download, Printer } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatTime } from '@/lib/data'
import { saleDisplay } from '@/lib/units'
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
    .map((s) => {
      const d = saleDisplay(s)
      return `${s.product_name}  ${d.qtyLabel} x ${formatCurrency(d.unitPrice)} = ${formatCurrency(s.total)}`
    })
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
      ctx.fillText(saleDisplay(s).qtyLabel, 360, y)
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
            className="fixed inset-0 bg-black/60 z-[60]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
            animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
            exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[92vw] max-w-sm flex flex-col max-h-[calc(100dvh-2rem)]"
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
            <div ref={receiptRef} className="bg-sand harsh-border rounded-sm p-5 print-section overflow-y-auto no-scrollbar">
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
                      {saleDisplay(s).qtyLabel} x {formatCurrency(saleDisplay(s).unitPrice)}
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
            <div className="mt-3 pb-safe grid grid-cols-5 gap-1.5 print-hide flex-shrink-0">
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
