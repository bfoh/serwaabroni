import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, LogOut, Download, Trash2, User, Store, Globe, Bell, HelpCircle, Shield, Camera, Share2, Tag, Plus, Pencil, RefreshCw } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useNavigate } from 'react-router'
import { exportToCSV } from '@/lib/export'
import type { BusinessProfile } from '@/lib/supabase'
import { CURATED_ICONS } from '@/lib/categories'
import { CATEGORY_ICON_MAP } from '@/lib/categoryIconMap'
import { usePermission } from '@/hooks/usePermission'
import { fetchStaff, inviteStaff, updateStaffRole, revokeStaff, type StaffMember } from '@/services/staffApi'

interface SettingsProps {
  onClose: () => void
}

export default function Settings({ onClose }: SettingsProps) {
  const { state, dispatch, showToast, logout, updateBusinessProfile, resetAllData, addCategory, renameCategory, removeCategory, loadStarterCategories, reassignAndDeleteCategory } = useStore()
  const navigate = useNavigate()
  const [showProfile, setShowProfile] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showConfirmReset, setShowConfirmReset] = useState(false)
  const [showConfirmLogout, setShowConfirmLogout] = useState(false)
  const [businessName, setBusinessName] = useState(state.businessProfile?.business_name || state.user?.business_name || '')
  const [ownerName, setOwnerName] = useState(state.businessProfile?.owner_name || '')
  const [phone, setPhone] = useState(state.businessProfile?.phone || state.user?.phone || '')
  const [logoUrl, setLogoUrl] = useState(state.user?.logo || state.businessProfile?.logo_url || localStorage.getItem('serwaabroni_logo') || '')
  const [smsSenderId, setSmsSenderId] = useState(state.businessProfile?.sms_sender_id || '')
  const [saving, setSaving] = useState(false)
  const { settingsAccess } = usePermission()
  const [showStaff, setShowStaff] = useState(false)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'manager' | 'staff'>('staff')
  const [inviting, setInviting] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState(CURATED_ICONS[0])
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [reassignFrom, setReassignFrom] = useState<{ id: string; name: string; count: number } | null>(null)
  const [reassignTo, setReassignTo] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)

  const loadStaff = async () => {
    try { setStaff(await fetchStaff()) } catch { showToast('Could not load staff', 'error') }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      await inviteStaff(inviteEmail, inviteRole)
      setInviteEmail('')
      await loadStaff()
      showToast('Invite sent', 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not send invite', 'error')
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (id: string, role: 'manager' | 'staff') => {
    try { await updateStaffRole(id, role); await loadStaff() } catch { showToast('Could not update role', 'error') }
  }

  const handleRevoke = async (id: string) => {
    try { await revokeStaff(id); await loadStaff() } catch { showToast('Could not revoke access', 'error') }
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_SIZE = 96
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width
            width = MAX_SIZE
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height
            height = MAX_SIZE
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height)
          const base64 = canvas.toDataURL('image/jpeg', 0.6)
          setLogoUrl(base64)
          localStorage.setItem('serwaabroni_logo', base64)
        }
      }
      img.src = ev.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  const handleSaveProfile = async () => {
    setSaving(true)
    const profile: BusinessProfile = {
      id: state.user?.id || 'local',
      user_id: state.user?.id || 'local',
      business_name: businessName,
      owner_name: ownerName || null,
      phone: phone || null,
      email: state.user?.email || null,
      logo_url: logoUrl || null,
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

  // Notification preference helpers. Undefined fields fall back to their DB defaults
  // (all on except WhatsApp). Toggling persists the whole profile via updateBusinessProfile.
  const notifPref = (key: keyof BusinessProfile, fallback = true) => {
    const v = state.businessProfile?.[key]
    return v === undefined || v === null ? fallback : (v as boolean)
  }

  const toggleNotif = (key: keyof BusinessProfile, fallback = true) => {
    if (!state.businessProfile) {
      showToast('Set up your shop profile first', 'error')
      return
    }
    updateBusinessProfile({ ...state.businessProfile, [key]: !notifPref(key, fallback) })
  }

  const anyChannelOn = notifPref('notify_sms') || notifPref('notify_email') || notifPref('notify_whatsapp', false)

  const saveSender = () => {
    if (!state.businessProfile) {
      showToast('Set up your shop profile first', 'error')
      return
    }
    const clean = smsSenderId.replace(/[^A-Za-z0-9]/g, '').slice(0, 11)
    if (clean !== smsSenderId) setSmsSenderId(clean)
    if (clean !== (state.businessProfile.sms_sender_id || '')) {
      updateBusinessProfile({ ...state.businessProfile, sms_sender_id: clean || null })
    }
  }

  const handleExport = () => {
    exportToCSV(state)
    showToast('Data exported!', 'success')
  }

  const handleReset = async () => {
    setSaving(true)
    await resetAllData()
    showToast('All data cleared!', 'success')
    setShowConfirmReset(false)
    setSaving(false)
  }

  const handleLogout = async () => {
    await logout()
    showToast('Logged out', 'success')
    navigate('/login')
  }

  const menuItems = [
    ...(state.isSuperAdmin
      ? [{ icon: Shield, label: 'Super Admin', action: () => navigate('/admin') }]
      : []),
    ...(settingsAccess === 'edit'
      ? [{ icon: User, label: 'Staff', action: () => { setShowStaff(true); loadStaff() } }]
      : []),
    { icon: User, label: 'Edit Profile', action: () => setShowProfile(true) },
    { icon: Tag, label: 'Manage Categories', badge: String(state.categories.length), action: () => setShowCategories(true) },
    { icon: Download, label: 'Export All Data (CSV)', action: handleExport },
    { icon: Bell, label: 'Notifications', badge: anyChannelOn ? 'On' : 'Off', action: () => setShowNotifications(true) },
    { icon: Globe, label: 'Language', badge: state.language === 'tw' ? 'Twi' : 'English', action: () => dispatch({ type: 'SET_LANGUAGE', lang: state.language === 'tw' ? 'en' : 'tw' }) },
    { icon: Share2, label: 'Community Catalog',
      badge: state.businessProfile?.catalog_contribute === false ? 'Off' : 'On',
      action: () => {
        if (!state.businessProfile) { showToast('Set up your shop profile first', 'error'); return }
        const enabled = state.businessProfile.catalog_contribute !== false
        updateBusinessProfile({ ...state.businessProfile, catalog_contribute: !enabled })
      } },
    { icon: Shield, label: 'Privacy & Security', action: () => showToast('All data stored securely on Supabase', 'success') },
    { icon: HelpCircle, label: 'Help & Support', action: () => showToast('Contact: support@serwaabroni.com', 'success') },
    { icon: Trash2, label: 'Reset All Data', danger: true, action: () => setShowConfirmReset(true) },
    { icon: LogOut, label: 'Log Out', danger: true, action: () => setShowConfirmLogout(true) },
  ]

  return (
    <div className="h-full bg-sand overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-sand border-b-2 border-ink px-5 py-3 pt-safe flex items-center justify-between">
        <h1 className="font-display text-xl text-ink uppercase tracking-tight">Settings</h1>
        <button onClick={onClose} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
          <X size={20} strokeWidth={2.5} className="text-ink" />
        </button>
      </div>

      {/* Profile Card */}
      <div className="px-5 pt-5 pb-4">
        <div className="bg-ink rounded-sm p-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-accent-red flex items-center justify-center flex-shrink-0 overflow-hidden">
            {state.user?.logo || state.businessProfile?.logo_url ? (
              <img src={state.user?.logo || state.businessProfile?.logo_url || ''} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <Store size={28} className="text-white" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display text-lg text-white uppercase tracking-tight truncate">
              {state.businessProfile?.business_name || state.user?.business_name || "My Shop"}
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
      <div className="text-center pb-24 pt-6">
        <p className="text-[10px] text-muted-text">SerwaaBroni v1.0.0</p>
        <p className="text-[9px] text-muted-text mt-0.5">Made for Ghanaian Market Women</p>
      </div>

      {/* Profile Edit Modal */}
      <AnimatePresence>
        {showProfile && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowProfile(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[90vw] max-w-sm"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b-2 border-ink">
                <h2 className="font-display text-lg text-ink uppercase">Edit Profile</h2>
                <button onClick={() => setShowProfile(false)} className="w-8 h-8 flex items-center justify-center rounded-sm bg-warm-gray"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex flex-col items-center mb-4">
                  <div className="w-20 h-20 rounded-full bg-warm-gray mb-2 flex items-center justify-center overflow-hidden relative border-2 border-ink">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
                    ) : (
                      <Store size={32} className="text-muted-text" />
                    )}
                    <label className="absolute inset-0 bg-black/40 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity">
                      <Camera size={20} className="text-white" />
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    </label>
                  </div>
                  <label className="text-[10px] text-ink uppercase tracking-wider cursor-pointer btn-tactile bg-light px-3 py-1.5 rounded-sm harsh-border">
                    Change Logo
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </label>
                </div>
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

      {/* Notification Preferences Modal */}
      <AnimatePresence>
        {showNotifications && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowNotifications(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[90vw] max-w-sm max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b-2 border-ink sticky top-0 bg-sand">
                <h2 className="font-display text-lg text-ink uppercase">Notifications</h2>
                <button onClick={() => setShowNotifications(false)} className="w-8 h-8 flex items-center justify-center rounded-sm bg-warm-gray"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <p className="text-[10px] text-muted-text uppercase tracking-wider mb-2">SMS Sender Name</p>
                  <input
                    value={smsSenderId}
                    onChange={(e) => setSmsSenderId(e.target.value)}
                    onBlur={saveSender}
                    maxLength={11}
                    placeholder="e.g. MamaShop"
                    className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm"
                  />
                  <p className="text-[10px] text-muted-text mt-1">Up to 11 letters/numbers, no spaces. Only works if this exact name is registered with Arkesel — unregistered names are silently dropped by the networks. Leave blank to use the default sender; your shop name still appears inside every message.</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-text uppercase tracking-wider mb-2">Channels</p>
                  <div className="space-y-1">
                    {([
                      ['notify_sms', 'SMS', true],
                      ['notify_email', 'Email', true],
                      ['notify_whatsapp', 'WhatsApp', false],
                    ] as const).map(([key, label, fb]) => (
                      <ToggleRow key={key} label={label + (key === 'notify_whatsapp' ? ' (needs setup)' : '')} on={notifPref(key, fb)} onToggle={() => toggleNotif(key, fb)} />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-muted-text uppercase tracking-wider mb-2">What to send</p>
                  <div className="space-y-1">
                    {([
                      ['notify_receipts', 'Sale receipts to customers'],
                      ['notify_debt_reminders', 'Debt reminders'],
                      ['notify_daily_summary', 'Daily summary to me'],
                      ['notify_critical', 'Critical alerts to me'],
                    ] as const).map(([key, label]) => (
                      <ToggleRow key={key} label={label} on={notifPref(key)} onToggle={() => toggleNotif(key)} />
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-muted-text">SMS and WhatsApp use your phone number; receipts also need the customer's contact. WhatsApp stays off until a sender ID is approved.</p>
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
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[85vw] max-w-sm p-5"
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
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[85vw] max-w-sm p-5"
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

      {/* Manage Categories Modal */}
      <AnimatePresence>
        {showCategories && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowCategories(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[90vw] max-w-sm max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b-2 border-ink sticky top-0 bg-sand">
                <h2 className="font-display text-lg text-ink uppercase">Categories</h2>
                <button onClick={() => setShowCategories(false)} className="w-8 h-8 flex items-center justify-center rounded-sm bg-warm-gray"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-4">
                <button
                  onClick={async () => {
                    setSavingCategory(true)
                    await loadStarterCategories(state.businessProfile?.industry || 'Supermarket')
                    setSavingCategory(false)
                  }}
                  disabled={savingCategory}
                  className="w-full h-10 bg-warm-gray rounded-sm font-display text-xs text-ink uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw size={14} /> Load starter categories
                </button>

                <div className="space-y-2">
                  {state.categories.map((cat) => {
                    const Icon = CATEGORY_ICON_MAP[cat.icon] || Tag
                    const count = state.products.filter((p) => p.category === cat.name).length
                    return (
                      <div key={cat.id} className="flex items-center gap-3 bg-light harsh-border rounded-sm px-3 py-2.5">
                        <Icon size={18} className="text-ink flex-shrink-0" />
                        {renamingCatId === cat.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="flex-1 h-8 px-2 bg-white harsh-border rounded-sm text-sm"
                          />
                        ) : (
                          <span className="flex-1 text-sm text-ink truncate">{cat.name}</span>
                        )}
                        <span className="text-[10px] text-muted-text">{count}</span>
                        {renamingCatId === cat.id ? (
                          <button
                            onClick={async () => {
                              if (renameValue.trim() && renameValue.trim() !== cat.name) {
                                await renameCategory(cat.id, renameValue.trim())
                              }
                              setRenamingCatId(null)
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-sm bg-accent-green/10"
                          >
                            <Pencil size={12} className="text-accent-green" />
                          </button>
                        ) : (
                          <button
                            onClick={() => { setRenamingCatId(cat.id); setRenameValue(cat.name) }}
                            className="w-7 h-7 flex items-center justify-center rounded-sm bg-warm-gray"
                          >
                            <Pencil size={12} className="text-ink" />
                          </button>
                        )}
                        {!cat.is_builtin && (
                          <button
                            onClick={async () => {
                              const result = await removeCategory(cat.id)
                              if (result.blocked && result.reason === 'in-use') {
                                setReassignFrom({ id: cat.id, name: cat.name, count: result.count })
                                setReassignTo(state.categories.find((c) => c.id !== cat.id)?.name || '')
                              }
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-sm bg-accent-red/10"
                          >
                            <Trash2 size={12} className="text-accent-red" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="pt-2 border-t border-ink/10">
                  <p className="text-[10px] text-muted-text uppercase tracking-wider mb-2">Add category</p>
                  <input
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="e.g. Frozen Foods"
                    className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm mb-2"
                  />
                  <div className="grid grid-cols-8 gap-1.5 mb-2">
                    {CURATED_ICONS.map((iconKey) => {
                      const Icon = CATEGORY_ICON_MAP[iconKey]
                      return (
                        <button
                          key={iconKey}
                          type="button"
                          onClick={() => setNewCatIcon(iconKey)}
                          className={`w-8 h-8 flex items-center justify-center rounded-sm border-2 ${newCatIcon === iconKey ? 'bg-ink border-ink' : 'bg-light border-ink'}`}
                        >
                          <Icon size={14} className={newCatIcon === iconKey ? 'text-white' : 'text-ink'} />
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={async () => {
                      if (!newCatName.trim()) { showToast('Enter a category name', 'error'); return }
                      setSavingCategory(true)
                      await addCategory(newCatName.trim(), newCatIcon)
                      setNewCatName('')
                      setSavingCategory(false)
                    }}
                    disabled={savingCategory}
                    className="w-full h-10 bg-ink text-white rounded-sm font-display text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Plus size={14} /> Add Category
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Reassign-then-delete Modal */}
      <AnimatePresence>
        {reassignFrom && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-[70]" onClick={() => setReassignFrom(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[71] w-[85vw] max-w-sm p-5"
            >
              <h3 className="font-display text-lg text-ink uppercase mb-2">Move products first</h3>
              <p className="text-sm text-ink mb-4">
                {reassignFrom.count} product{reassignFrom.count === 1 ? '' : 's'} still use "{reassignFrom.name}". Choose where to move them before deleting it.
              </p>
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="w-full h-11 px-3 bg-light harsh-border rounded-sm text-sm mb-4"
              >
                {state.categories.filter((c) => c.id !== reassignFrom.id).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
              <div className="flex gap-3">
                <button onClick={() => setReassignFrom(null)} className="flex-1 h-10 bg-warm-gray rounded-sm font-display text-xs uppercase">Cancel</button>
                <button
                  onClick={async () => {
                    if (!reassignTo) return
                    await reassignAndDeleteCategory(reassignFrom.id, reassignFrom.name, reassignTo)
                    setReassignFrom(null)
                  }}
                  className="flex-1 h-10 bg-accent-red text-white rounded-sm font-display text-xs uppercase flex items-center justify-center gap-1.5"
                >
                  <Trash2 size={12} /> Move & Delete
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Staff Management Modal */}
      <AnimatePresence>
        {showStaff && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowStaff(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[90vw] max-w-sm max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b-2 border-ink sticky top-0 bg-sand">
                <h2 className="font-display text-lg text-ink uppercase">Staff</h2>
                <button onClick={() => setShowStaff(false)} className="w-8 h-8 flex items-center justify-center rounded-sm bg-warm-gray"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-text uppercase tracking-wider">Invite</p>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="staff@example.com"
                    className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'manager' | 'staff')}
                    className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm"
                  >
                    <option value="staff">Staff</option>
                    <option value="manager">Manager</option>
                  </select>
                  <button
                    onClick={handleInvite}
                    disabled={inviting || !inviteEmail.trim()}
                    className="w-full h-11 bg-ink text-white font-display text-sm uppercase tracking-wider rounded-sm disabled:opacity-50"
                  >
                    {inviting ? '...' : 'Send Invite'}
                  </button>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-text uppercase tracking-wider">Team</p>
                  {staff.length === 0 && <p className="text-xs text-muted-text">No staff invited yet.</p>}
                  {staff.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 px-3 py-2.5 bg-light harsh-border rounded-sm">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink truncate">{m.invited_email}</p>
                        <p className="text-[10px] text-muted-text uppercase">{m.status}</p>
                      </div>
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.id, e.target.value as 'manager' | 'staff')}
                        className="h-8 px-2 bg-warm-gray rounded-sm text-xs"
                      >
                        <option value="staff">Staff</option>
                        <option value="manager">Manager</option>
                      </select>
                      <button onClick={() => handleRevoke(m.id)} className="h-8 px-2 bg-accent-red/10 text-accent-red rounded-sm text-xs">
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2.5 bg-light harsh-border rounded-sm">
      <span className="text-sm text-ink text-left">{label}</span>
      <span className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-accent-green' : 'bg-warm-gray'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
