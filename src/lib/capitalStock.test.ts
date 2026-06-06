import { describe, it, expect } from 'vitest'
import { summarizeInjectionStock } from './capitalStock'

describe('summarizeInjectionStock', () => {
  it('handles empty inputs', () => {
    const summary = summarizeInjectionStock([], [], {})
    expect(summary.rows).toEqual([])
    expect(summary.totalCost).toBe(0)
    expect(summary.realizedProfit).toBe(0)
    expect(summary.remainingProfit).toBe(0)
    expect(summary.projectedProfit).toBe(0)
  })

  it('summarizes a single batch correctly', () => {
    const summary = summarizeInjectionStock(
      [
        {
          product_id: 'p1',
          product_name: 'Product 1',
          qty_purchased: 10,
          qty_remaining: 10,
          unit_cost: 5,
          total_cost: 50,
        },
      ],
      [],
      { p1: 10 }
    )

    expect(summary.rows.length).toBe(1)
    expect(summary.rows[0].remaining_profit).toBe(50) // 10 * (10 - 5)
    expect(summary.totalCost).toBe(50)
    expect(summary.remainingProfit).toBe(50)
    expect(summary.realizedProfit).toBe(0)
    expect(summary.projectedProfit).toBe(50)
  })

  it('calculates remaining and realized profit properly with partial sales', () => {
    const summary = summarizeInjectionStock(
      [
        {
          product_id: 'p1',
          product_name: 'Product 1',
          qty_purchased: 10,
          qty_remaining: 6,
          unit_cost: 5,
          total_cost: 50,
        },
      ],
      [
        { product_id: 'p1', qty: 4, profit: 20 }, // Sold 4 at $10 each
      ],
      { p1: 10 }
    )

    expect(summary.rows[0].qty_purchased).toBe(10)
    expect(summary.rows[0].qty_remaining).toBe(6)
    expect(summary.rows[0].qty_sold).toBe(4)
    expect(summary.rows[0].realized_profit).toBe(20)
    expect(summary.rows[0].remaining_profit).toBe(30) // 6 * (10 - 5)
    
    expect(summary.totalCost).toBe(50)
    expect(summary.realizedProfit).toBe(20)
    expect(summary.remainingProfit).toBe(30)
    expect(summary.projectedProfit).toBe(50)
  })

  it('aggregates multiple batches for the same product with different costs', () => {
    const summary = summarizeInjectionStock(
      [
        {
          product_id: 'p1',
          product_name: 'Product 1',
          qty_purchased: 10,
          qty_remaining: 10,
          unit_cost: 5,
          total_cost: 50,
        },
        {
          product_id: 'p1',
          product_name: 'Product 1',
          qty_purchased: 5,
          qty_remaining: 5,
          unit_cost: 6, // Cost increased
          total_cost: 30,
        },
      ],
      [],
      { p1: 10 }
    )

    expect(summary.rows.length).toBe(1)
    expect(summary.rows[0].qty_purchased).toBe(15)
    expect(summary.rows[0].qty_remaining).toBe(15)
    expect(summary.rows[0].total_cost).toBe(80)
    expect(summary.rows[0].remaining_profit).toBe(70) // 10*(10-5) + 5*(10-6) = 50 + 20 = 70
    
    expect(summary.totalCost).toBe(80)
    expect(summary.remainingProfit).toBe(70)
    expect(summary.projectedProfit).toBe(70)
  })

  it('preserves negative remaining profit if selling below cost', () => {
    const summary = summarizeInjectionStock(
      [
        {
          product_id: 'p1',
          product_name: 'Product 1',
          qty_purchased: 10,
          qty_remaining: 10,
          unit_cost: 10,
          total_cost: 100,
        },
      ],
      [],
      { p1: 5 } // Selling price < unit cost
    )

    expect(summary.rows[0].remaining_profit).toBe(-50) // 10 * (5 - 10)
    expect(summary.projectedProfit).toBe(-50)
  })

  it('handles missing selling price as 0', () => {
    const summary = summarizeInjectionStock(
      [
        {
          product_id: 'p1',
          product_name: 'Product 1',
          qty_purchased: 10,
          qty_remaining: 10,
          unit_cost: 5,
          total_cost: 50,
        },
      ],
      [],
      {} // missing p1
    )

    expect(summary.rows[0].remaining_profit).toBe(-50) // 10 * (0 - 5)
  })
})
