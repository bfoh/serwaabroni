import { describe, it, expect } from 'vitest'
import { toSpeakable } from './speech'

describe('toSpeakable', () => {
  it('speaks the cedi amount after the number', () => {
    expect(toSpeakable('You made GH₵ 30.00 today.')).toBe('You made 30 Ghana Cedis today.')
  })

  it('handles the symbol with no space and thousands separators', () => {
    expect(toSpeakable('Total GH₵1,250.50 owed')).toBe('Total 1250.50 Ghana Cedis owed')
  })

  it('handles GHC / GHS / bare cedi symbol variants', () => {
    expect(toSpeakable('GHC30')).toBe('30 Ghana Cedis')
    expect(toSpeakable('GHS 5')).toBe('5 Ghana Cedis')
    expect(toSpeakable('₵ 12.00')).toBe('12 Ghana Cedis')
  })

  it('leaves text without amounts unchanged', () => {
    expect(toSpeakable('Tap the microphone to start.')).toBe('Tap the microphone to start.')
  })
})
