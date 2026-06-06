export interface StockBatchLite {
  product_id: string
  product_name: string
  qty_purchased: number
  qty_remaining: number
  unit_cost: number
  total_cost: number
}

export interface ConsumptionLite {
  product_id: string
  qty: number
  profit: number
}

export interface InjectionStockRow {
  product_id: string
  product_name: string
  qty_purchased: number
  qty_remaining: number
  qty_sold: number
  total_cost: number
  realized_profit: number
  remaining_profit: number
}

export interface InjectionStockSummary {
  rows: InjectionStockRow[]
  totalCost: number
  realizedProfit: number
  remainingProfit: number
  projectedProfit: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function summarizeInjectionStock(
  batches: StockBatchLite[],
  consumptions: ConsumptionLite[],
  sellingPriceById: Record<string, number>
): InjectionStockSummary {
  const rowMap = new Map<string, InjectionStockRow>()

  // 1. Group batches by product_id
  for (const batch of batches) {
    if (!rowMap.has(batch.product_id)) {
      rowMap.set(batch.product_id, {
        product_id: batch.product_id,
        product_name: batch.product_name,
        qty_purchased: 0,
        qty_remaining: 0,
        qty_sold: 0,
        total_cost: 0,
        realized_profit: 0,
        remaining_profit: 0,
      })
    }

    const row = rowMap.get(batch.product_id)!
    row.qty_purchased += batch.qty_purchased
    row.qty_remaining += batch.qty_remaining
    row.total_cost += batch.total_cost

    const sellingPrice = sellingPriceById[batch.product_id] ?? 0
    // Remaining profit contribution from this specific batch
    const batchRemainingProfit = batch.qty_remaining * (sellingPrice - batch.unit_cost)
    row.remaining_profit += batchRemainingProfit
  }

  // 2. Add consumptions
  for (const cons of consumptions) {
    if (rowMap.has(cons.product_id)) {
      const row = rowMap.get(cons.product_id)!
      row.qty_sold += cons.qty
      row.realized_profit += cons.profit
    }
  }

  // 3. Build summary
  const rows = Array.from(rowMap.values())
  let totalCost = 0
  let realizedProfit = 0
  let remainingProfit = 0

  for (const row of rows) {
    row.total_cost = round2(row.total_cost)
    row.realized_profit = round2(row.realized_profit)
    row.remaining_profit = round2(row.remaining_profit)

    totalCost += row.total_cost
    realizedProfit += row.realized_profit
    remainingProfit += row.remaining_profit
  }

  totalCost = round2(totalCost)
  realizedProfit = round2(realizedProfit)
  remainingProfit = round2(remainingProfit)
  const projectedProfit = round2(realizedProfit + remainingProfit)

  return {
    rows,
    totalCost,
    realizedProfit,
    remainingProfit,
    projectedProfit,
  }
}
