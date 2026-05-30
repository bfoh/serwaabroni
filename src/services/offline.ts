import { supabase } from '@/lib/supabase'
import type { Product, Sale, Debt, Expense } from '@/lib/supabase'

// ============================================
// OFFLINE SYNC QUEUE
// ============================================

interface QueuedOperation {
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

function getQueue(): QueuedOperation[] {
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
