// A small RFC-4180-subset CSV parser/serializer. No dependency.
export function parseCSV(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    // Skip fully-blank lines (one empty field).
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }
  while (i < clean.length) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      pushField()
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      pushField()
      pushRow()
      i++
      continue
    }
    field += ch
    i++
  }
  // Flush the last field/row (file may not end with a newline).
  pushField()
  pushRow()
  return rows
}

export function toCSVRow(cells: (string | number | null)[]): string {
  return cells
    .map((val) => {
      if (val === null || val === undefined) return ''
      const s = String(val)
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    })
    .join(',')
}
