import { useStore } from '@/lib/store'
import { signOut } from '@/services/auth'
import { AlertTriangle } from 'lucide-react'

export default function SuspendedScreen() {
  const { state } = useStore()
  const reason = state.businessProfile?.suspended_reason

  return (
    <div className="h-[100dvh] w-full bg-sand flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="w-14 h-14 mx-auto rounded-sm bg-accent-red/10 flex items-center justify-center">
          <AlertTriangle className="text-accent-red" size={28} />
        </div>
        <h1 className="font-display text-xl text-ink uppercase tracking-tight mt-4">
          Account Suspended
        </h1>
        <p className="text-sm text-muted-text mt-2">
          This shop has been suspended by the platform administrator.
          {reason ? ` Reason: ${reason}` : ''}
        </p>
        <p className="text-xs text-muted-text mt-2">
          Contact support to restore access.
        </p>
        <button
          onClick={async () => { await signOut(); window.location.href = '/login' }}
          className="btn-tactile mt-6 h-10 px-6 bg-ink text-white rounded-sm font-display text-xs uppercase"
        >
          Log Out
        </button>
      </div>
    </div>
  )
}
