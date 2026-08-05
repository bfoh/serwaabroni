// Pure business rules for category CRUD — no I/O, fully unit-tested without
// a Supabase mock. See docs/superpowers/specs/2026-08-03-multi-industry-categories-design.md

export interface DeleteCheck {
  allowed: boolean
  count: number
}

// A category can only be deleted once no product references it by name.
export function canDeleteCategory(categoryName: string, products: { category: string }[]): DeleteCheck {
  const count = products.filter((p) => p.category === categoryName).length
  return { allowed: count === 0, count }
}

// Renaming a category cascades to every product using the old name, so
// history/reports keep showing a consistent category label.
export function applyCategoryRename<T extends { category: string }>(
  products: T[],
  oldName: string,
  newName: string,
): T[] {
  if (oldName === newName) return products
  let changed = false
  const next = products.map((p) => {
    if (p.category !== oldName) return p
    changed = true
    return { ...p, category: newName }
  })
  return changed ? next : products
}
