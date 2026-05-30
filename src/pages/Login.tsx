import { useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, Lock, ArrowRight, Loader2, Store, User, Phone, Eye, EyeOff } from 'lucide-react'
import { useStore } from '@/lib/store'
import { signUp, signIn } from '@/services/auth'

type AuthMode = 'login' | 'signup'

export default function Login() {
  const { showToast } = useStore()
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email || !password) { showToast('Enter email and password', 'error'); return }
    setLoading(true)
    const { user, error } = await signIn(email, password)
    if (error) {
      showToast(error, 'error')
    } else if (user) {
      showToast('Welcome back!', 'success')
      window.location.reload()
    }
    setLoading(false)
  }

  const handleSignUp = async () => {
    if (!email || !password || !businessName) {
      showToast('Email, password and business name required', 'error')
      return
    }
    if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return }
    setLoading(true)
    const { user, error } = await signUp(email, password, phone, businessName)
    if (error) {
      showToast(error, 'error')
    } else if (user) {
      showToast('Account created! Welcome to SerwaaBroni!', 'success')
      window.location.reload()
    }
    setLoading(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'login') handleLogin()
    else handleSignUp()
  }

  return (
    <div className="min-h-screen bg-sand flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="w-20 h-20 rounded-full bg-ink flex items-center justify-center mx-auto mb-4">
            <Store size={36} className="text-accent-red" />
          </div>
          <h1 className="font-display text-3xl text-ink uppercase tracking-tight">SerwaaBroni</h1>
          <p className="text-muted-text text-sm mt-2">Your Business Partner</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="w-full max-w-sm bg-light harsh-border rounded-sm p-6"
        >
          <h2 className="font-display text-xl text-ink uppercase tracking-tight text-center mb-1">
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </h2>
          <p className="text-xs text-muted-text text-center mb-6">
            {mode === 'login' ? 'Welcome back to your shop' : 'Start managing your business'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-text" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full h-12 pl-11 pr-4 bg-sand harsh-border rounded-sm text-base font-body"
                required
              />
            </div>

            <div className="relative">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-text" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Min 6 characters' : 'Your password'}
                className="w-full h-12 pl-11 pr-11 bg-sand harsh-border rounded-sm text-base font-body"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-text"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {mode === 'signup' && (
              <>
                <div className="relative">
                  <Store size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-text" />
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Business Name"
                    className="w-full h-12 pl-11 pr-4 bg-sand harsh-border rounded-sm text-base font-body"
                    required
                  />
                </div>
                <div className="relative">
                  <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-text" />
                  <input
                    type="text"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Your Name (optional)"
                    className="w-full h-12 pl-11 pr-4 bg-sand harsh-border rounded-sm text-base font-body"
                  />
                </div>
                <div className="relative">
                  <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-text" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone (optional)"
                    className="w-full h-12 pl-11 pr-4 bg-sand harsh-border rounded-sm text-base font-body"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-tactile w-full h-14 bg-ink text-white font-display text-lg uppercase tracking-wider rounded-sm flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {loading ? <Loader2 size={22} className="animate-spin" /> : <>
                {mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'} <ArrowRight size={18} />
              </>}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setEmail(''); setPassword('') }}
              className="text-sm text-accent-red hover:underline"
            >
              {mode === 'login' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
            </button>
          </div>

          {/* New user hint */}
          <div className="mt-4 pt-4 border-t border-ink/10 text-center">
            <p className="text-xs text-muted-text">
              New here? Create an account — it takes 30 seconds
            </p>
          </div>
        </motion.div>
      </div>

      <div className="text-center py-4">
        <p className="text-xs text-muted-text">Made for Ghanaian Market Women</p>
      </div>
    </div>
  )
}
