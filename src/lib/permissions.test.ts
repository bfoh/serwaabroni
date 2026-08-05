import { describe, it, expect } from 'vitest'
import { canView, settingsAccessFor, visibleMainTabKeys } from './permissions'

describe('canView', () => {
  it('grants owner every area', () => {
    expect(canView('owner', 'cashFlow')).toBe(true)
    expect(canView('owner', 'capital')).toBe(true)
    expect(canView('owner', 'staffManage')).toBe(true)
    expect(canView('owner', 'costPrice')).toBe(true)
  })
  it('grants manager sales/stock/expenses/reports/costPrice but not cash/capital/staff', () => {
    expect(canView('manager', 'expenses')).toBe(true)
    expect(canView('manager', 'reports')).toBe(true)
    expect(canView('manager', 'costPrice')).toBe(true)
    expect(canView('manager', 'cashFlow')).toBe(false)
    expect(canView('manager', 'capital')).toBe(false)
    expect(canView('manager', 'staffManage')).toBe(false)
  })
  it('grants staff only sales/stock/customersDebts/voiceAgent', () => {
    expect(canView('staff', 'sales')).toBe(true)
    expect(canView('staff', 'stockEdit')).toBe(true)
    expect(canView('staff', 'customersDebts')).toBe(true)
    expect(canView('staff', 'voiceAgent')).toBe(true)
    expect(canView('staff', 'expenses')).toBe(false)
    expect(canView('staff', 'reports')).toBe(false)
    expect(canView('staff', 'cashFlow')).toBe(false)
    expect(canView('staff', 'capital')).toBe(false)
    expect(canView('staff', 'costPrice')).toBe(false)
  })
  it('denies everything when role is null/undefined', () => {
    expect(canView(null, 'sales')).toBe(false)
    expect(canView(undefined, 'sales')).toBe(false)
  })
})

describe('settingsAccessFor', () => {
  it('owner can edit, manager view-only, staff none', () => {
    expect(settingsAccessFor('owner')).toBe('edit')
    expect(settingsAccessFor('manager')).toBe('view')
    expect(settingsAccessFor('staff')).toBe('none')
    expect(settingsAccessFor(null)).toBe('none')
  })
})

describe('visibleMainTabKeys', () => {
  it('includes reports for owner and manager, excludes it for staff', () => {
    expect(visibleMainTabKeys('owner')).toEqual(['home', 'stock', 'debts', 'reports'])
    expect(visibleMainTabKeys('manager')).toEqual(['home', 'stock', 'debts', 'reports'])
    expect(visibleMainTabKeys('staff')).toEqual(['home', 'stock', 'debts'])
    expect(visibleMainTabKeys(null)).toEqual(['home', 'stock', 'debts'])
  })
})
