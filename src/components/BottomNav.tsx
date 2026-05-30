import { LayoutGrid, Package, CirclePlus, ScrollText, BarChart3, Settings } from 'lucide-react'
import { Link } from 'react-router'
import { useStore } from '@/lib/store'
import type { Tab } from '@/lib/store'

const mainTabs: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'home', label: 'HOME', icon: LayoutGrid },
  { key: 'stock', label: 'STOCK', icon: Package },
  { key: 'debts', label: 'DEBTS', icon: ScrollText },
  { key: 'reports', label: 'REPORT', icon: BarChart3 },
]

export default function BottomNav() {
  const { state, setTab, dispatch } = useStore()

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-ink z-50 flex items-center justify-around select-none">
      {mainTabs.map((item) => {
        const isActive = state.activeTab === item.key

        return (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
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
        onClick={() => dispatch({ type: 'TOGGLE_ADD_SHEET', show: true })}
        className="btn-tactile flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative"
      >
        <div className="w-11 h-11 rounded-full bg-accent-red flex items-center justify-center -mt-4 shadow-lg">
          <CirclePlus size={24} strokeWidth={2.5} className="text-white" />
        </div>
      </button>

      {/* Settings Link */}
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
    </nav>
  )
}
