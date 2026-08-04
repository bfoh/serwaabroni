import { useState } from 'react'
import { LayoutGrid, Package, CirclePlus, ScrollText, BarChart3, Settings, LogOut } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useNavigate, useLocation } from 'react-router'
import { useStore } from '@/lib/store'
import type { Tab } from '@/lib/store'
import { usePermission } from '@/hooks/usePermission'
import { visibleMainTabKeys } from '@/lib/permissions'

const allMainTabs: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'home', label: 'HOME', icon: LayoutGrid },
  { key: 'stock', label: 'STOCK', icon: Package },
  { key: 'debts', label: 'DEBTS', icon: ScrollText },
  { key: 'reports', label: 'REPORT', icon: BarChart3 },
]

export default function BottomNav() {
  const { state, setTab, dispatch, logout } = useStore()
  const { role, settingsAccess } = usePermission()
  const navigate = useNavigate()
  const location = useLocation()
  const mainTabs = allMainTabs.filter((t) => visibleMainTabKeys(role).includes(t.key))
  const [showConfirmLogout, setShowConfirmLogout] = useState(false)

  const handleTabClick = (key: Tab) => {
    setTab(key)
    if (location.pathname !== '/') {
      navigate('/')
    }
  }

  const handleAddSaleClick = () => {
    if (location.pathname !== '/') {
      navigate('/')
    }
    dispatch({ type: 'TOGGLE_ADD_SHEET', show: true })
  }

  return (
    <nav className="w-full h-full pb-safe bg-ink flex items-center justify-around select-none">
      {mainTabs.map((item) => {
        const isActive = state.activeTab === item.key

        return (
          <button
            key={item.key}
            onClick={() => handleTabClick(item.key)}
            className="btn-tactile flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative"
          >
            <item.icon
              size={22}
              strokeWidth={isActive ? 2.5 : 1.5}
              className={isActive ? 'text-accent-red' : 'text-white/70'}
            />
            <span
              className={`text-[10px] font-display tracking-wider ${
                isActive ? 'text-accent-red' : 'text-white/50'
              }`}
            >
              {item.label}
            </span>
          </button>
        )
      })}

      {/* Add Sale Button */}
      <button
        onClick={handleAddSaleClick}
        className="btn-tactile flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative"
      >
        <div className="w-11 h-11 rounded-full bg-accent-red flex items-center justify-center -mt-4 shadow-lg">
          <CirclePlus size={24} strokeWidth={2.5} className="text-white" />
        </div>
      </button>

      {/* Settings Link — hidden for Staff (settingsAccess === 'none'); the
          /settings route itself is also gated in App.tsx as the real backstop.
          Staff gets a Log Out button in this same slot instead: Settings is the
          app's only other Log Out entry point, so hiding it with no replacement
          left Staff/Manager-without-Settings unable to ever sign out. Found in
          the RBAC feature's final whole-branch review, fix-wave re-review round 2. */}
      {settingsAccess !== 'none' ? (
        <Link
          to="/settings"
          className="btn-tactile flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative"
        >
          <Settings
            size={22}
            strokeWidth={1.5}
            className="text-white/70"
          />
          <span className="text-[10px] font-display tracking-wider text-white/50">
            SETTINGS
          </span>
        </Link>
      ) : (
        <button
          onClick={() => setShowConfirmLogout(true)}
          className="btn-tactile flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative"
        >
          <LogOut size={22} strokeWidth={1.5} className="text-white/70" />
          <span className="text-[10px] font-display tracking-wider text-white/50">
            LOG OUT
          </span>
        </button>
      )}

      <AnimatePresence>
        {showConfirmLogout && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowConfirmLogout(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: '-50%', y: '-50%' }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
              exit={{ opacity: 0, scale: 0.95, x: '-50%', y: '-50%' }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[85vw] max-w-sm p-5"
            >
              <h3 className="font-display text-lg text-ink uppercase mb-3">Log Out?</h3>
              <p className="text-sm text-ink mb-4">Your data is safely stored in the cloud. You can log back in anytime.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirmLogout(false)} className="flex-1 h-10 bg-warm-gray rounded-sm font-display text-xs uppercase">Cancel</button>
                <button onClick={() => { setShowConfirmLogout(false); logout() }} className="flex-1 h-10 bg-ink text-white rounded-sm font-display text-xs uppercase flex items-center justify-center gap-1.5">
                  <LogOut size={12} /> Log Out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </nav>
  )
}
