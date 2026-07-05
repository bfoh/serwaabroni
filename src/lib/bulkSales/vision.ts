import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import type { SaleRawRow } from './rows'

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

export function normalizeSalesVisionRows(rows: unknown): SaleRawRow[] {
  if (!Array.isArray(rows)) return []
  const out: SaleRawRow[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const row: SaleRawRow = {}
    const product = str(o.product)
    if (product) row.product = product
    const unit = str(o.unit); if (unit) row.unit = unit
    const payment = str(o.payment); if (payment) row.payment = payment
    const customer = str(o.customer); if (customer) row.customer = customer
    const date = str(o.date); if (date) row.date = date
    const q = num(o.quantity); if (q !== undefined) row.quantity = q
    const up = num(o.unit_price); if (up !== undefined) row.unit_price = up
    if (row.product) out.push(row)
  }
  return out
}

interface Deps {
  getToken: () => Promise<string | null>
  doFetch: typeof fetch
  toBase64: (file: File) => Promise<{ base64: string; mediaType: string }>
}

async function compressToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That image format could not be read. Try a JPG/PNG photo.')
  }
  const max = 1568
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
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

export async function extractSalesFromImage(file: File, deps: Deps = defaultDeps): Promise<SaleRawRow[]> {
  const token = await deps.getToken()
  if (!token) throw new Error('You are not signed in.')
  const { base64, mediaType } = await deps.toBase64(file)
  const res = await deps.doFetch(`${SUPABASE_URL}/functions/v1/serwaa-sales-vision`, {
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
  return normalizeSalesVisionRows((data as { rows?: unknown }).rows)
}
