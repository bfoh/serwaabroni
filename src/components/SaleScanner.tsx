import { useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency } from '@/lib/data'
import { normalizeBarcode } from '@/lib/scanner'
import { useScanCamera } from '@/hooks/useScanCamera'
import type { Product } from '@/lib/supabase'

interface SaleScannerProps {
  isOpen: boolean
  onClose: () => void
  onProductScanned: (product: Product) => void
  itemCount: number
  total: number
}

const COOLDOWN_MS = 1200

export default function SaleScanner({ isOpen, onClose, onProductScanned, itemCount, total }: SaleScannerProps) {
  const { state, showToast } = useStore()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const [flash, setFlash] = useState(false)

  const handleCode = useCallback((raw: string) => {
    const target = normalizeBarcode(raw)
    if (!target) return
    const now = Date.now()
    if (lastCodeRef.current.code === target && now - lastCodeRef.current.at < COOLDOWN_MS) return
    lastCodeRef.current = { code: target, at: now }

    const product = state.products.find(
      (p) => normalizeBarcode(p.barcode) === target || normalizeBarcode(p.qr_code) === target
    )
    if (product) {
      if (product.quantity < 1) { showToast(`${product.name} is out of stock`, 'error'); return }
      onProductScanned(product)
      setFlash(true)
      setTimeout(() => setFlash(false), 250)
      try { navigator.vibrate?.(60) } catch { /* no haptics */ }
      showToast(`Added ${product.name}`, 'success')
    } else {
      showToast('Not in inventory', 'error')
    }
  }, [state.products, onProductScanned, showToast])

  const { error } = useScanCamera({ videoRef, active: isOpen, onResult: handleCode })

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[65] bg-black flex flex-col"
        >
          <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />

          {/* green flash on a successful add */}
          {flash && <div className="absolute inset-0 bg-accent-green/40 pointer-events-none" />}

          {/* reticle */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-40 border-2 border-white/80 rounded-lg" />
          </div>

          {/* header */}
          <div className="relative z-10 flex items-center justify-between px-5 pt-safe py-4 bg-black/50">
            <div className="text-white">
              <p className="font-display text-lg uppercase tracking-tight">{itemCount} {itemCount === 1 ? 'item' : 'items'}</p>
              <p className="text-accent-green text-sm">{formatCurrency(total)}</p>
            </div>
            <button onClick={onClose} className="btn-tactile h-11 px-4 bg-white rounded-sm font-display text-sm uppercase tracking-wider text-ink flex items-center gap-2">
              <Check size={18} /> Done
            </button>
          </div>

          {/* hint / error */}
          <div className="absolute bottom-0 left-0 right-0 z-10 px-5 pb-safe pt-4 bg-black/50 text-center">
            {error ? (
              <div className="text-white">
                <p className="text-sm">Camera unavailable</p>
                <p className="text-xs text-white/60 mt-1">{error}</p>
                <button onClick={onClose} className="mt-3 h-11 px-5 bg-white rounded-sm font-display text-sm uppercase text-ink inline-flex items-center gap-2">
                  <X size={16} /> Close
                </button>
              </div>
            ) : (
              <p className="text-white/80 text-sm pb-2">Point at a product barcode or QR</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
