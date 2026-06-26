import { describe, it, expect } from 'vitest'
import { dedupeDebtsById, applyQueuedDebtUpdates, mergeDebts, type QueuedOperation } from './offline'
import type { Debt } from '@/lib/supabase'

const baseDebt = (over: Partial<Debt>): Debt => ({
  id: 'd1',
  user_id: 'u1',
  person_name: 'Ama',
  phone: null,
  amount: 220,
  amount_paid: 0,
  payments: [],
  description: null,
  type: 'owed',
  due_date: null,
  is_paid: false,
  paid_at: null,
  created_at: '2026-06-20T00:00:00.000Z',
  ...over,
})

const updateOp = (data: Record<string, unknown>, timestamp: number): QueuedOperation => ({
  id: `op_${timestamp}`,
  table: 'debts',
  operation: 'update',
  data,
  timestamp,
})

describe('dedupeDebtsById', () => {
  it('keeps the last occurrence so remote wins over an optimistic local copy', () => {
    const local = baseDebt({ user_id: 'local', amount_paid: 56 })
    const remote = baseDebt({ user_id: 'u1', amount_paid: 0 })
    // merge order: [...local, ...remote] — remote is authoritative
    const out = dedupeDebtsById([local, remote])
    expect(out).toHaveLength(1)
    expect(out[0].user_id).toBe('u1')
  })

  it('preserves ids that only exist locally (not yet synced)', () => {
    const remote = baseDebt({ id: 'd1' })
    const localOnly = baseDebt({ id: 'd2', user_id: 'local' })
    const out = dedupeDebtsById([localOnly, remote])
    expect(out.map((d) => d.id).sort()).toEqual(['d1', 'd2'])
  })
})

describe('applyQueuedDebtUpdates', () => {
  it('re-overlays a queued payment onto a stale remote debt so it does not revert', () => {
    const remote = [baseDebt({ amount_paid: 0, payments: [] })]
    const queue = [
      updateOp(
        { id: 'd1', amount_paid: 56, payments: [{ amount: 56, date: '2026-06-20T10:00:00.000Z' }], is_paid: false },
        1000,
      ),
    ]
    const out = applyQueuedDebtUpdates(remote, queue)
    expect(out[0].amount_paid).toBe(56)
    expect(out[0].payments).toHaveLength(1)
  })

  it('applies updates in timestamp order — latest wins', () => {
    const remote = [baseDebt({ amount_paid: 0 })]
    const queue = [
      updateOp({ id: 'd1', amount_paid: 100 }, 2000),
      updateOp({ id: 'd1', amount_paid: 56 }, 1000),
    ]
    const out = applyQueuedDebtUpdates(remote, queue)
    expect(out[0].amount_paid).toBe(100)
  })

  it('never lets a queued update change the row id', () => {
    const remote = [baseDebt({ id: 'd1' })]
    const queue = [updateOp({ id: 'd1', amount_paid: 10 }, 1000)]
    const out = applyQueuedDebtUpdates(remote, queue)
    expect(out[0].id).toBe('d1')
  })

  it('ignores queued ops for other tables', () => {
    const remote = [baseDebt({ amount_paid: 0 })]
    const queue: QueuedOperation[] = [
      { id: 'op1', table: 'sales', operation: 'update', data: { id: 'd1', amount_paid: 999 }, timestamp: 1 },
    ]
    const out = applyQueuedDebtUpdates(remote, queue)
    expect(out[0].amount_paid).toBe(0)
  })

  it('drops a row with a pending delete so it does not reappear before sync', () => {
    const remote = [baseDebt({ id: 'd1' }), baseDebt({ id: 'd2' })]
    const queue: QueuedOperation[] = [
      { id: 'op1', table: 'debts', operation: 'delete', data: { id: 'd2' }, timestamp: 1 },
    ]
    const out = applyQueuedDebtUpdates(remote, queue)
    expect(out.map((d) => d.id)).toEqual(['d1'])
  })

  it('appends a queued insert for an id missing from remote', () => {
    const remote = [baseDebt({ id: 'd1' })]
    const queue: QueuedOperation[] = [
      { id: 'op1', table: 'debts', operation: 'insert', data: baseDebt({ id: 'd2', person_name: 'Yaa' }) as unknown as Record<string, unknown>, timestamp: 1 },
    ]
    const out = applyQueuedDebtUpdates(remote, queue)
    expect(out.map((d) => d.id).sort()).toEqual(['d1', 'd2'])
  })
})

// Regression for the reported bug: a payment recorded during a network blip
// "reverted" on the next refresh. This drives the exact merge refreshData runs.
describe('mergeDebts (refreshData reconciliation)', () => {
  it('does NOT revert a payment whose write failed but is still queued', () => {
    // Optimistic local copy of a SYNCED debt — carries the real user_id, so the
    // user_id==='local' filter drops it (this was bug #3). The stale server row
    // still shows the pre-payment balance because the write never landed (bug #1)
    // and was queued for retry (bug #2 fix).
    const localOptimistic = baseDebt({ id: 'd1', user_id: 'u1', amount_paid: 56, payments: [{ amount: 56, date: '2026-06-20T10:00:00.000Z' }] })
    const staleRemote = baseDebt({ id: 'd1', user_id: 'u1', amount_paid: 0, payments: [] })
    const queue: QueuedOperation[] = [
      { id: 'op1', table: 'debts', operation: 'update', data: { id: 'd1', amount_paid: 56, payments: [{ amount: 56, date: '2026-06-20T10:00:00.000Z' }] }, timestamp: 1000 },
    ]

    const out = mergeDebts([localOptimistic], [staleRemote], queue)

    expect(out).toHaveLength(1)
    expect(out[0].amount_paid).toBe(56) // would be 0 before the fix
    expect(out[0].payments).toHaveLength(1)
  })

  it('reverts cleanly once the write has synced (queue empty, remote is fresh)', () => {
    const freshRemote = baseDebt({ id: 'd1', user_id: 'u1', amount_paid: 56, payments: [{ amount: 56, date: '2026-06-20T10:00:00.000Z' }] })
    const out = mergeDebts([], [freshRemote], [])
    expect(out[0].amount_paid).toBe(56)
  })

  it('keeps an unsynced brand-new debt (user_id local) and dedupes once it syncs', () => {
    const localNew = baseDebt({ id: 'd2', user_id: 'local', person_name: 'Yaa' })
    // before sync: remote has no d2 → local copy survives
    expect(mergeDebts([localNew], [], []).map((d) => d.id)).toEqual(['d2'])
    // after sync: remote now has d2 with the real user_id → no duplicate, remote wins
    const remoteD2 = baseDebt({ id: 'd2', user_id: 'u1', person_name: 'Yaa' })
    const merged = mergeDebts([localNew], [remoteD2], [])
    expect(merged).toHaveLength(1)
    expect(merged[0].user_id).toBe('u1')
  })

  it('orders results newest-first', () => {
    const older = baseDebt({ id: 'a', created_at: '2026-06-01T00:00:00.000Z' })
    const newer = baseDebt({ id: 'b', created_at: '2026-06-20T00:00:00.000Z' })
    const out = mergeDebts([], [older, newer], [])
    expect(out.map((d) => d.id)).toEqual(['b', 'a'])
  })
})
