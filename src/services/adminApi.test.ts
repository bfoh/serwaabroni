import { describe, it, expect } from 'vitest'
import { parseAdminBackup } from './adminApi'

describe('parseAdminBackup', () => {
  it('parses a valid backup', () => {
    const raw = JSON.stringify({ access_token: 'a', refresh_token: 'r', tenantName: 'Shop' })
    expect(parseAdminBackup(raw)).toEqual({ access_token: 'a', refresh_token: 'r', tenantName: 'Shop' })
  })
  it('returns null for null/empty', () => {
    expect(parseAdminBackup(null)).toBeNull()
    expect(parseAdminBackup('')).toBeNull()
  })
  it('returns null for malformed JSON', () => {
    expect(parseAdminBackup('{not json')).toBeNull()
  })
  it('returns null when a required field is missing or wrong type', () => {
    expect(parseAdminBackup(JSON.stringify({ access_token: 'a', refresh_token: 'r' }))).toBeNull()
    expect(parseAdminBackup(JSON.stringify({ access_token: 1, refresh_token: 'r', tenantName: 'S' }))).toBeNull()
  })
})
