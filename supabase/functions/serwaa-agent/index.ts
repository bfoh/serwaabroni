// SerwaaBroni agent: validates the caller, calls Claude Haiku with an allow-listed
// tool schema and a compact business snapshot, and returns the model's spoken reply
// plus any tool calls for the client to preview/execute. No DB writes happen here.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { toolsForRole } from './tools.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const MODEL = 'claude-haiku-4-5-20251001'

interface Body {
  userJwt?: string
  messages?: { role: 'user' | 'assistant'; content: string }[]
  snapshot?: unknown
}

function systemPrompt(snapshot: unknown): string {
  return [
    'You are SerwaaBroni, a warm, concise assistant for a Ghanaian market trader.',
    'You help record stock, record sales (cash or credit), and answer questions about the business.',
    'Amounts are in Ghana Cedis (GHS). Keep replies short and friendly, one or two sentences.',
    'To record a sale, restock, or add a product, CALL THE MATCHING TOOL — do not ask the user to open a form.',
    'The app will show the user a confirmation card before saving, so you do not need to ask "are you sure".',
    'If a product name is unclear or missing a number, ask one short question to clarify.',
    'The user speaks and their words come from speech recognition, which often mishears numbers (e.g. "ten" heard as "pen" or "1010") and product names. When a message includes "Other guesses", pick the most sensible reading. If a quantity looks implausible or unclear (very large, or a number word that got garbled), ask one short question to confirm the number before recording.',
    'After a cash sale is recorded, the app asks whether the buyer wants a receipt. If the user gives a customer name and phone number, call send_receipt with them. If the user declines, acknowledge briefly.',
    'For questions about sales, stock, debts, or alerts, call the matching get_* tool.',
    'Some products are sold both in a bigger unit (a pack, e.g. a box or bag) and a smaller unit (e.g. a sachet, bottle, or piece). When the buyer names the bigger unit — "two boxes of Indomie", "a bag of rice" — pass that unit as the item\'s "unit" so the sale records the pack, not single small units. If they just say a number with no unit, treat it as the small unit.',
    'Never invent products or numbers. Only use products from the snapshot below.',
    `Business snapshot (JSON): ${JSON.stringify(snapshot ?? {})}`,
  ].join(' ')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    let body: Body
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }
    if (!body.userJwt) return json({ error: 'Unauthorized' }, 401)
    if (!Array.isArray(body.messages) || body.messages.length === 0) return json({ error: 'No messages' }, 400)

    const userClient = createClient(SUPABASE_URL, ANON_KEY)
    const { data: userData, error: userErr } = await userClient.auth.getUser(body.userJwt)
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)
    const callerId = userData.user.id

    // Resolve the caller's role via role_for() (migration_023_business_members.sql,
    // Task 1's canonical owner/manager/staff resolver — SECURITY DEFINER, so it
    // can see the caller's business_members row even under owner-only RLS) so
    // the tool schema can be filtered per
    // docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5. Service role
    // (not the user's own JWT) because this function has no session for the
    // caller beyond the raw userJwt string, matching invite-staff/admin-impersonate's
    // established pattern for this project's edge functions.
    // Fails closed: any RPC error, or a value that isn't exactly 'owner' |
    // 'manager' | 'staff', resolves to null, which toolsForRole() below treats
    // as the MOST restricted role — never the full tool list.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: roleData, error: roleErr } = await admin.rpc('role_for', { uid: callerId })
    const role: string | null =
      !roleErr && (roleData === 'owner' || roleData === 'manager' || roleData === 'staff') ? roleData : null

    // Keep context small: last 4 turns only.
    const recent = body.messages.slice(-4)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: systemPrompt(body.snapshot),
        tools: toolsForRole(role),
        messages: recent.map((m) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return json({ error: 'Agent upstream error', detail: detail.slice(0, 300) }, 502)
    }

    const data = await res.json()
    const blocks: Array<Record<string, unknown>> = data.content ?? []
    const say = blocks.filter((b) => b.type === 'text').map((b) => String(b.text)).join(' ').trim()
    const toolCalls = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ name: String(b.name), input: (b.input as Record<string, unknown>) ?? {} }))

    return json({ say, toolCalls })
  } catch (e) {
    return json({ error: 'Agent error', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})
