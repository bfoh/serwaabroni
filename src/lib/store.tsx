import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Product, Sale, Debt, Expense, BusinessProfile, Customer } from './supabase'
import { cacheOfflineData } from '@/services/offline'
import { t as translate } from './i18n'
import type { Language } from './i18n'
import { loadData, saveData } from './data'

import { checkAuth, signOut as supabaseSignOut, updateProfile } from '@/services/auth'
import {
  fetchProducts, insertProduct, updateProductDb, deleteProductDb,
  fetchSales, recordSale,
  fetchDebts, insertDebt, updateDebtDb,
  fetchExpenses, insertExpense, deleteExpenseDb,
  fetchBusinessProfile, upsertBusinessProfile,
  fetchCustomers, insertCustomer, updateCustomer as updateCustomerDb,
  getDashboardSummary,
} from '@/services/supabaseApi'

export type Tab = 'home' | 'stock' | 'debts' | 'reports'

export interface UserState {
  id: string
  email: string
  phone?: string
  business_name?: string
  logo?: string
}

export interface AppState {
  activeTab: Tab
  balance: number
  todaySales: number
  todayProfit: number
  pendingDebts: number
  products: Product[]
  sales: Sale[]
  debts: Debt[]
  expenses: Expense[]
  customers: Customer[]
  showAddSheet: boolean
  selectedProductId: string | null
  toast: { message: string; type: 'success' | 'error' } | null
  user: UserState | null
  isAuthenticated: boolean
  authLoading: boolean
  language: Language
  businessProfile: BusinessProfile | null
  dataLoading: boolean
  isOnline: boolean
}

type Action =
  | { type: 'SET_TAB'; tab: Tab }
  | { type: 'SET_BALANCE'; value: number }
  | { type: 'SET_TODAY_SALES'; value: number }
  | { type: 'SET_TODAY_PROFIT'; value: number }
  | { type: 'SET_PENDING_DEBTS'; value: number }
  | { type: 'SET_PRODUCTS'; products: Product[] }
  | { type: 'ADD_PRODUCT'; product: Product }
  | { type: 'UPDATE_PRODUCT'; product: Product }
  | { type: 'DELETE_PRODUCT'; id: string }
  | { type: 'SET_SALES'; sales: Sale[] }
  | { type: 'ADD_SALE'; sale: Sale }
  | { type: 'SET_DEBTS'; debts: Debt[] }
  | { type: 'ADD_DEBT'; debt: Debt }
  | { type: 'UPDATE_DEBT'; debt: Debt }
  | { type: 'SET_EXPENSES'; expenses: Expense[] }
  | { type: 'ADD_EXPENSE'; expense: Expense }
  | { type: 'DELETE_EXPENSE'; id: string }
  | { type: 'SET_CUSTOMERS'; customers: Customer[] }
  | { type: 'ADD_CUSTOMER'; customer: Customer }
  | { type: 'UPDATE_CUSTOMER'; customer: Customer }
  | { type: 'TOGGLE_ADD_SHEET'; show: boolean }
  | { type: 'SELECT_PRODUCT'; id: string | null }
  | { type: 'SHOW_TOAST'; message: string; toastType: 'success' | 'error' }
  | { type: 'HIDE_TOAST' }
  | { type: 'SET_USER'; user: UserState | null }
  | { type: 'SET_LANGUAGE'; lang: Language }
  | { type: 'SET_BUSINESS_PROFILE'; profile: BusinessProfile | null }
  | { type: 'SET_DATA_LOADING'; loading: boolean }
  | { type: 'SET_ONLINE'; online: boolean }
  | { type: 'LOAD_ALL_DATA'; products: Product[]; sales: Sale[]; debts: Debt[]; expenses: Expense[]; customers: Customer[]; balance: number; todaySales: number; todayProfit: number; pendingDebts: number }

function getStoredLang(): Language {
  try { return (localStorage.getItem('serwaabroni_language') as Language) || 'en' }
  catch { return 'en' }
}

const initialState: AppState = {
  activeTab: 'home',
  balance: 0,
  todaySales: 0,
  todayProfit: 0,
  pendingDebts: 0,
  products: [],
  sales: [],
  debts: [],
  expenses: [],
  customers: [],
  showAddSheet: false,
  selectedProductId: null,
  toast: null,
  user: null,
  isAuthenticated: false,
  authLoading: true,
  language: getStoredLang(),
  businessProfile: null,
  dataLoading: false,
  isOnline: navigator.onLine,
}

// Helper: persist current data to localStorage (for offline access)
function persistFromState(state: Pick<AppState, 'products' | 'sales' | 'debts' | 'expenses' | 'customers'>) {
  saveData({
    products: state.products,
    sales: state.sales,
    debts: state.debts,
    expenses: state.expenses,
    customers: state.customers,
    businessName: '',
    ownerName: '',
  })
}

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_TAB': return { ...state, activeTab: action.tab }
    case 'SET_BALANCE': return { ...state, balance: action.value }
    case 'SET_TODAY_SALES': return { ...state, todaySales: action.value }
    case 'SET_TODAY_PROFIT': return { ...state, todayProfit: action.value }
    case 'SET_PENDING_DEBTS': return { ...state, pendingDebts: action.value }
    case 'SET_PRODUCTS': return { ...state, products: action.products }
    case 'ADD_PRODUCT': return { ...state, products: [action.product, ...state.products] }
    case 'UPDATE_PRODUCT': return { ...state, products: state.products.map((p) => (p.id === action.product.id ? action.product : p)) }
    case 'DELETE_PRODUCT': return { ...state, products: state.products.filter((p) => p.id !== action.id) }
    case 'SET_SALES': return { ...state, sales: action.sales }
    case 'ADD_SALE': return { ...state, sales: [action.sale, ...state.sales] }
    case 'SET_DEBTS': return { ...state, debts: action.debts }
    case 'ADD_DEBT': return { ...state, debts: [action.debt, ...state.debts] }
    case 'UPDATE_DEBT': return { ...state, debts: state.debts.map((d) => (d.id === action.debt.id ? action.debt : d)) }
    case 'SET_EXPENSES': return { ...state, expenses: action.expenses }
    case 'ADD_EXPENSE': return { ...state, expenses: [action.expense, ...state.expenses] }
    case 'DELETE_EXPENSE': return { ...state, expenses: state.expenses.filter((e) => e.id !== action.id) }
    case 'SET_CUSTOMERS': return { ...state, customers: action.customers }
    case 'ADD_CUSTOMER': return { ...state, customers: [action.customer, ...state.customers] }
    case 'UPDATE_CUSTOMER': return { ...state, customers: state.customers.map((c) => (c.id === action.customer.id ? action.customer : c)) }
    case 'TOGGLE_ADD_SHEET': return { ...state, showAddSheet: action.show }
    case 'SELECT_PRODUCT': return { ...state, selectedProductId: action.id }
    case 'SHOW_TOAST': return { ...state, toast: { message: action.message, type: action.toastType } }
    case 'HIDE_TOAST': return { ...state, toast: null }
    case 'SET_USER': {
      if (!action.user) return { ...state, user: null, isAuthenticated: false, authLoading: false }
      return {
        ...state,
        user: {
          id: action.user.id,
          email: action.user.email,
          phone: action.user.phone,
          business_name: action.user.business_name,
          logo: action.user.logo || localStorage.getItem('serwaabroni_logo') || undefined,
        },
        isAuthenticated: true,
        authLoading: false,
      }
    }
    case 'SET_LANGUAGE': return { ...state, language: action.lang }
    case 'SET_BUSINESS_PROFILE': return { ...state, businessProfile: action.profile }
    case 'SET_DATA_LOADING': return { ...state, dataLoading: action.loading }
    case 'SET_ONLINE': return { ...state, isOnline: action.online }
    case 'LOAD_ALL_DATA': return { ...state, products: action.products, sales: action.sales, debts: action.debts, expenses: action.expenses, customers: action.customers, balance: action.balance, todaySales: action.todaySales, todayProfit: action.todayProfit, pendingDebts: action.pendingDebts }
    default: return state
  }
}

// ============================================================
// STORE CONTEXT
// ============================================================
interface StoreContextType {
  state: AppState
  dispatch: React.Dispatch<Action>
  setTab: (tab: Tab) => void
  showToast: (message: string, type: 'success' | 'error') => void
  t: (key: string) => string
  refreshData: () => Promise<void>
  // Supabase-synced actions
  addProduct: (product: Omit<Product, 'user_id'>) => Promise<void>
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>
  removeProduct: (id: string) => Promise<void>
  addSale: (sale: Omit<Sale, 'user_id'>, productId: string, quantitySold: number) => Promise<void>
  addDebt: (debt: Omit<Debt, 'user_id'>) => Promise<void>
  updateDebt: (id: string, updates: Partial<Debt>) => Promise<void>
  addExpense: (expense: Omit<Expense, 'user_id'>) => Promise<void>
  removeExpense: (id: string) => Promise<void>
  addCustomer: (customer: Omit<Customer, 'user_id'>) => Promise<void>
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>
  updateBusinessProfile: (profile: BusinessProfile) => Promise<void>
  logout: () => Promise<void>
}

const StoreContext = createContext<StoreContextType | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const isFirstLoad = useRef(true)

  // Check auth on mount — Supabase Auth is the single source of truth
  useEffect(() => {
    checkAuth().then((session) => {
      dispatch({ type: 'SET_USER', user: session })
    }).catch(() => {
      dispatch({ type: 'SET_USER', user: null })
    })

    // Listen for Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        dispatch({
          type: 'SET_USER',
          user: {
            id: session.user.id,
            email: session.user.email!,
            phone: session.user.user_metadata?.phone,
            business_name: session.user.user_metadata?.business_name,
            logo: session.user.user_metadata?.logo || localStorage.getItem('serwaabroni_logo') || undefined,
          },
        })
      } else {
        dispatch({ type: 'SET_USER', user: null })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Network status
  useEffect(() => {
    const onOnline = () => dispatch({ type: 'SET_ONLINE', online: true })
    const onOffline = () => dispatch({ type: 'SET_ONLINE', online: false })
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const setTab = useCallback((tab: Tab) => { dispatch({ type: 'SET_TAB', tab }) }, [])

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    dispatch({ type: 'SHOW_TOAST', message, toastType: type })
    setTimeout(() => dispatch({ type: 'HIDE_TOAST' }), 3000)
  }, [])

  const t = useCallback((key: string) => translate(key, state.language), [state.language])

  // ==========================================================
  // LOAD DATA — Supabase first (scoped to user), localStorage fallback
  // ==========================================================
  const refreshData = useCallback(async () => {
    dispatch({ type: 'SET_DATA_LOADING', loading: true })

    try {
      const local = loadData()
      const [remoteProducts, remoteSales, remoteDebts, remoteExpenses, summary, profile, remoteCustomers] = await Promise.all([
        fetchProducts(),
        fetchSales(),
        fetchDebts(),
        fetchExpenses(),
        getDashboardSummary(),
        fetchBusinessProfile(),
        fetchCustomers(),
      ])

      // Merge offline-created data that hasn't synced
      const products = [...local.products.filter(p => p.user_id === 'local'), ...remoteProducts]
      const sales = [...local.sales.filter(s => s.user_id === 'local'), ...remoteSales]
      const debts = [...local.debts.filter(d => d.user_id === 'local'), ...remoteDebts]
      const expenses = [...local.expenses.filter(e => e.user_id === 'local'), ...remoteExpenses]
      const customers = [...(local.customers || []).filter(c => c.user_id === 'local'), ...remoteCustomers]

      dispatch({
        type: 'LOAD_ALL_DATA',
        products,
        sales,
        debts,
        expenses,
        customers,
        balance: summary.totalSales - summary.totalExpenses,
        todaySales: summary.todaySales,
        todayProfit: summary.todayProfit,
        pendingDebts: summary.pendingDebts,
      })
      
      if (profile) {
        dispatch({ type: 'SET_BUSINESS_PROFILE', profile })
      }

      persistFromState({ products, sales, debts, expenses, customers })
      cacheOfflineData({ products, sales, debts, expenses, lastSync: Date.now() })
    } catch {
      // Fall back to localStorage / seed data
      const local = loadData()
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todaySales = local.sales.filter((s) => new Date(s.created_at) >= today).reduce((sum, s) => sum + s.total, 0)
      const pendingDebts = local.debts.filter((d) => d.type === 'owed' && !d.is_paid).reduce((sum, d) => sum + d.amount, 0)
      const totalSales = local.sales.reduce((s, sale) => s + sale.total, 0)
      const totalExpenses = local.expenses.reduce((s, e) => s + e.amount, 0)

      dispatch({
        type: 'LOAD_ALL_DATA',
        products: local.products,
        sales: local.sales,
        debts: local.debts,
        expenses: local.expenses,
        customers: local.customers || [],
        balance: totalSales - totalExpenses,
        todaySales,
        todayProfit: todaySales * 0.2,
        pendingDebts,
      })
    } finally {
      dispatch({ type: 'SET_DATA_LOADING', loading: false })
    }
  }, [])

  // Load data after auth is confirmed
  useEffect(() => {
    if (!isFirstLoad.current) return
    if (state.authLoading) return // wait for auth check
    isFirstLoad.current = false

    if (state.isAuthenticated) {
      // User is logged in — fetch their data from Supabase
      refreshData()
    } else {
      // No user — load seed data for demo purposes
      const local = loadData()
      dispatch({
        type: 'LOAD_ALL_DATA',
        products: local.products,
        sales: local.sales,
        debts: local.debts,
        expenses: local.expenses,
        customers: local.customers || [],
        balance: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0,
      })
    }
  }, [state.authLoading, state.isAuthenticated, refreshData])

  // ==========================================================
  // SUPABASE-SYNCED CRUD — ALL MULTI-TENANT
  // ==========================================================

  const addProduct = useCallback(async (product: Omit<Product, 'user_id'>) => {
    try {
      const inserted = await insertProduct(product)
      dispatch({ type: 'ADD_PRODUCT', product: inserted })
      persistFromState({ ...state, products: [inserted, ...state.products] })
      showToast('Product added', 'success')
    } catch {
      const localProduct: Product = { ...product, user_id: 'local' } as Product
      dispatch({ type: 'ADD_PRODUCT', product: localProduct })
      persistFromState({ ...state, products: [localProduct, ...state.products] })
      showToast('Saved locally (will sync when online)', 'success')
    }
  }, [state, showToast])

  const updateProduct = useCallback(async (id: string, updates: Partial<Product>) => {
    try {
      const updated = await updateProductDb(id, updates)
      dispatch({ type: 'UPDATE_PRODUCT', product: updated })
      const newProducts = state.products.map((p) => p.id === id ? updated : p)
      persistFromState({ ...state, products: newProducts })
    } catch {
      const existing = state.products.find((p) => p.id === id)
      if (existing) {
        const updated = { ...existing, ...updates, updated_at: new Date().toISOString() }
        dispatch({ type: 'UPDATE_PRODUCT', product: updated })
        persistFromState({ ...state, products: state.products.map((p) => p.id === id ? updated : p) })
      }
    }
  }, [state])

  const removeProduct = useCallback(async (id: string) => {
    try { await deleteProductDb(id) } catch { /* may not exist in db */ }
    dispatch({ type: 'DELETE_PRODUCT', id })
    persistFromState({ ...state, products: state.products.filter((p) => p.id !== id) })
    showToast('Product deleted', 'success')
  }, [state, showToast])

  const addSale = useCallback(async (sale: Omit<Sale, 'user_id'>, productId: string, quantitySold: number) => {
    try {
      const recorded = await recordSale(sale, productId, quantitySold)
      dispatch({ type: 'ADD_SALE', sale: recorded })
      const products = await fetchProducts()
      dispatch({ type: 'SET_PRODUCTS', products })
      const summary = await getDashboardSummary()
      dispatch({ type: 'SET_BALANCE', value: summary.totalSales - summary.totalExpenses })
      dispatch({ type: 'SET_TODAY_SALES', value: summary.todaySales })
      dispatch({ type: 'SET_TODAY_PROFIT', value: summary.todayProfit })
      persistFromState({ ...state, products, sales: [recorded, ...state.sales] })
      showToast('Sale recorded!', 'success')
    } catch {
      const localSale: Sale = { ...sale, user_id: 'local' } as Sale
      dispatch({ type: 'ADD_SALE', sale: localSale })
      const existing = state.products.find((p) => p.id === productId)
      if (existing) {
        dispatch({ type: 'UPDATE_PRODUCT', product: { ...existing, quantity: Math.max(0, existing.quantity - quantitySold) } })
      }
      persistFromState({
        ...state,
        products: state.products.map((p) => p.id === productId ? { ...p, quantity: Math.max(0, p.quantity - quantitySold) } : p),
        sales: [localSale, ...state.sales],
      })
      showToast('Sale saved locally', 'success')
    }
  }, [state, showToast])

  const addDebt = useCallback(async (debt: Omit<Debt, 'user_id'>) => {
    try {
      const inserted = await insertDebt(debt)
      dispatch({ type: 'ADD_DEBT', debt: inserted })
      persistFromState({ ...state, debts: [inserted, ...state.debts] })
    } catch {
      const localDebt: Debt = { ...debt, user_id: 'local' } as Debt
      dispatch({ type: 'ADD_DEBT', debt: localDebt })
      persistFromState({ ...state, debts: [localDebt, ...state.debts] })
    }
  }, [state])

  const updateDebt = useCallback(async (id: string, updates: Partial<Debt>) => {
    try {
      const updated = await updateDebtDb(id, updates)
      dispatch({ type: 'UPDATE_DEBT', debt: updated })
      persistFromState({ ...state, debts: state.debts.map((d) => d.id === id ? updated : d) })
    } catch {
      const existing = state.debts.find((d) => d.id === id)
      if (existing) {
        const updated = { ...existing, ...updates }
        dispatch({ type: 'UPDATE_DEBT', debt: updated })
        persistFromState({ ...state, debts: state.debts.map((d) => d.id === id ? updated : d) })
      }
    }
  }, [state])

  const addExpense = useCallback(async (expense: Omit<Expense, 'user_id'>) => {
    try {
      const inserted = await insertExpense(expense)
      dispatch({ type: 'ADD_EXPENSE', expense: inserted })
      persistFromState({ ...state, expenses: [inserted, ...state.expenses] })
    } catch {
      const localExpense: Expense = { ...expense, user_id: 'local' } as Expense
      dispatch({ type: 'ADD_EXPENSE', expense: localExpense })
      persistFromState({ ...state, expenses: [localExpense, ...state.expenses] })
    }
  }, [state])

  const removeExpense = useCallback(async (id: string) => {
    try { await deleteExpenseDb(id) } catch { /* */ }
    dispatch({ type: 'DELETE_EXPENSE', id })
    persistFromState({ ...state, expenses: state.expenses.filter((e) => e.id !== id) })
  }, [state])

  const addCustomer = useCallback(async (customer: Omit<Customer, 'user_id'>) => {
    try {
      const inserted = await insertCustomer(customer)
      dispatch({ type: 'ADD_CUSTOMER', customer: inserted })
      persistFromState({ ...state, customers: [inserted, ...state.customers] })
    } catch {
      const localCustomer: Customer = { ...customer, user_id: 'local' } as Customer
      dispatch({ type: 'ADD_CUSTOMER', customer: localCustomer })
      persistFromState({ ...state, customers: [localCustomer, ...state.customers] })
    }
  }, [state])

  const updateCustomer = useCallback(async (id: string, updates: Partial<Customer>) => {
    try {
      const updated = await updateCustomerDb(id, updates)
      dispatch({ type: 'UPDATE_CUSTOMER', customer: updated })
      persistFromState({ ...state, customers: state.customers.map((c) => c.id === id ? updated : c) })
    } catch {
      const existing = state.customers.find((c) => c.id === id)
      if (existing) {
        const updated = { ...existing, ...updates }
        dispatch({ type: 'UPDATE_CUSTOMER', customer: updated })
        persistFromState({ ...state, customers: state.customers.map((c) => c.id === id ? updated : c) })
      }
    }
  }, [state])

  const logout = useCallback(async () => {
    await supabaseSignOut()
    dispatch({ type: 'SET_USER', user: null })
  }, [])

  const updateBusinessProfile = useCallback(async (profile: BusinessProfile) => {
    // 1. Always save to Supabase Auth user metadata as a bulletproof fallback
    try {
      await updateProfile({
        business_name: profile.business_name,
        phone: profile.phone || undefined,
        logo: profile.logo_url || undefined,
      })
      // The auth listener will eventually pick this up, but we can optimistically update user state
      if (state.user) {
        dispatch({ type: 'SET_USER', user: { ...state.user, business_name: profile.business_name, phone: profile.phone || undefined, logo: profile.logo_url || undefined } })
      }
    } catch (e) {
      console.warn('Auth metadata update failed', e)
    }

    // 2. Try to save to the dedicated business_profiles table
    try {
      const saved = await upsertBusinessProfile(profile)
      dispatch({ type: 'SET_BUSINESS_PROFILE', profile: saved })
    } catch {
      dispatch({ type: 'SET_BUSINESS_PROFILE', profile }) // local fallback
    }
  }, [state.user])

  return (
    <StoreContext.Provider value={{
      state, dispatch, setTab, showToast, t, refreshData,
      addProduct, updateProduct, removeProduct,
      addSale, addDebt, updateDebt, addExpense, removeExpense,
      addCustomer, updateCustomer,
      updateBusinessProfile,
      logout,
    }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const context = useContext(StoreContext)
  if (!context) throw new Error('useStore must be used within StoreProvider')
  return context
}
