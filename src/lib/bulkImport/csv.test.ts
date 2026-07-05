import { describe, it, expect } from 'vitest'
import { parseCSV, toCSVRow } from './csv'

describe('parseCSV', () => {
  it('parses simple rows', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('parses a quoted field containing a comma', () => {
    expect(parseCSV('name,qty\n"Pomo, Gino tomato mix 200g",5')).toEqual([
      ['name', 'qty'],
      ['Pomo, Gino tomato mix 200g', '5'],
    ])
  })
  it('parses escaped quotes and CRLF, strips BOM, skips blank lines', () => {
    expect(parseCSV('﻿a,b\r\n"say ""hi""",2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['say "hi"', '2'],
    ])
  })
})

describe('toCSVRow', () => {
  it('quotes only when needed and escapes quotes', () => {
    expect(toCSVRow(['plain', 'has,comma', 'has"quote', 5, null])).toBe('plain,"has,comma","has""quote",5,')
  })
})
