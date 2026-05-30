import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { X, Share2, Download } from 'lucide-react'
import { formatCurrency } from '@/lib/data'

interface QRDisplayProps {
  isOpen: boolean
  onClose: () => void
  type: 'invoice' | 'payment' | 'product'
  data: {
    id: string
    title: string
    amount?: number
    description?: string
  }
}

export default function QRDisplay({ isOpen, onClose, type, data }: QRDisplayProps) {
  const [copied, setCopied] = useState(false)

  const qrValue = JSON.stringify({
    type,
    id: data.id,
    title: data.title,
    amount: data.amount,
    description: data.description,
    timestamp: new Date().toISOString(),
    merchant: "Maame Doku's Shop",
  })

  const handleShare = async () => {
    const text = `${data.title}${data.amount ? ` - ${formatCurrency(data.amount)}` : ''}\nScan to pay ${data.description || ''}`
    if (navigator.share) {
      try {
        await navigator.share({
          title: data.title,
          text,
        })
      } catch {
        // cancelled
      }
    } else {
      // Fallback - copy to clipboard
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm p-6 z-50 w-[90vw] max-w-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg uppercase tracking-tight">
                {type === 'invoice' ? 'Invoice QR' : type === 'payment' ? 'Payment QR' : 'Product QR'}
              </h3>
              <button onClick={onClose} className="btn-tactile w-8 h-8 flex items-center justify-center rounded-sm bg-warm-gray">
                <X size={16} strokeWidth={2.5} className="text-ink" />
              </button>
            </div>

            <div className="bg-white p-4 rounded-sm harsh-border flex flex-col items-center">
              <QRCodeSVG
                value={qrValue}
                size={200}
                level="M"
                includeMargin={false}
                bgColor="#FFFFFF"
                fgColor="#1A150D"
              />
              <p className="font-display text-sm uppercase mt-3 text-center">{data.title}</p>
              {data.amount !== undefined && (
                <p className="font-display text-2xl text-accent-green mt-1">{formatCurrency(data.amount)}</p>
              )}
              <p className="text-[10px] text-muted-text mt-1 text-center">{data.description}</p>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={handleShare}
                className="btn-tactile flex-1 h-12 bg-ink text-white font-display text-sm uppercase tracking-wider rounded-sm flex items-center justify-center gap-2"
              >
                <Share2 size={16} strokeWidth={2} />
                {copied ? 'COPIED!' : 'SHARE'}
              </button>
              <button
                onClick={() => {
                  const canvas = document.querySelector('canvas')
                  if (canvas) {
                    const url = (canvas as HTMLCanvasElement).toDataURL('image/png')
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${data.title.replace(/\s+/g, '_')}_qr.png`
                    a.click()
                  }
                }}
                className="btn-tactile flex-1 h-12 bg-warm-gray font-display text-sm uppercase tracking-wider rounded-sm flex items-center justify-center gap-2"
              >
                <Download size={16} strokeWidth={2} />
                SAVE
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
