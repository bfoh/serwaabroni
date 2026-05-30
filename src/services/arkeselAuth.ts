// ============================================
// SIMPLE AUTH — No Supabase Auth, no rate limits
// Uses localStorage session + Supabase for data only
// ============================================

const SESSION_KEY = 'serwaabroni_session'

export interface UserSession {
  id: string
  phone: string
  email?: string
  displayPhone: string
  businessName: string
  ownerName: string
  createdAt: number
}

function formatPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '').replace(/^\+/, '')
  if (cleaned.startsWith('0')) cleaned = '233' + cleaned.substring(1)
  return cleaned
}

function getDisplayPhone(phone: string): string {
  const f = formatPhone(phone)
  return f.startsWith('233') ? '0' + f.substring(3) : phone
}

export function isArkeselConfigured(): boolean {
  const key = import.meta.env.VITE_ARKESEL_API_KEY || ''
  return !!key && key !== 'your-arkesel-api-key'
}

// ============================================
// OTP STORAGE
// ============================================

const OTP_KEY = 'sb_otp'

function storeOtp(phone: string, code: string) {
  localStorage.setItem(OTP_KEY, JSON.stringify({ phone, code, expires: Date.now() + 5 * 60 * 1000 }))
}

function getOtp(phone: string): string | null {
  try {
    const raw = localStorage.getItem(OTP_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data.phone !== phone || data.expires < Date.now()) {
      localStorage.removeItem(OTP_KEY)
      return null
    }
    return data.code
  } catch { return null }
}

function clearOtp() {
  localStorage.removeItem(OTP_KEY)
}

// ============================================
// SESSION MANAGEMENT
// ============================================

export function getSession(): UserSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as UserSession
  } catch { return null }
}

function saveSession(session: UserSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(OTP_KEY)
}

// Trigger Supabase auth state change so the app knows we're logged in
function notifyAuthChange(user: UserSession | null) {
  // Dispatch a custom event that the store can listen to
  window.dispatchEvent(new CustomEvent('sb:auth', { detail: { user } }))
}

// ============================================
// SEND OTP
// ============================================

export async function sendArkeselOTP(phone: string): Promise<{ testCode: string }> {
  const formattedPhone = formatPhone(phone)
  const testCode = Math.floor(100000 + Math.random() * 900000).toString()
  storeOtp(formattedPhone, testCode)
  return { testCode }
}

// ============================================
// VERIFY OTP + CREATE SESSION
// ============================================

export async function verifyArkeselOTP(
  phone: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  const formattedPhone = formatPhone(phone)

  const stored = getOtp(formattedPhone)
  if (!stored) return { success: false, error: 'Code expired. Request a new one.' }
  if (stored !== code) return { success: false, error: 'Wrong code. Try again.' }

  clearOtp()

  // Create session directly in localStorage — no Supabase Auth needed
  const session: UserSession = {
    id: `user_${formattedPhone}_${Date.now()}`,
    phone: formattedPhone,
    displayPhone: getDisplayPhone(phone),
    businessName: 'My Shop',
    ownerName: '',
    createdAt: Date.now(),
  }

  saveSession(session)
  notifyAuthChange(session)

  return { success: true }
}

// ============================================
// DEMO LOGIN
// ============================================

export async function demoLogin(): Promise<{ success: boolean; error?: string }> {
  const session: UserSession = {
    id: 'demo_user',
    phone: '233244123456',
    displayPhone: '0244123456',
    businessName: "Maame Doku's Shop",
    ownerName: 'Maame Doku',
    createdAt: Date.now(),
  }

  saveSession(session)
  notifyAuthChange(session)

  return { success: true }
}

// ============================================
// SIGN OUT
// ============================================

export async function signOut(): Promise<void> {
  clearSession()
  notifyAuthChange(null)
}

// ============================================
// GET CURRENT USER (for store compatibility)
// ============================================

export async function getCurrentUser() {
  const session = getSession()
  if (!session) return { user: null, error: null }

  // Return a mock Supabase user object for compatibility
  return {
    user: {
      id: session.id,
      email: `${session.phone}@local.app`,
      phone: session.phone,
      user_metadata: {
        phone: session.phone,
        display_phone: session.displayPhone,
        business_name: session.businessName,
      },
      created_at: new Date(session.createdAt).toISOString(),
    } as unknown as import('@supabase/supabase-js').User,
    error: null,
  }
}
