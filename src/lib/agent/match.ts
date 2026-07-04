import type { Product } from '@/lib/supabase'

export interface MatchResult {
  product: Product | null
  candidates: Product[]
  ambiguous: boolean
}

function score(query: string, name: string): number {
  const q = query.trim().toLowerCase()
  const n = name.trim().toLowerCase()
  if (!q) return 0
  if (n === q) return 100
  if (n.startsWith(q)) return 80
  if (n.includes(q)) return 60
  // token overlap: any query word contained in the name
  const qWords = q.split(/\s+/)
  if (qWords.some((w) => w.length >= 3 && n.includes(w))) return 40
  return 0
}

export function matchProduct(query: string, products: Product[]): MatchResult {
  const scored = products
    .map((p) => ({ p, s: score(query, p.name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)

  if (scored.length === 0) return { product: null, candidates: [], ambiguous: false }

  const top = scored[0].s
  const tied = scored.filter((x) => x.s === top)
  if (tied.length === 1) return { product: tied[0].p, candidates: [tied[0].p], ambiguous: false }
  return { product: null, candidates: tied.map((x) => x.p), ambiguous: true }
}
