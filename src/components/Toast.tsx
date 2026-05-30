import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle } from 'lucide-react'
import { useStore } from '@/lib/store'

export default function Toast() {
  const { state } = useStore()

  return (
    <AnimatePresence>
      {state.toast && (
        <motion.div
          initial={{ opacity: 0, y: -50, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -50, x: '-50%' }}
          transition={{ duration: 0.2 }}
          className={`fixed top-6 left-1/2 z-[60] flex items-center gap-2 px-5 py-3 harsh-border rounded-sm shadow-lg ${
            state.toast.type === 'success' ? 'bg-accent-green text-white' : 'bg-accent-red text-white'
          }`}
        >
          {state.toast.type === 'success' ? (
            <CheckCircle size={18} strokeWidth={2.5} />
          ) : (
            <XCircle size={18} strokeWidth={2.5} />
          )}
          <span className="font-body text-sm font-medium">{state.toast.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
