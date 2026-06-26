import { supabase } from '@/lib/supabase'
import type { Product, Sale, Debt, Expense } from '@/lib/supabase'

// ============================================
// OFFLINE SYNC QUEUE
// ============================================

export interface QueuedOperation {
  id: string
  table: string
  operation: 'insert' | 'update' | 'delete'
  data: Record<string, unknown>
  timestamp: number
}

const SYNC_QUEUE_KEY = 'serwaabroni_sync_queue'
const OFFLINE_DATA_KEY = 'serwaabroni_offline_data'

// Queue an operation for later sync
export function queueOperation(table: string, operation: 'insert' | 'update' | 'delete', data: Record<string, unknown>): void {
  const queue = getQueue()
  queue.push({
    id: `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    table,
    operation,
    data,
    timestamp: Date.now(),
  })
  saveQueue(queue)
}

export function getQueue(): QueuedOperation[] {
  try {
    const stored = localStorage.getItem(SYNC_QUEUE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveQueue(queue: QueuedOperation[]): void {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // storage full
  }
}

// Check if online
export function isOnline(): boolean {
  return navigator.onLine
}

// Sync all queued operations
export async function syncQueue(): Promise<{ success: number; failed: number }> {
  const queue = getQueue()
  if (queue.length === 0) return { success: 0, failed: 0 }

  let success = 0
  let failed = 0
  const remaining: QueuedOperation[] = []

  for (const op of queue) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        remaining.push(op)
        continue
      }

      const table = op.table as 'products' | 'sales' | 'debts' | 'expenses'
      const payload = { ...op.data, user_id: user.id } as Record<string, unknown>

      if (op.operation === 'insert') {
        const { error } = await supabase.from(table).insert(payload)
        if (error) throw error
      } else if (op.operation === 'update') {
        const id = payload.id as string
        const { id: _id, ...updates } = payload
        void _id
        const { error } = await supabase.from(table).update(updates).eq('id', id)
        if (error) throw error
      } else if (op.operation === 'delete') {
        const id = payload.id as string
        const { error } = await supabase.from(table).delete().eq('id', id)
        if (error) throw error
      }

      success++
    } catch {
      failed++
      remaining.push(op)
    }
  }

  saveQueue(remaining)
  return { success, failed }
}

// ============================================
// PENDING-WRITE RECONCILIATION (pure helpers)
// ============================================
// These keep optimistic edits alive across reloads. When a write fails (flaky
// network), it's queued AND optimistically applied in memory. The optimistic
// row carries the real user_id, so a naive "remote replaces local" merge would
// drop it on the next refresh — making a recorded payment appear to "revert".
// We dedupe by id (remote wins) then re-overlay any STILL-pending queued debt
// updates so nothing the user saved silently disappears before it syncs.

// Collapse rows sharing an id, keeping the LAST occurrence. Callers pass
// [...localEdits, ...remote] so the authoritative remote row wins, while ids
// that only exist locally (not yet synced) are preserved.
export function dedupeDebtsById(debts: Debt[]): Debt[] {
  const byId = new Map<string, Debt>()
  for (const d of debts) byId.set(d.id, d)
  return Array.from(byId.values())
}

// Re-apply queued 'debts' updates/inserts on top of a debt list. Updates are
// merged in timestamp order (latest wins) onto the matching id; queued inserts
// for ids not present are appended. Anything already synced is a no-op because
// the queue only holds writes the server hasn't confirmed yet.
export function applyQueuedDebtUpdates(debts: Debt[], queue: QueuedOperation[]): Debt[] {
  const byId = new Map<string, Debt>()
  for (const d of debts) byId.set(d.id, d)

  const debtOps = queue
    .filter((op) => op.table === 'debts')
    .sort((a, b) => a.timestamp - b.timestamp)

  for (const op of debtOps) {
    const id = op.data.id as string | undefined
    if (!id) continue
    if (op.operation === 'delete') {
      byId.delete(id)
      continue
    }
    const existing = byId.get(id)
    if (existing) {
      byId.set(id, { ...existing, ...(op.data as Partial<Debt>), id } as Debt)
    } else if (op.operation === 'insert') {
      byId.set(id, op.data as unknown as Debt)
    }
  }

  return Array.from(byId.values())
}

// The full debt reconciliation used by refreshData: take the cached local rows
// and the authoritative remote rows, keep only genuinely-unsynced locals (real
// rows are dropped here — they'd otherwise duplicate or override remote), let
// remote win on shared ids, then re-overlay anything still queued so a payment
// recorded during a network blip survives the refresh instead of reverting.
// Newest-first to match the UI ordering.
export function mergeDebts(localDebts: Debt[], remoteDebts: Debt[], queue: QueuedOperation[]): Debt[] {
  const merged = applyQueuedDebtUpdates(
    dedupeDebtsById([...localDebts.filter((d) => d.user_id === 'local'), ...remoteDebts]),
    queue,
  )
  return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

// ============================================
// OFFLINE DATA CACHE
// ============================================

interface CachedData {
  products: Product[]
  sales: Sale[]
  debts: Debt[]
  expenses: Expense[]
  lastSync: number
}

export function cacheOfflineData(data: CachedData): void {
  try {
    localStorage.setItem(OFFLINE_DATA_KEY, JSON.stringify({ ...data, lastSync: Date.now() }))
  } catch {
    // storage full
  }
}

export function getOfflineData(): CachedData | null {
  try {
    const stored = localStorage.getItem(OFFLINE_DATA_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

// ============================================
// NETWORK STATUS LISTENER
// ============================================

export function onNetworkChange(callback: (online: boolean) => void): () => void {
  const handleOnline = () => callback(true)
  const handleOffline = () => callback(false)

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}

// Auto-sync when coming back online
export function setupAutoSync(onComplete?: (result: { success: number; failed: number }) => void): () => void {
  const cleanup = onNetworkChange(async (online) => {
    if (online) {
      const result = await syncQueue()
      onComplete?.(result)
    }
  })

  // Also sync on page visibility change
  const handleVisibility = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      syncQueue().then(onComplete)
    }
  }
  document.addEventListener('visibilitychange', handleVisibility)

  return () => {
    cleanup()
    document.removeEventListener('visibilitychange', handleVisibility)
  }
}
