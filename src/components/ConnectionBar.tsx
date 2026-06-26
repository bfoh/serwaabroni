import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff, RefreshCw, CheckCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { connectionStatus, type ConnVariant } from '@/lib/connectionStatus'

const VARIANT_STYLE: Record<Exclude<ConnVariant, 'hidden'>, string> = {
  offline: 'bg-accent-red text-white',
  syncing: 'bg-amber-600 text-white',
  synced: 'bg-accent-green text-white',
}

export default function ConnectionBar() {
  const { state } = useStore()
  const { isOnline, pendingSync } = state
  const [phase, setPhase] = useState<'idle' | 'reconnected'>('idle')
  const prevOnline = useRef(isOnline)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When the network flips offline->online, enter the 'reconnected' phase so the
  // bar shows "syncing"/"synced", then drop back to idle (which hides it).
  useEffect(() => {
    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
    if (!prevOnline.current && isOnline) {
      setPhase('reconnected')
    }
    if (!isOnline) {
      clear()
      setPhase('idle') // offline variant doesn't depend on phase
    }
    prevOnline.current = isOnline
    return clear
  }, [isOnline])

  // Once reconnected and the queue is drained, show the confirmation briefly
  // then return to idle so the bar auto-hides.
  useEffect(() => {
    if (phase === 'reconnected' && isOnline && pendingSync === 0) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setPhase('idle'), 2000)
    }
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  }, [phase, isOnline, pendingSync])

  const { variant, text } = connectionStatus(isOnline, pendingSync, phase)

  return (
    <AnimatePresence>
      {variant !== 'hidden' && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ duration: 0.2 }}
          className={`fixed top-0 left-0 right-0 z-[80] flex items-center justify-center gap-2 px-4 py-1.5 pt-safe text-xs font-medium font-body ${VARIANT_STYLE[variant]}`}
        >
          {variant === 'offline' && <WifiOff size={14} strokeWidth={2.5} />}
          {variant === 'syncing' && <RefreshCw size={14} strokeWidth={2.5} className="animate-spin" />}
          {variant === 'synced' && <CheckCircle size={14} strokeWidth={2.5} />}
          <span>{text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
