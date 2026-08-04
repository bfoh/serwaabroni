import { Routes, Route, Navigate } from 'react-router'
import { useState, useEffect } from 'react'
import { Mic } from 'lucide-react'
import { useStore } from '@/lib/store'
import { usePermission } from '@/hooks/usePermission'
import Dashboard from '@/pages/Dashboard'
import Inventory from '@/pages/Inventory'
import Debts from '@/pages/Debts'
import Reports from '@/pages/Reports'
import SettingsPage from '@/pages/Settings'
import SalesHistory from '@/pages/SalesHistory'
import Expenses from '@/pages/Expenses'
import Login from '@/pages/Login'
import IndustryPicker from '@/components/IndustryPicker'
import BottomNav from '@/components/BottomNav'
import AddSaleSheet from '@/components/AddSaleSheet'
import Toast from '@/components/Toast'
import ConnectionBar from '@/components/ConnectionBar'
import Customers from '@/pages/Customers'
import SuspendedScreen from '@/components/SuspendedScreen'
import AdminConsole from '@/pages/AdminConsole'
import ImpersonationBanner from '@/components/ImpersonationBanner'
import Capital from '@/pages/Capital'
import InjectionDetail from '@/pages/InjectionDetail'
import CashFlow from '@/pages/CashFlow'
import AgentSheet from '@/components/agent/AgentSheet'

function MainApp() {
  const { state, setTab } = useStore()
  const { canView } = usePermission()
  const [showSalesHistory, setShowSalesHistory] = useState(false)
  const [showExpenses, setShowExpenses] = useState(false)
  const [showCustomers, setShowCustomers] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)

  // Automatically close overlays when the active tab changes
  useEffect(() => {
    setShowSalesHistory(false)
    setShowExpenses(false)
    setShowCustomers(false)
  }, [state.activeTab])

  // Defense in depth: if a role loses Reports access (or a stale tab
  // selection survives a role change), bounce back to Home instead of
  // rendering a tab BottomNav no longer shows a link for.
  useEffect(() => {
    if (state.activeTab === 'reports' && !canView('reports')) setTab('home')
  }, [state.activeTab, canView, setTab])

  const renderPage = () => {
    switch (state.activeTab) {
      case 'home':
        return <Dashboard 
          onOpenSalesHistory={() => setShowSalesHistory(true)} 
          onOpenExpenses={() => setShowExpenses(true)} 
          onOpenCustomers={() => setShowCustomers(true)} 
        />
      case 'stock':
        return <Inventory />
      case 'debts':
        return <Debts />
      case 'reports':
        return <Reports />
      default:
        return <Dashboard 
          onOpenSalesHistory={() => setShowSalesHistory(true)} 
          onOpenExpenses={() => setShowExpenses(true)} 
          onOpenCustomers={() => setShowCustomers(true)} 
        />
    }
  }

  return (
    <div className="h-full w-full overflow-hidden relative">
      <main className="h-full overflow-y-auto no-scrollbar pb-10">
        {renderPage()}
      </main>
      
      <AddSaleSheet />

      {/* SerwaaBroni voice agent */}
      <button
        onClick={() => setAgentOpen(true)}
        aria-label="Open SerwaaBroni"
        className="fixed right-4 bottom-24 z-40 w-14 h-14 rounded-full bg-accent-green text-white shadow-lg flex items-center justify-center btn-tactile"
      >
        <Mic size={24} />
      </button>
      <AgentSheet open={agentOpen} onClose={() => setAgentOpen(false)} />

      {/* Overlay pages */}
      <SalesHistory isOpen={showSalesHistory} onClose={() => setShowSalesHistory(false)} />
      <Expenses isOpen={showExpenses} onClose={() => setShowExpenses(false)} />
      
      {showCustomers && (
        <div className="absolute inset-0 z-40 bg-sand flex flex-col">
          <div className="flex justify-end p-2 border-b-2 border-ink flex-shrink-0">
            <button onClick={() => setShowCustomers(false)} className="btn-tactile p-2 bg-warm-gray rounded-sm">
              Back to Home
            </button>
          </div>
          <div className="flex-1 overflow-y-auto pb-24">
            <Customers />
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const { state } = useStore()
  const { canView, settingsAccess } = usePermission()

  if (state.authLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-sand">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-ink border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-display text-sm text-muted-text mt-4 uppercase tracking-wider">Loading...</p>
        </div>
      </div>
    )
  }

  if (state.isAuthenticated && state.suspended && !state.isSuperAdmin) {
    return (
      <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden">
        <ImpersonationBanner />
        <div className="flex-1 overflow-hidden"><SuspendedScreen /></div>
      </div>
    )
  }

  // Every real tenant has a business_profiles row after migration_022 (see
  // that migration's backfill). A logged-in user with none is a brand-new
  // signup who hasn't picked their industry yet — but `businessProfile === null`
  // is also what a transient fetch failure (offline cold start, network blip,
  // RLS hiccup) looks like, since it's indistinguishable at that point. Gate on
  // the definitive 'missing' status instead (set only when the fetch actually
  // confirms zero rows, never on error) and require online, so an existing
  // tenant can never get locked out of their own data by this screen.
  //
  // ALSO require role === null: migration_027 correctly restricts
  // business_profiles SELECT to Owner/Manager only (Staff has zero DB access
  // to it, by design) — so an active Staff account's businessProfileStatus is
  // ALWAYS 'missing', even though their employer's business genuinely exists.
  // role_for() is SECURITY DEFINER and resolves correctly regardless of that
  // SELECT restriction (it queries business_members directly, unaffected by
  // RLS on a different table) — role !== null there means "this uid belongs
  // to a real business already," which is the actual signal a genuinely new,
  // unaffiliated signup can never produce (their role is null too, precisely
  // because they own no profile and belong to no business_members row yet).
  // Without this, every Staff login would be permanently stuck on this screen.
  if (state.isAuthenticated && !state.dataLoading && !state.suspended && state.isOnline && state.businessProfileStatus === 'missing' && state.role === null) {
    return (
      <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden">
        <IndustryPicker />
      </div>
    )
  }

  return (
    <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden relative">
      <ImpersonationBanner />
      <div className="flex-1 overflow-hidden relative">
        <Routes>
          <Route
            path="/login"
            element={state.isAuthenticated ? <Navigate to="/" replace /> : <Login />}
          />
          <Route
            path="/settings"
            element={
              !state.isAuthenticated ? <Navigate to="/login" replace />
              // role hasn't resolved yet (fresh login / hard refresh on this
              // route) — settingsAccess is computed from state.role, which is
              // still null at this instant for EVERY role, not just Staff.
              // Bouncing home here would incorrectly evict a genuine
              // Owner/Manager mid-resolve; show a spinner instead, same as the
              // /admin route below. Found in the RBAC feature's final
              // whole-branch review, fix-wave re-review round 2.
              : !state.roleResolved ? (
                <div className="h-full w-full flex items-center justify-center bg-sand">
                  <div className="w-10 h-10 border-4 border-ink border-t-transparent rounded-full animate-spin" />
                </div>
              )
              // Staff has zero business-settings access per the permission
              // matrix (settingsAccess === 'none') — Settings is where the
              // catastrophic "Reset All Data" action lives, among other
              // owner/manager-only actions, so Staff never reaches this page
              // at all rather than relying on in-page gating alone.
              : settingsAccess === 'none' ? <Navigate to="/" replace />
              : (
                <div className="h-full w-full overflow-hidden bg-sand relative">
                  <SettingsPage onClose={() => window.history.back()} />
                </div>
              )
            }
          />
          <Route
            path="/admin"
            element={
              !state.isAuthenticated
                ? <Navigate to="/login" replace />
                : !state.adminChecked
                  ? (
                    <div className="h-full w-full flex items-center justify-center bg-sand">
                      <div className="w-10 h-10 border-4 border-ink border-t-transparent rounded-full animate-spin" />
                    </div>
                  )
                  : state.isSuperAdmin
                    ? <div className="h-full w-full overflow-hidden bg-sand relative"><AdminConsole /></div>
                    : <Navigate to="/" replace />
            }
          />
          <Route
            path="/capital"
            element={
              !state.isAuthenticated ? <Navigate to="/login" replace />
              : !canView('capital') ? <Navigate to="/" replace />
              : <div className="h-full w-full overflow-y-auto bg-sand relative"><Capital /></div>
            }
          />
          <Route
            path="/capital/:id"
            element={
              !state.isAuthenticated ? <Navigate to="/login" replace />
              : !canView('capital') ? <Navigate to="/" replace />
              : <div className="h-full w-full overflow-y-auto bg-sand relative"><InjectionDetail /></div>
            }
          />
          <Route
            path="/cash"
            element={
              !state.isAuthenticated ? <Navigate to="/login" replace />
              : !canView('cashFlow') ? <Navigate to="/" replace />
              : <div className="h-full w-full overflow-y-auto bg-sand relative"><CashFlow /></div>
            }
          />
          <Route
            path="/*"
            element={state.isAuthenticated ? <MainApp /> : <Navigate to="/login" replace />}
          />
        </Routes>
      </div>
      
      {state.isAuthenticated && (
        <div className="flex-shrink-0 h-nav w-full z-40 relative border-t-2 border-ink">
          <BottomNav />
        </div>
      )}
      
      <ConnectionBar />
      <Toast />
    </div>
  )
}
