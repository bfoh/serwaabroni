import { supabase } from '@/lib/supabase'
import type { BusinessCategory } from '@/lib/supabase'
import { templateForIndustry, mergeSeedNames, UNCATEGORIZED } from '@/lib/categories'
import { resolveScopeId } from '@/services/scopeId'

// This file had its own local, un-migrated uidOrThrow() — Task 2 (RBAC)
// converted supabaseApi.ts and batchApi.ts to resolve business_id_for() so
// an active Manager/Staff account scopes to their employer's tenant, but
// this file was missed entirely. Every call here used the caller's own raw
// auth uid, so for a Manager/Staff account: reads returned zero rows
// (state.categories always []), every picker silently fell back to the
// generic Supermarket template regardless of the tenant's real industry, and
// writes (insertCategory, deleteCategoryDb, seedCategoriesForIndustry)
// created orphan business_categories rows under the staff/manager's own auth
// uid — invisible to the owner and to every other session. Found in the RBAC
// feature's final whole-branch review.
async function uidOrThrow(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) throw new Error('Not authenticated')
  const { data: businessId, error } = await supabase.rpc('business_id_for', { uid })
  return resolveScopeId(uid, (businessId as string) ?? null, !!error) as string
}

export async function fetchCategories(): Promise<BusinessCategory[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data: businessId, error: scopeError } = await supabase.rpc('business_id_for', { uid: user.id })
  const scopedUid = resolveScopeId(user.id, (businessId as string) ?? null, !!scopeError)
  if (!scopedUid) return []

  const { data, error } = await supabase
    .from('business_categories')
    .select('*')
    .eq('user_id', scopedUid)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data as BusinessCategory[]) || []
}

export async function insertCategory(input: { name: string; icon: string; sortOrder: number }): Promise<BusinessCategory> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('business_categories')
    .insert({ user_id: uid, name: input.name, icon: input.icon, sort_order: input.sortOrder, is_builtin: false })
    .select()
    .single()

  if (error) throw error
  return data as BusinessCategory
}

// Renames the category AND cascades the new name onto every product using
// the old one, atomically (see rename_category in migration_022).
export async function renameCategoryDb(id: string, newName: string): Promise<BusinessCategory> {
  const { data, error } = await supabase.rpc('rename_category', { p_id: id, p_new_name: newName })
  if (error) throw error
  return data as BusinessCategory
}

export async function deleteCategoryDb(id: string): Promise<void> {
  const uid = await uidOrThrow()
  const { error } = await supabase.from('business_categories').delete().eq('id', id).eq('user_id', uid)
  if (error) throw error
}

// Bulk-moves every product from one category name to another. Used by the
// Settings delete-with-reassign flow (Task 6) before the now-unused category
// is removed.
export async function updateProductsCategoryBulk(fromName: string, toName: string): Promise<void> {
  const uid = await uidOrThrow()
  const { error } = await supabase.from('products').update({ category: toName }).eq('category', fromName).eq('user_id', uid)
  if (error) throw error
}

// "Load starter categories": idempotently inserts any template entries (plus
// the builtin Uncategorized row) the tenant doesn't already have, by name,
// case-insensitively.
export async function seedCategoriesForIndustry(industry: string): Promise<BusinessCategory[]> {
  const uid = await uidOrThrow()
  const existing = await fetchCategories()
  const template = [...templateForIndustry(industry), UNCATEGORIZED]
  const toInsert = mergeSeedNames(existing.map((c) => c.name), template)
  if (toInsert.length === 0) return existing

  const rows = toInsert.map((t, i) => ({
    user_id: uid,
    name: t.name,
    icon: t.icon,
    sort_order: existing.length + i,
    is_builtin: t.name === UNCATEGORIZED.name,
  }))
  const { data, error } = await supabase.from('business_categories').insert(rows).select()
  if (error) throw error
  return [...existing, ...((data as BusinessCategory[]) || [])]
}
