import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'

export interface StaffMember {
  id: string
  business_id: string
  member_user_id: string | null
  invited_email: string
  role: 'manager' | 'staff'
  status: 'invited' | 'active' | 'removed'
  invited_at: string
  joined_at: string | null
}

// Pure: normalizes an owner-typed invite email the same way the edge
// function does server-side, so the list/UI and the DB agree.
export function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export async function fetchStaff(): Promise<StaffMember[]> {
  const { data: userData } = await supabase.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('business_members')
    .select('*')
    .eq('business_id', uid)
    .neq('status', 'removed')
    .order('invited_at', { ascending: false })
  if (error) throw error
  return (data as StaffMember[]) || []
}

export async function inviteStaff(email: string, role: 'manager' | 'staff'): Promise<void> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('Not authenticated')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-staff`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userJwt: token, email: normalizeInviteEmail(email), role }),
  })
  const data = await res.json().catch(() => ({}) as { error?: string })
  if (!res.ok) throw new Error(data.error || 'Could not send invite')
}

export async function updateStaffRole(id: string, role: 'manager' | 'staff'): Promise<void> {
  const { error } = await supabase.from('business_members').update({ role }).eq('id', id)
  if (error) throw error
}

export async function revokeStaff(id: string): Promise<void> {
  const { error } = await supabase.from('business_members').update({ status: 'removed' }).eq('id', id)
  if (error) throw error
}
