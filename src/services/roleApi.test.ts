import { describe, it, expect } from 'vitest'
import { parseRole } from './roleApi'

describe('parseRole', () => {
  it('returns null when the RPC errored', () => {
    expect(parseRole('owner', true)).toBeNull()
  })
  it('returns null for an unexpected value', () => {
    expect(parseRole('admin', false)).toBeNull()
    expect(parseRole(null, false)).toBeNull()
  })
  it('returns the role for each valid value', () => {
    expect(parseRole('owner', false)).toBe('owner')
    expect(parseRole('manager', false)).toBe('manager')
    expect(parseRole('staff', false)).toBe('staff')
  })
})
