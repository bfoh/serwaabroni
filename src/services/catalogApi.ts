// ============================================
// CATALOG API — shared, platform-wide product identity.
// Read is a plain authenticated SELECT; write is a fire-and-forget RPC.
// Identity only — never price/stock/tenant.
// ============================================
import { supabase } from '@/lib/supabase'
import { normalizeBarcode } from '@/lib/scanner'

export interface CatalogEntry {
  name: string
  brand: string | null
  category: string | null
  unit: string | null
}

export async function lookupCatalog(code: string | null | undefined): Promise<CatalogEntry | null> {
  const norm = normalizeBarcode(code)
  if (!norm) return null
  const { data, error } = await supabase
    .from('product_catalog')
    .select('name, brand, category, unit')
    .eq('code', norm)
    .maybeSingle()
  if (error || !data) return null
  return data as CatalogEntry
}

// Fire-and-forget: a failure here must never disrupt saving a product.
export async function contributeCatalog(
  code: string | null | undefined,
  name: string,
  brand: string | null,
  category: string | null,
  unit: string | null,
): Promise<void> {
  const norm = normalizeBarcode(code)
  if (!norm || !name) return
  try {
    await supabase.rpc('contribute_catalog_entry', {
      p_code: norm, p_name: name, p_brand: brand, p_category: category, p_unit: unit,
    })
  } catch { /* ignore — best-effort contribution */ }
}
