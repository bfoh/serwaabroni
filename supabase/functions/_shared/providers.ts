// Provider clients. All keys come from Supabase function secrets — never the client.
//   supabase secrets set BREVO_API_KEY=... ARKESEL_API_KEY=...
//
// Each sender returns { ok, error? }. They never throw; the caller logs the result.

export type Channel = 'sms' | 'email' | 'whatsapp'
export interface SendResult {
  ok: boolean
  error?: string
}

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? ''
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') ?? 'noreply@serwaabroni.com'
const BREVO_SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') ?? 'SerwaaBroni'

const ARKESEL_API_KEY = Deno.env.get('ARKESEL_API_KEY') ?? ''
const ARKESEL_SENDER_ID = Deno.env.get('ARKESEL_SENDER_ID') ?? 'SerwaaB'
// WhatsApp stays dormant until an approved Arkesel WhatsApp sender is configured.
const ARKESEL_WHATSAPP_SENDER = Deno.env.get('ARKESEL_WHATSAPP_SENDER') ?? ''

// Convert local Ghana numbers (0244...) to international format (233244...).
export function formatGhanaPhone(phone: string): string {
  return phone.replace(/\s+/g, '').replace(/^\+/, '').replace(/^0/, '233')
}

// Pick the SMS sender ID: the shop's own registered ID (if set) → the default
// registered brand sender. Ghana telcos only DELIVER sender IDs registered with
// Arkesel/NCA (the API accepts anything but silently drops unregistered names), so we
// never derive the sender from an arbitrary business name — the shop name lives in the
// message body instead. A custom sms_sender_id only works once that shop has registered
// it with Arkesel. Alphanumeric, max 11 chars, no spaces.
export function resolveSender(custom?: string | null): string {
  const clean = (custom?.trim() || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 11)
  return clean || ARKESEL_SENDER_ID
}

export async function sendEmail(
  to: string,
  toName: string,
  subject: string,
  htmlContent: string,
  fromName?: string,
): Promise<SendResult> {
  if (!BREVO_API_KEY) return { ok: false, error: 'BREVO_API_KEY not configured' }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        // From-name is free per message (only the address needs domain verification),
        // so each shop's email shows its own name — the per-tenant branding SMS can't do.
        sender: { name: fromName || BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: [{ email: to, name: toName || to }],
        subject,
        htmlContent,
      }),
    })
    if (!res.ok) return { ok: false, error: `Brevo ${res.status}: ${await res.text()}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function sendSMS(to: string, message: string, sender?: string): Promise<SendResult> {
  if (!ARKESEL_API_KEY) return { ok: false, error: 'ARKESEL_API_KEY not configured' }
  try {
    const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: sender || ARKESEL_SENDER_ID,
        message,
        recipients: [formatGhanaPhone(to)],
      }),
    })
    if (!res.ok) return { ok: false, error: `Arkesel ${res.status}: ${await res.text()}` }
    const body = await res.json().catch(() => ({}))
    // Arkesel returns { status: 'success', ... } on accept.
    if (body?.status && body.status !== 'success') {
      return { ok: false, error: `Arkesel: ${JSON.stringify(body)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function sendWhatsApp(to: string, message: string): Promise<SendResult> {
  if (!ARKESEL_API_KEY || !ARKESEL_WHATSAPP_SENDER) {
    return { ok: false, error: 'WhatsApp sender not configured' }
  }
  try {
    const res = await fetch('https://sms.arkesel.com/api/v2/whatsapp/send', {
      method: 'POST',
      headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: ARKESEL_WHATSAPP_SENDER,
        recipient: formatGhanaPhone(to),
        type: 'text',
        message,
      }),
    })
    if (!res.ok) return { ok: false, error: `Arkesel WA ${res.status}: ${await res.text()}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
