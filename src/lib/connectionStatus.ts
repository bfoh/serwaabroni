export type ConnVariant = 'hidden' | 'offline' | 'syncing' | 'synced'

export interface ConnStatus {
  variant: ConnVariant
  text: string
}

const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`

// Map raw connectivity + queue depth + reconnect phase to what the bar shows.
// Offline always wins; 'reconnected' is a short-lived phase the component sets
// when the network flips back so we can show a sync/confirmation message.
export function connectionStatus(
  isOnline: boolean,
  pending: number,
  phase: 'idle' | 'reconnected',
): ConnStatus {
  if (!isOnline) {
    return {
      variant: 'offline',
      text: pending > 0 ? `Offline — ${changes(pending)} will sync when reconnected` : 'Offline',
    }
  }
  if (phase === 'reconnected') {
    return pending > 0
      ? { variant: 'syncing', text: `Back online — syncing ${pending}…` }
      : { variant: 'synced', text: 'All changes synced' }
  }
  return { variant: 'hidden', text: '' }
}
