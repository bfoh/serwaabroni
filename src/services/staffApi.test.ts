import { describe, it, expect } from 'vitest'
import { normalizeInviteEmail } from './staffApi'

describe('normalizeInviteEmail', () => {
  it('trims whitespace and lowercases', () => {
    expect(normalizeInviteEmail('  Ama@Shop.COM  ')).toBe('ama@shop.com')
  })
  it('is a no-op for an already-clean email', () => {
    expect(normalizeInviteEmail('kofi@shop.com')).toBe('kofi@shop.com')
  })
})
