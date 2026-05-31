import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, LogOut, Download, Trash2, User, Store, Globe, Bell, HelpCircle, Shield } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useNavigate } from 'react-router'
import { exportToCSV } from '@/lib/export'
import type { BusinessProfile } from '@/lib/supabase'

interface SettingsProps {
  onClose: () => void
}

export default function Settings({ onClose }: SettingsProps) {
  const { state, dispatch, showToast, logout, updateBusinessProfile } = useStore()
  const navigate = useNavigate()
  const [showProfile, setShowProfile] = useState(false)
  const [showConfirmReset, setShowConfirmReset] = useState(false)
  const [showConfirmLogout, setShowConfirmLogout] = useState(false)
  const [businessName, setBusinessName] = useState(state.businessProfile?.business_name || '')
  const [ownerName, setOwnerName] = useState(state.businessProfile?.owner_name || '')
  const [phone, setPhone] = useState(state.businessProfile?.phone || '')
  const [saving, setSaving] = useState(false)

  const handleSaveProfile = async () => {
    setSaving(true)
    const profile: BusinessProfile = {
      id: state.user?.id || 'local',
      user_id: state.user?.id || 'local',
      business_name: businessName,
      owner_name: ownerName || null,
      phone: phone || null,
      email: state.user?.email || null,
      currency: 'GHS',
      language: state.language,
      created_at: state.businessProfile?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    await updateBusinessProfile(profile)
    showToast('Profile saved!', 'success')
    setShowProfile(false)
    setSaving(false)
  }

  const handleExport = () => {
    exportToCSV(state)
    showToast('Data exported!', 'success')
  }

  const handleReset = () => {
    dispatch({ type: 'SET_PRODUCTS', products: [] })
    dispatch({ type: 'SET_SALES', sales: [] })
    dispatch({ type: 'SET_DEBTS', debts: [] })
    dispatch({ type: 'SET_EXPENSES', expenses: [] })
    showToast('All data cleared!', 'success')
    setShowConfirmReset(false)
  }

  const handleLogout = async () => {
    await logout()
    showToast('Logged out', 'success')
    navigate('/login')
  }

  const menuItems = [
    { icon: User, label: 'Edit Profile', action: () => setShowProfile(true) },
    { icon: Download, label: 'Export All Data (CSV)', action: handleExport },
    { icon: Bell, label: 'Notifications', badge: 'On', action: () => showToast('Notifications enabled', 'success') },
    { icon: Globe, label: 'Language', badge: state.language === 'tw' ? 'Twi' : 'English', action: () => dispatch({ type: 'SET_LANGUAGE', lang: state.language === 'tw' ? 'en' : 'tw' }) },
    { icon: Shield, label: 'Privacy & Security', action: () => showToast('All data stored securely on Supabase', 'success') },
    { icon: HelpCircle, label: 'Help & Support', action: () => showToast('Contact: support@serwaabroni.com', 'success') },
    { icon: Trash2, label: 'Reset All Data', danger: true, action: () => setShowConfirmReset(true) },
    { icon: LogOut, label: 'Log Out', danger: true, action: () => setShowConfirmLogout(true) },
  ]

  return (
    <div className="h-full bg-sand overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-sand border-b-2 border-ink px-5 py-3 flex items-center justify-between">
        <h1 className="font-display text-xl text-ink uppercase tracking-tight">Settings</h1>
        <button onClick={onClose} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
          <X size={20} strokeWidth={2.5} className="text-ink" />
        </button>
      </div>

      {/* Profile Card */}
      <div className="px-5 pt-5 pb-4">
        <div className="bg-ink rounded-sm p-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-accent-red flex items-center justify-center flex-shrink-0">
            <Store size={28} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display text-lg text-white uppercase tracking-tight truncate">
              {state.businessProfile?.business_name || "My Shop"}
            </p>
            <p className="text-xs text-white/50 mt-0.5">{state.user?.email || 'Logged in'}</p>
          </div>
        </div>
      </div>

      {/* Menu */}
      <div className="px-5 pb-6 space-y-1">
        {menuItems.map((item, i) => (
          <motion.button
            key={item.label}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={item.action}
            className={`w-full flex items-center gap-4 px-4 py-3.5 bg-light harsh-border rounded-sm text-left ${
              item.danger ? 'hover:bg-accent-red/5' : 'hover:bg-warm-gray/30'
            } transition-colors`}
          >
            <item.icon size={18} strokeWidth={2} className={item.danger ? 'text-accent-red' : 'text-ink'} />
            <span className={`flex-1 text-sm ${item.danger ? 'text-accent-red' : 'text-ink'}`}>{item.label}</span>
            {item.badge && (
              <span className="text-[10px] bg-warm-gray px-2 py-0.5 rounded-sm text-muted-text font-display">{item.badge}</span>
            )}
            <ChevronRight size={14} className="text-muted-text" />
          </motion.button>
        ))}
      </div>

      {/* Version */}
      <div className="text-center pb-6">
        <p className="text-[10px] text-muted-text">SerwaaBroni v1.0.0</p>
        <p className="text-[9px] text-muted-text mt-0.5">Made for Ghanaian Market Women</p>
      </div>

      {/* Profile Edit Modal */}
      <AnimatePresence>
        {showProfile && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowProfile(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[70] w-[90vw] max-w-sm"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b-2 border-ink">
                <h2 className="font-display text-lg text-ink uppercase">Edit Profile</h2>
                <button onClick={() => setShowProfile(false)} className="w-8 h-8 flex items-center justify-center rounded-sm bg-warm-gray"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-[10px] text-muted-text uppercase block mb-1">Business Name</label>
                  <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-text uppercase block mb-1">Owner Name</label>
                  <input type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-text uppercase block mb-1">Phone</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm" />
                </div>
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="w-full h-11 bg-ink text-white font-display text-sm uppercase tracking-wider rounded-sm disabled:opacity-50"
                >
                  {saving ? '...' : 'Save Profile'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Confirm Reset */}
      <AnimatePresence>
        {showConfirmReset && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowConfirmReset(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[70] w-[85vw] max-w-sm p-5"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-accent-red/10 rounded-full flex items-center justify-center">
                  <Trash2 size={18} className="text-accent-red" />
                </div>
                <div>
                  <h3 className="font-display text-lg text-ink uppercase">Reset All Data?</h3>
                  <p className="text-xs text-muted-text">This cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-ink mb-4">All products, sales, debts and expenses will be permanently deleted.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirmReset(false)} className="flex-1 h-10 bg-warm-gray rounded-sm font-display text-xs uppercase">Cancel</button>
                <button onClick={handleReset} className="flex-1 h-10 bg-accent-red text-white rounded-sm font-display text-xs uppercase flex items-center justify-center gap-1.5">
                  <Trash2 size={12} /> Reset
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Confirm Logout */}
      <AnimatePresence>
        {showConfirmLogout && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowConfirmLogout(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[70] w-[85vw] max-w-sm p-5"
            >
              <h3 className="font-display text-lg text-ink uppercase mb-3">Log Out?</h3>
              <p className="text-sm text-ink mb-4">Your data is safely stored in the cloud. You can log back in anytime.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirmLogout(false)} className="flex-1 h-10 bg-warm-gray rounded-sm font-display text-xs uppercase">Cancel</button>
                <button onClick={handleLogout} className="flex-1 h-10 bg-ink text-white rounded-sm font-display text-xs uppercase flex items-center justify-center gap-1.5">
                  <LogOut size={12} /> Log Out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
