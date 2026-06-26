import { Routes, Route, Navigate } from 'react-router'
import { useState, useEffect } from 'react'
import { useStore } from '@/lib/store'
import Dashboard from '@/pages/Dashboard'
import Inventory from '@/pages/Inventory'
import Debts from '@/pages/Debts'
import Reports from '@/pages/Reports'
import SettingsPage from '@/pages/Settings'
import SalesHistory from '@/pages/SalesHistory'
import Expenses from '@/pages/Expenses'
import Login from '@/pages/Login'
import BottomNav from '@/components/BottomNav'
import AddSaleSheet from '@/components/AddSaleSheet'
import Toast from '@/components/Toast'
import ConnectionBar from '@/components/ConnectionBar'
import Customers from '@/pages/Customers'
import SuspendedScreen from '@/components/SuspendedScreen'
import AdminConsole from '@/pages/AdminConsole'
import Capital from '@/pages/Capital'
import InjectionDetail from '@/pages/InjectionDetail'
import CashFlow from '@/pages/CashFlow'

function MainApp() {
  const { state } = useStore()
  const [showSalesHistory, setShowSalesHistory] = useState(false)
  const [showExpenses, setShowExpenses] = useState(false)
  const [showCustomers, setShowCustomers] = useState(false)

  // Automatically close overlays when the active tab changes
  useEffect(() => {
    setShowSalesHistory(false)
    setShowExpenses(false)
    setShowCustomers(false)
  }, [state.activeTab])

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
    return <SuspendedScreen />
  }

  return (
    <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-hidden relative">
        <Routes>
          <Route
            path="/login"
            element={state.isAuthenticated ? <Navigate to="/" replace /> : <Login />}
          />
          <Route
            path="/settings"
            element={state.isAuthenticated ? (
              <div className="h-full w-full overflow-hidden bg-sand relative">
                <SettingsPage onClose={() => window.history.back()} />
              </div>
            ) : <Navigate to="/login" replace />}
          />
          <Route
            path="/admin"
            element={
              state.isAuthenticated && state.isSuperAdmin
                ? <div className="h-full w-full overflow-hidden bg-sand relative"><AdminConsole /></div>
                : <Navigate to="/" replace />
            }
          />
          <Route
            path="/capital"
            element={state.isAuthenticated ? (
              <div className="h-full w-full overflow-y-auto bg-sand relative"><Capital /></div>
            ) : <Navigate to="/login" replace />}
          />
          <Route
            path="/capital/:id"
            element={state.isAuthenticated ? (
              <div className="h-full w-full overflow-y-auto bg-sand relative"><InjectionDetail /></div>
            ) : <Navigate to="/login" replace />}
          />
          <Route
            path="/cash"
            element={state.isAuthenticated ? (
              <div className="h-full w-full overflow-y-auto bg-sand relative"><CashFlow /></div>
            ) : <Navigate to="/login" replace />}
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
