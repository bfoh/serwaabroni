// Reads a photo of a handwritten sales log with Claude vision and returns rows.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const MODEL = 'claude-sonnet-5'

const PROMPT =
  'You are reading a photo of a shop\'s SALES log. It may be TYPED or HANDWRITTEN, ' +
  'often a table where each line is one sale. Transcribe it carefully, reading the ' +
  'handwriting as best you can. Output one row per sale line. Respond with JSON ONLY — ' +
  'no explanation, no markdown fences: an array of objects with keys ' +
  'product (string), quantity (number), unit (string), unit_price (number), ' +
  'payment (string: cash, momo, bank, or credit), customer (string), date (string, e.g. 2026-07-03). ' +
  'Include a row even if some fields are missing — omit only the keys you cannot read. ' +
  'Amounts are plain numbers with no currency symbols. If the image has no sales list, return [].'

interface Body {
  userJwt?: string
  imageBase64?: string
  mediaType?: string
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  return JSON.parse(body.slice(start, end + 1))
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
    if (!body.imageBase64 || !body.mediaType) return json({ error: 'Missing image' }, 400)

    const userClient = createClient(SUPABASE_URL, ANON_KEY)
    const { data: userData, error: userErr } = await userClient.auth.getUser(body.userJwt)
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: body.mediaType, data: body.imageBase64 } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return json({ error: 'Vision upstream error', detail: detail.slice(0, 300) }, 502)
    }

    const data = await res.json()
    const text = (data.content ?? []).filter((b: Record<string, unknown>) => b.type === 'text').map((b: Record<string, unknown>) => String(b.text)).join('')
    let rows: unknown = []
    try {
      rows = extractJson(text)
    } catch {
      return json({ error: 'Could not read the photo. Please retake it or use the template.' }, 422)
    }
    return json({ rows: Array.isArray(rows) ? rows : [] })
  } catch (e) {
    return json({ error: 'Vision error', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})
