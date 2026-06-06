// Pure FIFO allocation: decide which batches a sale draws from.
// Callers pass batches already sorted oldest-first (purchased_at ASC).

export interface FifoBatch {
  id: string
  qty_remaining: number
  unit_cost: number
  injection_id: string | null
}

export interface FifoDraw {
  batch_id: string
  injection_id: string | null
  qty: number
  unit_cost: number
  unit_price: number
  profit: number
}

export interface FifoResult {
  draws: FifoDraw[]
  /** Units that exceeded all tracked batch stock (oversell). */
  untrackedQty: number
}

export function allocateFifo(
  batches: FifoBatch[],
  quantity: number,
  unitPrice: number
): FifoResult {
  const draws: FifoDraw[] = []
  let remaining = quantity

  for (const b of batches) {
    if (remaining <= 0) break
    if (b.qty_remaining <= 0) continue
    const take = Math.min(b.qty_remaining, remaining)
    draws.push({
      batch_id: b.id,
      injection_id: b.injection_id,
      qty: take,
      unit_cost: b.unit_cost,
      unit_price: unitPrice,
      profit: round2((unitPrice - b.unit_cost) * take),
    })
    remaining -= take
  }

  return { draws, untrackedQty: remaining }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
