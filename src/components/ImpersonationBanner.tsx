import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { useStore } from '@/lib/store'

export default function ImpersonationBanner() {
  const { state, exitImpersonation, showToast } = useStore()
  const [exiting, setExiting] = useState(false)
  if (!state.impersonating) return null

  const exit = async () => {
    setExiting(true)
    try {
      await exitImpersonation()
    } catch {
      showToast('Could not exit — please log in again', 'error')
    } finally {
      setExiting(false)
    }
  }

  return (
    <div className="flex-shrink-0 bg-accent-red text-white px-4 py-2 pt-safe flex items-center justify-between gap-3 z-50 relative">
      <p className="text-xs font-medium truncate">
        ⚠ Acting as {state.impersonating.tenantName} — changes save to their shop
      </p>
      <button
        onClick={exit}
        disabled={exiting}
        className="btn-tactile flex-shrink-0 bg-white/20 rounded-sm px-3 py-1 text-xs font-display uppercase flex items-center gap-1 disabled:opacity-50"
      >
        <LogOut size={13} /> {exiting ? '...' : 'Exit'}
      </button>
    </div>
  )
}
