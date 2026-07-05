import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import type { RawRow } from './rows'

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''))
    if (!Number.isNaN(n) && v.trim() !== '') return n
  }
  return undefined
}
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

export function normalizeVisionRows(rows: unknown): RawRow[] {
  if (!Array.isArray(rows)) return []
  const out: RawRow[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const row: RawRow = {}
    const name = str(o.name)
    if (name) row.name = name
    const unit = str(o.unit)
    if (unit) row.unit = unit
    const q = num(o.quantity); if (q !== undefined) row.quantity = q
    const c = num(o.cost_price); if (c !== undefined) row.cost_price = c
    const s = num(o.selling_price); if (s !== undefined) row.selling_price = s
    if (Object.keys(row).length > 0 && row.name) out.push(row)
  }
  return out
}

interface Deps {
  getToken: () => Promise<string | null>
  doFetch: typeof fetch
  toBase64: (file: File) => Promise<{ base64: string; mediaType: string }>
}

async function compressToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file)
  const max = 1600
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' }
}

const defaultDeps: Deps = {
  getToken: async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  },
  doFetch: (...a) => fetch(...a),
  toBase64: compressToBase64,
}

export async function extractRowsFromImage(file: File, deps: Deps = defaultDeps): Promise<RawRow[]> {
  const token = await deps.getToken()
  if (!token) throw new Error('You are not signed in.')
  const { base64, mediaType } = await deps.toBase64(file)
  const res = await deps.doFetch(`${SUPABASE_URL}/functions/v1/serwaa-stock-vision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userJwt: token, imageBase64: base64, mediaType }),
  })
  const data = await res.json().catch(() => ({}) as Record<string, unknown>)
  if (!(res as Response).ok) throw new Error((data as { error?: string }).error || 'Could not read the photo.')
  return normalizeVisionRows((data as { rows?: unknown }).rows)
}
