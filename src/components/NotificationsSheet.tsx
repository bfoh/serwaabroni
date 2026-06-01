import { motion } from 'framer-motion'
import { X, AlertTriangle, AlertCircle, Info, PhoneCall, ArrowRight, ShieldAlert } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { Alert } from '@/lib/alerts'

interface NotificationsSheetProps {
  onClose: () => void
}

export default function NotificationsSheet({ onClose }: NotificationsSheetProps) {
  const { state, setTab } = useStore()
  const alerts = state.alerts || []

  const getIcon = (alert: Alert) => {
    switch (alert.type) {
      case 'danger': return <AlertTriangle size={20} className="text-accent-red" />
      case 'warning': return <AlertCircle size={20} className="text-yellow-600" />
      case 'info': return <Info size={20} className="text-blue-500" />
      case 'success': return <ShieldAlert size={20} className="text-green-600" />
    }
  }

  const handleActionClick = (alert: Alert) => {
    if (alert.actionPhone) {
      window.location.href = `tel:${alert.actionPhone}`
    } else if (alert.actionLink) {
      setTab(alert.actionLink as any)
      onClose()
    }
  }

  return (
    <div className="h-full flex flex-col bg-sand overflow-hidden">
      <div className="sticky top-0 z-10 bg-sand border-b-2 border-ink px-5 py-3 pt-safe flex items-center justify-between">
        <h2 className="font-display text-xl text-ink uppercase tracking-tight">Notifications</h2>
        <button onClick={onClose} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
          <X size={20} strokeWidth={2.5} className="text-ink" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-text space-y-3">
            <ShieldAlert size={48} className="opacity-20" />
            <p className="font-display uppercase text-sm">No new alerts</p>
            <p className="text-xs text-center">Your business is running smoothly!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert, i) => (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`bg-light p-4 rounded-sm harsh-border ${
                  alert.type === 'danger' ? 'border-l-4 border-l-accent-red' : 
                  alert.type === 'warning' ? 'border-l-4 border-l-yellow-500' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{getIcon(alert)}</div>
                  <div className="flex-1">
                    <h3 className="font-display text-sm text-ink uppercase">{alert.title}</h3>
                    <p className="text-xs text-ink/80 mt-1 leading-snug">{alert.message}</p>
                    
                    {alert.actionLabel && (
                      <button
                        onClick={() => handleActionClick(alert)}
                        className="mt-3 text-xs font-display uppercase tracking-wider text-ink bg-warm-gray px-3 py-1.5 rounded-sm inline-flex items-center gap-2 hover:bg-ink hover:text-white transition-colors"
                      >
                        {alert.actionPhone ? <PhoneCall size={12} /> : <ArrowRight size={12} />}
                        {alert.actionLabel}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
