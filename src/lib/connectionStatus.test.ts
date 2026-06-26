import { describe, it, expect } from 'vitest'
import { connectionStatus } from './connectionStatus'

describe('connectionStatus', () => {
  it('is hidden when online, idle, nothing pending', () => {
    expect(connectionStatus(true, 0, 'idle')).toEqual({ variant: 'hidden', text: '' })
  })

  it('shows offline with no count when queue empty', () => {
    expect(connectionStatus(false, 0, 'idle')).toEqual({ variant: 'offline', text: 'Offline' })
  })

  it('shows offline with singular count', () => {
    expect(connectionStatus(false, 1, 'idle')).toEqual({
      variant: 'offline', text: 'Offline — 1 change will sync when reconnected',
    })
  })

  it('shows offline with plural count', () => {
    expect(connectionStatus(false, 3, 'idle')).toEqual({
      variant: 'offline', text: 'Offline — 3 changes will sync when reconnected',
    })
  })

  it('offline takes priority over a reconnected phase', () => {
    expect(connectionStatus(false, 2, 'reconnected').variant).toBe('offline')
  })

  it('shows syncing when reconnected with pending work', () => {
    expect(connectionStatus(true, 2, 'reconnected')).toEqual({
      variant: 'syncing', text: 'Back online — syncing 2…',
    })
  })

  it('shows synced confirmation when reconnected and queue drained', () => {
    expect(connectionStatus(true, 0, 'reconnected')).toEqual({
      variant: 'synced', text: 'All changes synced',
    })
  })
})
