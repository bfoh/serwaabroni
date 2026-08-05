import { describe, it, expect } from 'vitest'
import { resolveScopeId } from './scopeId'

describe('resolveScopeId', () => {
  it('returns null when there is no authenticated user', () => {
    expect(resolveScopeId(null, null, false)).toBeNull()
  })
  it('returns the resolved business id when the RPC succeeds', () => {
    expect(resolveScopeId('staff-uid', 'owner-uid', false)).toBe('owner-uid')
  })
  it('falls back to the raw auth uid when the RPC errors (e.g. offline)', () => {
    expect(resolveScopeId('owner-uid', null, true)).toBe('owner-uid')
  })
  it('falls back to the raw auth uid when the RPC returns nothing', () => {
    expect(resolveScopeId('owner-uid', null, false)).toBe('owner-uid')
  })
})
