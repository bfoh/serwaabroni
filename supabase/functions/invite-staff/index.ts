// invite-staff: an owner invites a Manager or Staff member as a real Supabase
// Auth user scoped to their business. Same trust tier as admin-impersonate:
// service-role key, caller identity re-verified via getUser() (verify_jwt=false
// because this project uses asymmetric JWT signing keys the edge gateway
// cannot validate for user tokens — the function validates the caller itself).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    let body: { userJwt?: string; email?: string; role?: string }
    try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }

    const userJwt = body.userJwt
    if (!userJwt) return json({ error: 'Unauthorized' }, 401)
    const userClient = createClient(SUPABASE_URL, ANON_KEY)
    const { data: userData, error: userErr } = await userClient.auth.getUser(userJwt)
    if (userErr || !userData?.user) {
      return json({ error: 'Unauthorized', detail: userErr?.message ?? null }, 401)
    }
    const callerId = userData.user.id

    const email = body.email?.trim().toLowerCase()
    const role = body.role
    if (!email || !email.includes('@')) return json({ error: 'Valid email required' }, 400)
    if (role !== 'manager' && role !== 'staff') return json({ error: "role must be 'manager' or 'staff'" }, 400)
    if (email === userData.user.email?.toLowerCase()) return json({ error: 'cannot invite yourself' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Authorize: caller must own a business. Staff/Manager cannot invite others.
    const { data: owner, error: ownerErr } = await admin
      .from('business_profiles').select('user_id').eq('user_id', callerId).maybeSingle()
    if (ownerErr) return json({ error: 'server error', detail: ownerErr.message }, 500)
    if (!owner) return json({ error: 'forbidden' }, 403)

    // Re-inviting an already-ACTIVE member must never happen through this
    // path: the upsert below resets status/member_user_id/joined_at, which
    // would sever a real, active membership (business_id_for()/role_for()
    // stop resolving for that user until their next login re-triggers
    // activate_membership()) on a simple double-click or accidental re-send.
    // Changing an active member's role is a separate, non-destructive update
    // (Settings' updateStaffRole, Task 12) — this endpoint is for inviting
    // someone new or re-inviting a not-yet-accepted/removed one.
    const { data: existing, error: existingErr } = await admin
      .from('business_members')
      .select('status')
      .eq('business_id', callerId)
      .eq('invited_email', email)
      .maybeSingle()
    if (existingErr) return json({ error: 'server error', detail: existingErr.message }, 500)
    if (existing?.status === 'active') {
      return json({ error: 'This person is already an active team member' }, 409)
    }

    // Upsert the membership row: re-inviting a removed/previously-invited
    // email re-activates it instead of hitting the unique constraint.
    const { error: upsertErr } = await admin
      .from('business_members')
      .upsert(
        { business_id: callerId, invited_email: email, role, status: 'invited', member_user_id: null, joined_at: null },
        { onConflict: 'business_id,invited_email' },
      )
    if (upsertErr) return json({ error: 'could not save invite', detail: upsertErr.message }, 500)

    // Send the Supabase invite email (creates the auth user in an invited state).
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email)
    if (inviteErr && !/already registered/i.test(inviteErr.message ?? '')) {
      return json({ error: 'Could not send invite email', detail: inviteErr.message }, 500)
    }

    return json({ ok: true })
  } catch (e) {
    console.error('invite-staff: CRASH', String((e as Error)?.stack ?? e))
    return json({ error: 'server error', detail: String((e as Error)?.message ?? e) }, 500)
  }
})
