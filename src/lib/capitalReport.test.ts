import { describe, it, expect } from 'vitest'
import { buildWeeklyReport, isoWeekKey, type ReportConsumption } from './capitalReport'

const c = (created_at: string, qty: number, profit: number): ReportConsumption => ({ created_at, qty, profit })

describe('isoWeekKey', () => {
  it('labels a date with its ISO year-week', () => {
    // 2026-01-05 is a Monday in ISO week 2 of 2026
    expect(isoWeekKey('2026-01-05T10:00:00.000Z')).toBe('2026-W02')
  })
  it('groups days within the same ISO week under one key', () => {
    expect(isoWeekKey('2026-01-05T00:00:00.000Z')).toBe(isoWeekKey('2026-01-11T23:00:00.000Z'))
  })
})

describe('buildWeeklyReport', () => {
  it('returns empty when there are no consumptions', () => {
    expect(buildWeeklyReport([])).toEqual([])
  })

  it('sums profit and units per week, newest first', () => {
    const rows = buildWeeklyReport([
      c('2026-01-05T10:00:00.000Z', 2, 20), // W02
      c('2026-01-06T10:00:00.000Z', 1, 10), // W02
      c('2026-01-13T10:00:00.000Z', 5, 50), // W03
    ])
    expect(rows.map((r) => r.week)).toEqual(['2026-W03', '2026-W02'])
    expect(rows[0]).toMatchObject({ week: '2026-W03', profit: 50, units: 5 })
    expect(rows[1]).toMatchObject({ week: '2026-W02', profit: 30, units: 3 })
  })

  it('reports week-over-week profit delta (this week minus the prior week)', () => {
    const rows = buildWeeklyReport([
      c('2026-01-05T10:00:00.000Z', 2, 30), // W02 profit 30
      c('2026-01-13T10:00:00.000Z', 5, 50), // W03 profit 50
    ])
    // newest first: W03 delta = 50 - 30 = 20 ; W02 delta = 30 - 0 = 30
    expect(rows[0]).toMatchObject({ week: '2026-W03', deltaVsPrev: 20 })
    expect(rows[1]).toMatchObject({ week: '2026-W02', deltaVsPrev: 30 })
  })

  it('accumulates a running cumulative profit oldest→newest', () => {
    const rows = buildWeeklyReport([
      c('2026-01-05T10:00:00.000Z', 2, 30), // W02
      c('2026-01-13T10:00:00.000Z', 5, 50), // W03
    ])
    // cumulative is total recovered up to and including that week
    expect(rows.find((r) => r.week === '2026-W02')!.cumulative).toBe(30)
    expect(rows.find((r) => r.week === '2026-W03')!.cumulative).toBe(80)
  })
})
