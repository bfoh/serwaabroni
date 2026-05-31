import { Routes, Route, Navigate } from 'react-router'
import { useState } from 'react'
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
import Customers from '@/pages/Customers'

function MainApp() {
  const { state } = useStore()
  const [showSalesHistory, setShowSalesHistory] = useState(false)
  const [showExpenses, setShowExpenses] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCustomers, setShowCustomers] = useState(false)

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
    <div className="h-screen w-full overflow-hidden bg-sand relative">
      <main className="h-full overflow-y-auto no-scrollbar">
        {renderPage()}
      </main>
      <BottomNav />
      <AddSaleSheet />
      {/* Overlay pages */}
      <SalesHistory isOpen={showSalesHistory} onClose={() => setShowSalesHistory(false)} />
      <Expenses isOpen={showExpenses} onClose={() => setShowExpenses(false)} />
      {showSettings && <SettingsPage onClose={() => setShowSettings(false)} />}
      
      {showCustomers && (
        <div className="absolute inset-0 z-50 bg-sand">
          <div className="flex justify-end p-2 border-b-2 border-ink">
            <button onClick={() => setShowCustomers(false)} className="btn-tactile p-2 bg-warm-gray rounded-sm">
              Back to Home
            </button>
          </div>
          <div className="h-[calc(100%-60px)] overflow-y-auto">
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

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={state.isAuthenticated ? <Navigate to="/" replace /> : <Login />}
        />
        <Route
          path="/settings"
          element={state.isAuthenticated ? (
            <div className="h-screen w-full overflow-hidden bg-sand relative">
              <SettingsPage onClose={() => window.history.back()} />
            </div>
          ) : <Navigate to="/login" replace />}
        />
        <Route
          path="/*"
          element={state.isAuthenticated ? <MainApp /> : <Navigate to="/login" replace />}
        />
      </Routes>
      <Toast />
    </>
  )
}
