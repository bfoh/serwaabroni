import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Product, Sale, Debt, Expense, BusinessProfile, Customer } from './supabase'
import { cacheOfflineData, queueOperation, syncQueue, getQueue, getQueueLength, mergeDebts, setupAutoSync } from '@/services/offline'
import { t as translate } from './i18n'
import type { Language } from './i18n'
import { loadData, saveData, type SaleGroup } from './data'
import { generateAlerts, type Alert } from './alerts'
import { sendNotification } from '@/services/notify'

import { checkAuth, signOut as supabaseSignOut, updateProfile } from '@/services/auth'
import {
  fetchProducts, insertProduct, updateProductDb, deleteProductDb,
  fetchSales, recordSale, recordSaleBatch, deleteSaleGroup,
  fetchDebts, insertDebt, updateDebtDb, deleteDebtDb,
  fetchExpenses, insertExpense, deleteExpenseDb,
  fetchBusinessProfile, upsertBusinessProfile,
  fetchCustomers, insertCustomer, updateCustomer as updateCustomerDb,
  getDashboardSummary, resetAllUserData,
} from '@/services/supabaseApi'
import { amISuperAdmin } from '@/services/adminApi'
import { contributeCatalog } from '@/services/catalogApi'
import { postMovement as postCashMovement, deleteMovementsByRef as deleteCashByRef } from '@/services/cashApi'
import type { CashAccount } from '@/lib/cashBalances'

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
  bankBalance: number
  todaySales: number
  todayProfit: number
  pendingDebts: number
  products: Product[]
  sales: Sale[]
  debts: Debt[]
  expenses: Expense[]
  customers: Customer[]
  alerts: Alert[]
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
  pendingSync: number
  isSuperAdmin: boolean
  suspended: boolean
}

type Action =
  | { type: 'SET_TAB'; tab: Tab }
  | { type: 'SET_BALANCE'; value: number }
  | { type: 'SET_BANK_BALANCE'; value: number }
  | { type: 'SET_TODAY_SALES'; value: number }
  | { type: 'SET_TODAY_PROFIT'; value: number }
  | { type: 'SET_PENDING_DEBTS'; value: number }
  | { type: 'SET_PRODUCTS'; products: Product[] }
  | { type: 'ADD_PRODUCT'; product: Product }
  | { type: 'UPDATE_PRODUCT'; product: Product }
  | { type: 'DELETE_PRODUCT'; id: string }
  | { type: 'SET_SALES'; sales: Sale[] }
  | { type: 'ADD_SALE'; sale: Sale }
  | { type: 'DELETE_SALES'; ids: string[] }
  | { type: 'SET_DEBTS'; debts: Debt[] }
  | { type: 'ADD_DEBT'; debt: Debt }
  | { type: 'UPDATE_DEBT'; debt: Debt }
  | { type: 'SET_EXPENSES'; expenses: Expense[] }
  | { type: 'ADD_EXPENSE'; expense: Expense }
  | { type: 'DELETE_DEBT'; id: string }
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
  | { type: 'SET_PENDING_SYNC'; value: number }
  | { type: 'SET_SUPER_ADMIN'; value: boolean }
  | { type: 'SET_SUSPENDED'; value: boolean }
  | { type: 'SET_ALERTS'; alerts: Alert[] }
  | { type: 'LOAD_ALL_DATA'; products: Product[]; sales: Sale[]; debts: Debt[]; expenses: Expense[]; customers: Customer[]; alerts: Alert[]; balance: number; todaySales: number; todayProfit: number; pendingDebts: number }

function getStoredLang(): Language {
  try { return (localStorage.getItem('serwaabroni_language') as Language) || 'en' }
  catch { return 'en' }
}

const initialState: AppState = {
  activeTab: 'home',
  balance: 0,
  bankBalance: 0,
  todaySales: 0,
  todayProfit: 0,
  pendingDebts: 0,
  products: [],
  sales: [],
  debts: [],
  expenses: [],
  customers: [],
  alerts: [],
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
  pendingSync: 0,
  isSuperAdmin: false,
  suspended: false,
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
    case 'SET_BANK_BALANCE': return { ...state, bankBalance: action.value }
    case 'SET_TODAY_SALES': return { ...state, todaySales: action.value }
    case 'SET_TODAY_PROFIT': return { ...state, todayProfit: action.value }
    case 'SET_PENDING_DEBTS': return { ...state, pendingDebts: action.value }
    case 'SET_PRODUCTS': return { ...state, products: action.products }
    case 'ADD_PRODUCT': return { ...state, products: [action.product, ...state.products] }
    case 'UPDATE_PRODUCT': return { ...state, products: state.products.map((p) => (p.id === action.product.id ? action.product : p)) }
    case 'DELETE_PRODUCT': return { ...state, products: state.products.filter((p) => p.id !== action.id) }
    case 'SET_SALES': return { ...state, sales: action.sales }
    case 'ADD_SALE': return { ...state, sales: [action.sale, ...state.sales] }
    case 'DELETE_SALES': return { ...state, sales: state.sales.filter((s) => !action.ids.includes(s.id)) }
    case 'SET_DEBTS': return { ...state, debts: action.debts }
    case 'ADD_DEBT': return { ...state, debts: [action.debt, ...state.debts] }
    case 'UPDATE_DEBT': return { ...state, debts: state.debts.map((d) => (d.id === action.debt.id ? action.debt : d)) }
    case 'DELETE_DEBT': return { ...state, debts: state.debts.filter((d) => d.id !== action.id) }
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
    case 'SET_PENDING_SYNC': return { ...state, pendingSync: action.value }
    case 'SET_SUPER_ADMIN': return { ...state, isSuperAdmin: action.value }
    case 'SET_SUSPENDED': return { ...state, suspended: action.value }
    case 'SET_ALERTS': return { ...state, alerts: action.alerts }
    case 'LOAD_ALL_DATA': return { ...state, products: action.products, sales: action.sales, debts: action.debts, expenses: action.expenses, customers: action.customers, alerts: action.alerts, balance: action.balance, todaySales: action.todaySales, todayProfit: action.todayProfit, pendingDebts: action.pendingDebts }
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
  addProduct: (product: Omit<Product, 'user_id'>, injectionId?: string | null, opts?: { account?: CashAccount; unpaid?: boolean }) => Promise<void>
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>
  removeProduct: (id: string) => Promise<void>
  addSale: (sale: Omit<Sale, 'user_id'>, productId: string, quantitySold: number) => Promise<void>
  addSaleBatch: (sales: Omit<Sale, 'user_id'>[], items: { productId: string; qty: number }[]) => Promise<void>
  deleteSale: (group: SaleGroup) => Promise<void>
  addDebt: (debt: Omit<Debt, 'user_id'>) => Promise<void>
  updateDebt: (id: string, updates: Partial<Debt>) => Promise<void>
  removeDebt: (id: string) => Promise<void>
  addExpense: (expense: Omit<Expense, 'user_id'>, account?: CashAccount) => Promise<void>
  removeExpense: (id: string) => Promise<void>
  addCustomer: (customer: Omit<Customer, 'user_id'>) => Promise<void>
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>
  updateBusinessProfile: (profile: BusinessProfile) => Promise<void>
  resetAllData: () => Promise<void>
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

  // Real-time cash balances: recompute Cash in Hand / Bank straight from the
  // ledger whenever any cash_movements row changes (from any screen). Keeps the
  // Home hero in lock-step with the Cash Flow page.
  useEffect(() => {
    const uid = state.user?.id
    if (!uid) return
    let cancelled = false
    const refreshBalances = async () => {
      try {
        const { fetchBalances } = await import('@/services/cashApi')
        const bal = await fetchBalances()
        if (!cancelled) {
          dispatch({ type: 'SET_BALANCE', value: bal.cash })
          dispatch({ type: 'SET_BANK_BALANCE', value: bal.bank })
        }
      } catch { /* ledger unavailable — leave current balances */ }
    }
    refreshBalances() // initial sync on login
    const channel = supabase
      .channel(`cash_movements:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_movements', filter: `user_id=eq.${uid}` }, refreshBalances)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [state.user?.id])

  // Auto-persist state to localStorage whenever core data changes
  useEffect(() => {
    if (state.dataLoading) return // don't persist during initial load
    persistFromState(state)
  }, [state.products, state.sales, state.debts, state.expenses, state.customers])

  const setTab = useCallback((tab: Tab) => { dispatch({ type: 'SET_TAB', tab }) }, [])

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    dispatch({ type: 'SHOW_TOAST', message, toastType: type })
    setTimeout(() => dispatch({ type: 'HIDE_TOAST' }), 3000)
  }, [])

  const t = useCallback((key: string) => translate(key, state.language), [state.language])

  // Keep the offline-queue depth in store state so the connection bar can show
  // how many changes are still waiting to sync. Recomputed wherever the queue
  // changes (a write is queued, or the queue is flushed).
  const syncPending = useCallback(() => {
    dispatch({ type: 'SET_PENDING_SYNC', value: getQueueLength() })
  }, [])

  // ==========================================================
  // LOAD DATA — Supabase first (scoped to user), localStorage fallback
  // ==========================================================
  const refreshData = useCallback(async () => {
    dispatch({ type: 'SET_DATA_LOADING', loading: true })

    try {
      const local = loadData()

      // Push any writes that failed earlier (flaky network) BEFORE reading, so the
      // fetch below reflects them instead of returning stale rows. Without this a
      // recorded payment that didn't reach the server would "revert" on refresh.
      if (navigator.onLine) {
        try { await syncQueue() } catch { /* keep queued; overlay below covers UI */ }
        syncPending()
      }

      const results = await Promise.allSettled([
        fetchProducts(),
        fetchSales(),
        fetchDebts(),
        fetchExpenses(),
        getDashboardSummary(),
        fetchBusinessProfile(),
        fetchCustomers(),
      ])

      const remoteProducts = results[0].status === 'fulfilled' ? results[0].value : []
      const remoteSales = results[1].status === 'fulfilled' ? results[1].value : []
      const remoteDebts = results[2].status === 'fulfilled' ? results[2].value : []
      const remoteExpenses = results[3].status === 'fulfilled' ? results[3].value : []
      const summary = results[4].status === 'fulfilled' ? results[4].value : { totalSales: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0, totalExpenses: 0, cashInHand: 0, cashInBank: 0 }
      const profile = results[5].status === 'fulfilled' ? results[5].value : null
      const remoteCustomers = results[6].status === 'fulfilled' ? results[6].value : []

      // Merge offline-created data that hasn't synced and sort newest first
      const products = [...local.products.filter(p => p.user_id === 'local'), ...remoteProducts]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      const sales = [...local.sales.filter(s => s.user_id === 'local'), ...remoteSales]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      // Remote is authoritative, but keep optimistic edits alive: dedupe by id
      // (remote wins) then re-overlay any writes still waiting in the sync queue
      // so a just-recorded payment never disappears before it lands server-side.
      const debts = mergeDebts(local.debts, remoteDebts, getQueue())
      const expenses = [...local.expenses.filter(e => e.user_id === 'local'), ...remoteExpenses]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      const customers = [...(local.customers || []).filter(c => c.user_id === 'local'), ...remoteCustomers]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      const generatedAlerts = generateAlerts(products, sales, debts, expenses)

      dispatch({
        type: 'LOAD_ALL_DATA',
        products,
        sales,
        debts,
        expenses,
        customers,
        alerts: generatedAlerts,
        balance: summary.cashInHand || 0,
        todaySales: summary.todaySales || 0,
        todayProfit: summary.todayProfit || 0,
        pendingDebts: summary.pendingDebts || 0,
      })
      dispatch({ type: 'SET_BANK_BALANCE', value: summary.cashInBank || 0 })

      if (profile) {
        dispatch({ type: 'SET_BUSINESS_PROFILE', profile })

        // Push critical alerts to the owner (SMS/email). Per-day de-dupe lives in the
        // edge function, so repeated app loads won't re-send the same alert.
        if (profile.notify_critical !== false && (profile.phone || profile.email)) {
          for (const alert of generatedAlerts.filter((a) => a.isCritical)) {
            sendNotification({
              type: 'critical',
              data: { businessName: profile.business_name, title: alert.title, message: alert.message },
              phoneTo: profile.phone,
              emailTo: profile.email,
              refId: alert.id,
            })
          }
        }
      }

      // Admin + suspension flags
      const admin = await amISuperAdmin()
      dispatch({ type: 'SET_SUPER_ADMIN', value: admin })
      dispatch({ type: 'SET_SUSPENDED', value: (profile?.status === 'suspended') && !admin })

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
      // Credit-sale debts inflate totalSales by their unpaid portion (only the
      // deposit is cash); subtract it. Manual owed debts never hit sales.
      const creditSalesOutstanding = local.debts
        .filter((d) => d.type === 'owed' && !d.is_paid && d.sale_group_id)
        .reduce((sum, d) => sum + Math.max(0, d.amount - (d.amount_paid || 0)), 0)

      const localAlerts = generateAlerts(local.products, local.sales, local.debts, local.expenses)

      dispatch({
        type: 'LOAD_ALL_DATA',
        products: local.products,
        sales: local.sales,
        debts: local.debts,
        expenses: local.expenses,
        customers: local.customers || [],
        alerts: localAlerts,
        balance: totalSales - totalExpenses - creditSalesOutstanding,
        todaySales,
        todayProfit: todaySales * 0.2,
        pendingDebts,
      })
    } finally {
      dispatch({ type: 'SET_DATA_LOADING', loading: false })
    }
  }, [syncPending])

  // Load data after auth is confirmed
  useEffect(() => {
    if (!isFirstLoad.current) return
    if (state.authLoading) return // wait for auth check
    isFirstLoad.current = false

    if (state.isAuthenticated) {
      // User is logged in — fetch their data from Supabase
      syncPending()
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
        alerts: generateAlerts(local.products, local.sales, local.debts, local.expenses),
        balance: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0,
      })
    }
  }, [state.authLoading, state.isAuthenticated, refreshData, syncPending])

  // Flush the offline write queue when the network returns or the tab regains
  // focus, then re-sync from the server. This is what makes a payment recorded
  // while offline (or during a blip) actually persist instead of reverting.
  useEffect(() => {
    if (!state.isAuthenticated) return
    const teardown = setupAutoSync((result) => {
      syncPending()
      if (result.success > 0) refreshData()
    })
    return teardown
  }, [state.isAuthenticated, refreshData, syncPending])

  // ==========================================================
  // SUPABASE-SYNCED CRUD — ALL MULTI-TENANT
  // ==========================================================

  const addProduct = useCallback(async (product: Omit<Product, 'user_id'>, injectionId?: string | null, opts?: { account?: CashAccount; unpaid?: boolean }) => {
    try {
      const inserted = await insertProduct(product)
      dispatch({ type: 'ADD_PRODUCT', product: inserted })
      // Create the opening stock batch so the product's sales are costed and
      // traceable (FIFO). Optionally tag it to the capital injection that funded it,
      // and post the cash outflow (unless bought on supplier credit).
      if ((inserted.quantity || 0) > 0) {
        try {
          const { receiveStock } = await import('@/services/batchApi')
          await receiveStock({
            productId: inserted.id,
            qty: inserted.quantity,
            unitCost: inserted.cost_price,
            injectionId: injectionId || null,
            purchasedAt: inserted.created_at,
            account: opts?.account ?? 'cash',
            unpaid: opts?.unpaid ?? false,
          })
        } catch {
          /* offline or error — batch can be reconciled later; product already added */
        }
      }
      const code = inserted.barcode || inserted.qr_code
      if (code && state.businessProfile?.catalog_contribute !== false) {
        void contributeCatalog(code, inserted.name, null, inserted.category, inserted.unit)
      }
      showToast('Product added', 'success')
    } catch {
      const localProduct: Product = { ...product, user_id: 'local' } as Product
      dispatch({ type: 'ADD_PRODUCT', product: localProduct })
      showToast('Saved locally (will sync when online)', 'success')
    }
  }, [state, showToast])

  const updateProduct = useCallback(async (id: string, updates: Partial<Product>) => {
    try {
      const updated = await updateProductDb(id, updates)
      dispatch({ type: 'UPDATE_PRODUCT', product: updated })
    } catch {
      const existing = state.products.find((p) => p.id === id)
      if (existing) {
        const updated = { ...existing, ...updates, updated_at: new Date().toISOString() }
        dispatch({ type: 'UPDATE_PRODUCT', product: updated })
      }
    }
  }, [state])

  const removeProduct = useCallback(async (id: string) => {
    try { await deleteProductDb(id) } catch { /* may not exist in db */ }
    dispatch({ type: 'DELETE_PRODUCT', id })
    showToast('Product deleted', 'success')
  }, [state, showToast])

  const addSale = useCallback(async (sale: Omit<Sale, 'user_id'>, productId: string, quantitySold: number) => {
    try {
      const recorded = await recordSale(sale, productId, quantitySold)
      dispatch({ type: 'ADD_SALE', sale: recorded })
      const products = await fetchProducts()
      dispatch({ type: 'SET_PRODUCTS', products })
      const summary = await getDashboardSummary()
      dispatch({ type: 'SET_BALANCE', value: summary.cashInHand })
      dispatch({ type: 'SET_BANK_BALANCE', value: summary.cashInBank })
      dispatch({ type: 'SET_TODAY_SALES', value: summary.todaySales })
      dispatch({ type: 'SET_TODAY_PROFIT', value: summary.todayProfit })
      showToast('Sale recorded!', 'success')
    } catch {
      const localSale: Sale = { ...sale, user_id: 'local' } as Sale
      dispatch({ type: 'ADD_SALE', sale: localSale })
      const existing = state.products.find((p) => p.id === productId)
      if (existing) {
        dispatch({ type: 'UPDATE_PRODUCT', product: { ...existing, quantity: Math.max(0, existing.quantity - quantitySold) } })
      }
      showToast('Sale saved locally', 'success')
    }
  }, [state, showToast])

  const addSaleBatch = useCallback(async (
    sales: Omit<Sale, 'user_id'>[],
    items: { productId: string; qty: number }[]
  ) => {
    try {
      const recorded = await recordSaleBatch(sales, items)
      recorded.forEach((sale) => dispatch({ type: 'ADD_SALE', sale }))
      const products = await fetchProducts()
      dispatch({ type: 'SET_PRODUCTS', products })
      const summary = await getDashboardSummary()
      dispatch({ type: 'SET_BALANCE', value: summary.cashInHand })
      dispatch({ type: 'SET_BANK_BALANCE', value: summary.cashInBank })
      dispatch({ type: 'SET_TODAY_SALES', value: summary.todaySales })
      dispatch({ type: 'SET_TODAY_PROFIT', value: summary.todayProfit })
      showToast('Sale recorded!', 'success')
    } catch {
      sales.forEach((sale) => {
        const localSale: Sale = { ...sale, user_id: 'local' } as Sale
        dispatch({ type: 'ADD_SALE', sale: localSale })
      })
      items.forEach(({ productId, qty }) => {
        const existing = state.products.find((p) => p.id === productId)
        if (existing) {
          dispatch({ type: 'UPDATE_PRODUCT', product: { ...existing, quantity: Math.max(0, existing.quantity - qty) } })
        }
      })
      showToast('Sale saved locally', 'success')
    }
  }, [state, showToast])

  const deleteSale = useCallback(async (group: SaleGroup) => {
    const ids = group.sales.map((s) => s.id)
    // Optimistic: drop the row right away so the UI feels instant.
    dispatch({ type: 'DELETE_SALES', ids })
    try {
      await deleteSaleGroup(group.sales)
      // Re-sync derived data in parallel (one wall-clock round-trip, not three).
      const [products, summary, customers] = await Promise.all([
        fetchProducts(),
        getDashboardSummary(),
        fetchCustomers(),
      ])
      dispatch({ type: 'SET_PRODUCTS', products })
      dispatch({ type: 'SET_BALANCE', value: summary.cashInHand })
      dispatch({ type: 'SET_BANK_BALANCE', value: summary.cashInBank })
      dispatch({ type: 'SET_TODAY_SALES', value: summary.todaySales })
      dispatch({ type: 'SET_TODAY_PROFIT', value: summary.todayProfit })
      dispatch({ type: 'SET_CUSTOMERS', customers })
      showToast('Sale deleted', 'success')
    } catch {
      if (!state.isOnline) {
        // Truly offline — keep the optimistic removal, adjust stock/customer locally.
        const qtyByProduct = new Map<string, number>()
        for (const s of group.sales) {
          if (!s.product_id) continue
          qtyByProduct.set(s.product_id, (qtyByProduct.get(s.product_id) || 0) + s.quantity)
        }
        qtyByProduct.forEach((qty, productId) => {
          const existing = state.products.find((p) => p.id === productId)
          if (existing) {
            dispatch({ type: 'UPDATE_PRODUCT', product: { ...existing, quantity: existing.quantity + qty } })
          }
        })
        const customerName = group.sales[0].customer_name
        if (customerName) {
          const existing = state.customers.find((c) => c.name.toLowerCase() === customerName.toLowerCase())
          if (existing) {
            dispatch({ type: 'UPDATE_CUSTOMER', customer: { ...existing, total_purchases: Math.max(0, (existing.total_purchases || 0) - group.total) } })
          }
        }
        showToast('Sale deleted (offline)', 'success')
        return
      }
      // Online but the server rejected the delete — restore the row so the UI
      // matches the server instead of faking a delete that never happened.
      try {
        const sales = await fetchSales()
        dispatch({ type: 'SET_SALES', sales })
      } catch { /* leave optimistic state if even the re-fetch fails */ }
      showToast('Could not delete sale', 'error')
    }
  }, [state, showToast])

  const addDebt = useCallback(async (debt: Omit<Debt, 'user_id'>) => {
    try {
      const inserted = await insertDebt(debt)
      dispatch({ type: 'ADD_DEBT', debt: inserted })
    } catch {
      const localDebt: Debt = { ...debt, user_id: 'local' } as Debt
      dispatch({ type: 'ADD_DEBT', debt: localDebt })
      // Queue for retry so the debt actually reaches the server once back online.
      queueOperation('debts', 'insert', { ...debt })
      syncPending()
    }
  }, [state, syncPending])

  const updateDebt = useCallback(async (id: string, updates: Partial<Debt>) => {
    try {
      const updated = await updateDebtDb(id, updates)
      dispatch({ type: 'UPDATE_DEBT', debt: updated })
    } catch {
      // The write didn't reach the server. Apply it optimistically AND queue it for
      // retry — otherwise the edit (e.g. a recorded payment) is lost on next refresh
      // because the merge replaces this row with the stale server copy.
      const existing = state.debts.find((d) => d.id === id)
      if (existing) {
        const updated = { ...existing, ...updates }
        dispatch({ type: 'UPDATE_DEBT', debt: updated })
      }
      queueOperation('debts', 'update', { id, ...updates })
      syncPending()
    }
  }, [state, syncPending])

  const removeDebt = useCallback(async (id: string) => {
    // Optimistic remove so the UI feels instant.
    dispatch({ type: 'DELETE_DEBT', id })
    try {
      await deleteDebtDb(id)
      showToast('Debt deleted', 'success')
    } catch {
      if (!state.isOnline) {
        // Truly offline — keep the optimistic removal and queue the delete so it
        // actually happens on the server once back online (otherwise it reappears).
        queueOperation('debts', 'delete', { id })
        syncPending()
        showToast('Debt deleted (offline)', 'success')
        return
      }
      // Online but the server rejected the delete (e.g. missing RLS delete policy).
      // Restore the real server state instead of faking a delete that never happened.
      try {
        const debts = await fetchDebts()
        dispatch({ type: 'SET_DEBTS', debts })
      } catch { /* leave optimistic state if even the re-fetch fails */ }
      showToast('Could not delete debt', 'error')
    }
  }, [state, showToast, syncPending])

  const addExpense = useCallback(async (expense: Omit<Expense, 'user_id'>, account: CashAccount = 'cash') => {
    try {
      const inserted = await insertExpense(expense)
      dispatch({ type: 'ADD_EXPENSE', expense: inserted })
      // Ledger: an expense leaves the chosen account (defaults to cash in hand).
      try {
        await postCashMovement({
          account, direction: 'out', amount: inserted.amount, category: 'expense',
          ref_table: 'expenses', ref_id: inserted.id, note: inserted.name, created_at: inserted.created_at,
        })
      } catch { /* ledger post best-effort; balance reconciles on next refresh */ }
    } catch {
      const localExpense: Expense = { ...expense, user_id: 'local' } as Expense
      dispatch({ type: 'ADD_EXPENSE', expense: localExpense })
    }
  }, [state])

  const removeExpense = useCallback(async (id: string) => {
    try { await deleteExpenseDb(id) } catch { /* */ }
    try { await deleteCashByRef('expenses', id) } catch { /* */ }
    dispatch({ type: 'DELETE_EXPENSE', id })
  }, [])

  const addCustomer = useCallback(async (customer: Omit<Customer, 'user_id'>) => {
    try {
      const inserted = await insertCustomer(customer)
      dispatch({ type: 'ADD_CUSTOMER', customer: inserted })
    } catch {
      const localCustomer: Customer = { ...customer, user_id: 'local' } as Customer
      dispatch({ type: 'ADD_CUSTOMER', customer: localCustomer })
    }
  }, [state])

  const updateCustomer = useCallback(async (id: string, updates: Partial<Customer>) => {
    try {
      const updated = await updateCustomerDb(id, updates)
      dispatch({ type: 'UPDATE_CUSTOMER', customer: updated })
    } catch {
      const existing = state.customers.find((c) => c.id === id)
      if (existing) {
        const updated = { ...existing, ...updates }
        dispatch({ type: 'UPDATE_CUSTOMER', customer: updated })
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

  const resetAllData = useCallback(async () => {
    try {
      await resetAllUserData()
      dispatch({ type: 'SET_PRODUCTS', products: [] })
      dispatch({ type: 'SET_SALES', sales: [] })
      dispatch({ type: 'SET_DEBTS', debts: [] })
      dispatch({ type: 'SET_EXPENSES', expenses: [] })
      dispatch({ type: 'SET_CUSTOMERS', customers: [] })
      dispatch({ type: 'SET_BALANCE', value: 0 })
      dispatch({ type: 'SET_TODAY_SALES', value: 0 })
      dispatch({ type: 'SET_TODAY_PROFIT', value: 0 })
      dispatch({ type: 'SET_PENDING_DEBTS', value: 0 })
    } catch {
      showToast('Failed to reset data', 'error')
    }
  }, [])

  return (
    <StoreContext.Provider value={{
      state, dispatch, setTab, showToast, t, refreshData,
      addProduct, updateProduct, removeProduct,
      addSale, addSaleBatch, deleteSale, addDebt, updateDebt, removeDebt, addExpense, removeExpense,
      addCustomer, updateCustomer,
      updateBusinessProfile,
      resetAllData,
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
