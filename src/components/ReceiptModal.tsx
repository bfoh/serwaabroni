import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Share2, Check, Download } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, formatTime } from '@/lib/data'
import type { Sale } from '@/lib/supabase'

interface ReceiptModalProps {
  sale: Sale | null
  isOpen: boolean
  onClose: () => void
}

export default function ReceiptModal({ sale, isOpen, onClose }: ReceiptModalProps) {
  const { state } = useStore()
  const [shared, setShared] = useState(false)
  const receiptRef = useRef<HTMLDivElement>(null)

  if (!isOpen || !sale) return null

  const businessName = state.businessProfile?.business_name || "SerwaaBroni Shop"
  const now = new Date()
  const receiptNo = `SB-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${sale.id.slice(-4).toUpperCase()}`

  const receiptText = `*${businessName}*
Receipt: ${receiptNo}
Date: ${formatTime(sale.created_at)}
Product: ${sale.product_name}
Qty: ${sale.quantity}
Unit Price: ${formatCurrency(sale.unit_price)}
Total: ${formatCurrency(sale.total)}
Payment: ${sale.payment_method?.toUpperCase() || 'CASH'}
Thank you for your business!`

  const handleShareWhatsApp = () => {
    const encoded = encodeURIComponent(receiptText)
    const phone = sale.customer_phone ? `+${sale.customer_phone.replace(/^0/, '233')}` : ''
    window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank')
    setShared(true)
    setTimeout(() => setShared(false), 2000)
  }

  const handleDownloadImage = () => {
    if (!receiptRef.current) return
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = 600
    canvas.height = 700

    // Background
    ctx.fillStyle = '#F5F0E6'
    ctx.fillRect(0, 0, 600, 700)

    // Border
    ctx.strokeStyle = '#1A1A1A'
    ctx.lineWidth = 3
    ctx.strokeRect(15, 15, 570, 670)

    // Content
    ctx.fillStyle = '#1A1A1A'
    ctx.textAlign = 'center'

    // Shop name
    ctx.font = 'bold 32px Arial'
    ctx.fillText(businessName.toUpperCase(), 300, 80)

    ctx.font = '16px Arial'
    ctx.fillText('RECEIPT', 300, 110)
    ctx.fillText('- - - - - - - - - - - - - - - -', 300, 130)

    // Receipt details
    ctx.textAlign = 'left'
    ctx.font = '18px Arial'
    ctx.fillText(`Receipt No: ${receiptNo}`, 40, 170)
    ctx.fillText(`Date: ${formatTime(sale.created_at)}`, 40, 200)
    ctx.fillText(`Customer: ${sale.customer_name || 'Walk-in'}`, 40, 230)
    if (sale.customer_phone) ctx.fillText(`Phone: ${sale.customer_phone}`, 40, 260)

    ctx.textAlign = 'center'
    ctx.fillText('- - - - - - - - - - - - - - - -', 300, 290)

    // Items
    ctx.textAlign = 'left'
    ctx.font = 'bold 20px Arial'
    ctx.fillText('ITEM', 40, 325)
    ctx.fillText('QTY', 300, 325)
    ctx.textAlign = 'right'
    ctx.fillText('AMOUNT', 560, 325)

    ctx.font = '18px Arial'
    ctx.textAlign = 'left'
    ctx.fillText(sale.product_name, 40, 360)
    ctx.fillText(String(sale.quantity), 300, 360)
    ctx.textAlign = 'right'
    ctx.fillText(formatCurrency(sale.total), 560, 360)

    // Totals
    ctx.textAlign = 'center'
    ctx.fillText('- - - - - - - - - - - - - - - -', 300, 400)

    ctx.textAlign = 'right'
    ctx.font = 'bold 24px Arial'
    ctx.fillText(`TOTAL: ${formatCurrency(sale.total)}`, 560, 440)

    ctx.font = '18px Arial'
    ctx.fillText(`Payment: ${sale.payment_method?.toUpperCase() || 'CASH'}`, 560, 470)

    // Footer
    ctx.textAlign = 'center'
    ctx.font = '16px Arial'
    ctx.fillStyle = '#888888'
    ctx.fillText('Thank you for your business!', 300, 530)
    ctx.fillText('Powered by SerwaaBroni', 300, 560)

    // Download
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
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[110] w-[92vw] max-w-sm"
          >
            <div ref={receiptRef} className="bg-sand harsh-border rounded-sm p-5">
              {/* Header */}
              <div className="text-center border-b-2 border-dashed border-ink/30 pb-3 mb-4">
                <h2 className="font-display text-2xl text-ink uppercase tracking-tight">{businessName}</h2>
                <p className="text-[10px] text-muted-text uppercase tracking-wider mt-1">Receipt</p>
                <p className="text-[10px] text-muted-text font-mono mt-0.5">{receiptNo}</p>
              </div>

              {/* Details */}
              <div className="space-y-1.5 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-text">Date</span>
                  <span className="font-medium">{formatTime(sale.created_at)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-text">Customer</span>
                  <span className="font-medium">{sale.customer_name || 'Walk-in'}</span>
                </div>
                {sale.customer_phone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-text">Phone</span>
                    <span className="font-medium">{sale.customer_phone}</span>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t-2 border-dashed border-ink/30 my-3" />

              {/* Items */}
              <div className="space-y-1 mb-3">
                <div className="flex justify-between text-[10px] text-muted-text uppercase">
                  <span>Item</span>
                  <span>Qty x Price</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">{sale.product_name}</span>
                  <span className="text-sm">{sale.quantity} x {formatCurrency(sale.unit_price)}</span>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t-2 border-dashed border-ink/30 my-3" />

              {/* Total */}
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-text">Payment</span>
                <span className="text-sm font-medium uppercase">{sale.payment_method || 'CASH'}</span>
              </div>
              <div className="flex justify-between items-center bg-ink rounded-sm px-4 py-3">
                <span className="text-white/70 text-sm uppercase">Total</span>
                <span className="font-display text-xl text-white">{formatCurrency(sale.total)}</span>
              </div>

              {/* Footer */}
              <div className="text-center mt-4 pt-3 border-t border-ink/10">
                <p className="text-[10px] text-muted-text">Thank you for your business!</p>
                <p className="text-[9px] text-muted-text mt-0.5">Powered by SerwaaBroni</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                onClick={handleShareWhatsApp}
                className="h-11 bg-[#25D366] rounded-sm font-display text-xs text-white uppercase tracking-wider flex items-center justify-center gap-1.5"
              >
                {shared ? <Check size={14} /> : <Share2 size={14} />}
                {shared ? 'Sent' : 'WhatsApp'}
              </button>
              <button
                onClick={handleDownloadImage}
                className="h-11 bg-ink rounded-sm font-display text-xs text-white uppercase tracking-wider flex items-center justify-center gap-1.5"
              >
                <Download size={14} />
                Save
              </button>
              <button
                onClick={onClose}
                className="h-11 bg-warm-gray rounded-sm font-display text-xs text-ink uppercase tracking-wider flex items-center justify-center gap-1.5"
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
