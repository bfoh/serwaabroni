import { describe, it, expect, vi } from 'vitest'
import { normalizeTranscribe, normalizeSpeak, transcribeTwi, isTwiNotConfigured, TwiNotConfiguredError } from './khaya'

describe('normalize', () => {
  it('normalizeTranscribe pulls twi + english with fallbacks', () => {
    expect(normalizeTranscribe({ twi: 'Me pɛ', english: 'I want' })).toEqual({ twi: 'Me pɛ', english: 'I want' })
    expect(normalizeTranscribe(null)).toEqual({ twi: '', english: '' })
  })
  it('normalizeSpeak pulls audio fields', () => {
    expect(normalizeSpeak({ twi: 'Aane', audioBase64: 'AAA', mimeType: 'audio/wav' })).toEqual({ twi: 'Aane', audioBase64: 'AAA', mimeType: 'audio/wav' })
    expect(normalizeSpeak({}).mimeType).toBe('audio/wav')
  })
})

describe('transcribeTwi', () => {
  const deps = (res: { ok: boolean; status?: number; body: unknown }) => ({
    getToken: async () => 'jwt',
    doFetch: vi.fn().mockResolvedValue({ ok: res.ok, status: res.status ?? (res.ok ? 200 : 500), json: async () => res.body }) as unknown as typeof fetch,
  })
  it('returns normalized transcription on success', async () => {
    const out = await transcribeTwi('AUDIO', 'audio/webm', deps({ ok: true, body: { twi: 'x', english: 'y' } }))
    expect(out).toEqual({ twi: 'x', english: 'y' })
  })
  it('throws TwiNotConfiguredError on 501', async () => {
    await expect(transcribeTwi('A', 'audio/webm', deps({ ok: false, status: 501, body: { error: 'twi_not_configured' } })))
      .rejects.toBeInstanceOf(TwiNotConfiguredError)
  })
})

describe('isTwiNotConfigured', () => {
  it('detects the typed error', () => {
    expect(isTwiNotConfigured(new TwiNotConfiguredError())).toBe(true)
    expect(isTwiNotConfigured(new Error('x'))).toBe(false)
  })
})
