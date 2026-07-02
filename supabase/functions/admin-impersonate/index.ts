// admin-impersonate: a super-admin mints a real tenant session to act as them.
// Verifies the caller is a super-admin (service-role check), generates a magic
// link for the tenant (no email sent), logs a 'start' audit row, and returns the
// hashed_token the client exchanges via supabase.auth.verifyOtp.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    // Identify the caller from their JWT.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)
    const callerId = userData.user.id

    let body: { tenantId?: string }
    try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
    const tenantId = body.tenantId
    if (!tenantId) return json({ error: 'tenantId required' }, 400)
    if (tenantId === callerId) return json({ error: 'cannot impersonate yourself' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Authorize: caller must be a super-admin.
    const { data: sa } = await admin
      .from('super_admins').select('user_id').eq('user_id', callerId).maybeSingle()
    if (!sa) return json({ error: 'forbidden' }, 403)

    // Resolve tenant email.
    const { data: tenant, error: tErr } = await admin.auth.admin.getUserById(tenantId)
    if (tErr || !tenant?.user?.email) {
      return json({ error: 'tenant has no email', detail: tErr?.message ?? null }, 400)
    }

    // Mint a magic-link session (generateLink does NOT send an email).
    const { data: link, error: lErr } = await admin.auth.admin.generateLink({
      type: 'magiclink', email: tenant.user.email,
    })
    if (lErr || !link?.properties?.hashed_token) {
      return json({ error: 'could not mint session', detail: lErr?.message ?? null }, 500)
    }

    // Audit start (service role bypasses RLS).
    await admin.from('impersonation_events')
      .insert({ admin_id: callerId, tenant_id: tenantId, action: 'start' })

    return json({ token_hash: link.properties.hashed_token })
  } catch (e) {
    // Any unhandled error still returns CORS headers so the browser can read it.
    return json({ error: 'server error', detail: String((e as Error)?.message ?? e) }, 500)
  }
})
