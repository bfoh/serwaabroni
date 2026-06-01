// ============================================
// SUPABASE AUTH — Single source of truth for authentication
// All user data is scoped by the Supabase auth UID (UUID)
// ============================================
import { supabase } from '@/lib/supabase'

export interface UserState {
  id: string
  email: string
  phone?: string
  business_name?: string
  logo?: string
}

// Deprecating old interface — keeping for backward compat
export interface AuthSession extends UserState {
  created_at: string
}

export async function signUp(email: string, password: string, phone: string, businessName: string): Promise<{ user: UserState | null; error: string | null }> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { phone, business_name: businessName }
      }
    })
    if (error) {
      console.error('Supabase signUp error:', error)
      throw error
    }
    if (!data.user) throw new Error('No user returned')

    return {
      user: {
        id: data.user.id,
        email: data.user.email!,
        phone: data.user.user_metadata?.phone,
        business_name: data.user.user_metadata?.business_name,
        logo: data.user.user_metadata?.logo,
      },
      error: null,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sign up failed'
    console.error('Auth signUp catch:', message)
    return { user: null, error: message }
  }
}

export async function signIn(email: string, password: string): Promise<{ user: UserState | null; error: string | null }> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      console.error('Supabase signIn error:', error)
      throw error
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email!,
        phone: data.user.user_metadata?.phone,
        business_name: data.user.user_metadata?.business_name,
        logo: data.user.user_metadata?.logo,
      },
      error: null,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Login failed'
    console.error('Auth signIn catch:', message)
    return { user: null, error: message }
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

export async function checkAuth(): Promise<UserState | null> {
  try {
    const { data } = await supabase.auth.getUser()
    if (!data.user) return null

    return {
      id: data.user.id,
      email: data.user.email!,
      phone: data.user.user_metadata?.phone,
      business_name: data.user.user_metadata?.business_name,
      logo: data.user.user_metadata?.logo,
    }
  } catch {
    return null
  }
}

export async function updateProfile(updates: { business_name?: string; phone?: string; logo?: string }) {
  const { error } = await supabase.auth.updateUser({ data: updates })
  if (error) throw error
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password',
  })
  if (error) throw error
}
