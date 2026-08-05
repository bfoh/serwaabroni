import { supabase } from '@/lib/supabase'
import type { Role } from '@/lib/permissions'

// Pure: turns a raw role_for() RPC result into a safe Role, defaulting to
// null on any error or unexpected value so an unresolvable role never
// silently grants access.
export function parseRole(data: unknown, error: unknown): Role | null {
  if (error) return null
  return data === 'owner' || data === 'manager' || data === 'staff' ? data : null
}

// Self-service invite acceptance — flips a matching invited business_members
// row to active on this user's first login. Safe to call on every login
// (no-op if there's no matching invited row).
export async function activateMembership(): Promise<void> {
  try { await supabase.rpc('activate_membership') } catch { /* best effort, e.g. offline */ }
}

export async function fetchRole(uid: string): Promise<Role | null> {
  try {
    const { data, error } = await supabase.rpc('role_for', { uid })
    return parseRole(data, !!error)
  } catch {
    return null
  }
}

export async function fetchBusinessId(uid: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('business_id_for', { uid })
    if (error || !data) return null
    return data as string
  } catch {
    return null
  }
}
