import type { Product } from '@/lib/supabase'

export interface ProductGroup {
  key: string
  name: string
  products: Product[]
}

export function groupByName(products: Product[]): ProductGroup[] {
  const groups: ProductGroup[] = []
  const byKey = new Map<string, ProductGroup>()
  for (const product of products) {
    const key = product.name.trim().toLowerCase()
    let group = byKey.get(key)
    if (!group) {
      group = { key, name: product.name, products: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.products.push(product)
  }
  return groups
}

export function groupTotalLabel(products: Product[]): string {
  const unit = products[0]?.unit
  const sameUnit = products.every((p) => p.unit === unit)
  if (sameUnit && unit) {
    const total = products.reduce((sum, p) => sum + (p.quantity || 0), 0)
    return `${total} ${unit}`
  }
  return `${products.length} stock entries`
}
