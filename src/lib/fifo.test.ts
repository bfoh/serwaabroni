import { describe, it, expect } from 'vitest'
import { allocateFifo, type FifoBatch } from './fifo'

const batch = (id: string, qty_remaining: number, unit_cost: number): FifoBatch => ({
  id,
  qty_remaining,
  unit_cost,
  injection_id: null,
})

describe('allocateFifo', () => {
  it('draws entirely from a single batch when it has enough', () => {
    const res = allocateFifo([batch('b1', 10, 5)], 4, 8)
    expect(res.draws).toEqual([
      { batch_id: 'b1', injection_id: null, qty: 4, unit_cost: 5, unit_price: 8, profit: 12 },
    ])
    expect(res.untrackedQty).toBe(0)
  })

  it('spans multiple batches oldest-first', () => {
    const res = allocateFifo([batch('b1', 3, 5), batch('b2', 10, 6)], 5, 10)
    expect(res.draws).toEqual([
      { batch_id: 'b1', injection_id: null, qty: 3, unit_cost: 5, unit_price: 10, profit: 15 },
      { batch_id: 'b2', injection_id: null, qty: 2, unit_cost: 6, unit_price: 10, profit: 8 },
    ])
    expect(res.untrackedQty).toBe(0)
  })

  it('carries injection_id through onto each draw', () => {
    const b: FifoBatch = { id: 'b1', qty_remaining: 5, unit_cost: 4, injection_id: 'inj-1' }
    const res = allocateFifo([b], 2, 9)
    expect(res.draws[0].injection_id).toBe('inj-1')
  })

  it('reports leftover as untracked when stock runs out', () => {
    const res = allocateFifo([batch('b1', 2, 5)], 5, 10)
    expect(res.draws).toEqual([
      { batch_id: 'b1', injection_id: null, qty: 2, unit_cost: 5, unit_price: 10, profit: 10 },
    ])
    expect(res.untrackedQty).toBe(3)
  })

  it('returns all-untracked when there are no batches', () => {
    const res = allocateFifo([], 4, 10)
    expect(res.draws).toEqual([])
    expect(res.untrackedQty).toBe(4)
  })

  it('skips empty batches', () => {
    const res = allocateFifo([batch('b1', 0, 5), batch('b2', 4, 6)], 2, 10)
    expect(res.draws).toEqual([
      { batch_id: 'b2', injection_id: null, qty: 2, unit_cost: 6, unit_price: 10, profit: 8 },
    ])
  })
})
