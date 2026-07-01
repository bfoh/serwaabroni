import { createClient } from '@supabase/supabase-js'

// Supabase project credentials — hardcoded for reliability
// The anon key is safe to expose — RLS policies protect all data
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qumttowvyujqaubyshjq.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1bXR0b3d2eXVqcWF1YnlzaGpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQwMzI1MjAsImV4cCI6MjA2OTYwODUyMH0.aUdDVEJOWVVDalJQRFV6bUZqd0w'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

// Types for SerwaaBroni data models
export interface Product {
  id: string
  user_id: string
  name: string
  cost_price: number
  selling_price: number
  quantity: number
  unit: string
  pack_unit?: string | null
  units_per_pack: number
  category: string
  low_stock_threshold: number
  barcode?: string | null
  qr_code?: string | null
  created_at: string
  updated_at?: string
}

export interface Sale {
  id: string
  user_id: string
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number
  sale_unit?: string | null
  sale_unit_qty?: number | null
  total: number
  profit: number
  customer_name: string | null
  customer_phone: string | null
  payment_method: 'cash' | 'momo' | 'bank' | 'credit'
  qr_invoice?: string | null
  sale_group_id?: string | null
  created_at: string
}

export interface DebtPayment {
  amount: number
  date: string
}

export interface Debt {
  id: string
  user_id: string
  person_name: string
  phone: string | null
  amount: number
  amount_paid: number
  payments: DebtPayment[]
  description: string | null
  type: 'owed' | 'owing'
  due_date: string | null
  is_paid: boolean
  paid_at: string | null
  reminder_sent?: boolean
  // For type='owed': the capital injection that funded the goods taken on credit.
  injection_id?: string | null
  // For credit sales: links this tab to the originating sale group.
  sale_group_id?: string | null
  created_at: string
}

export interface Expense {
  id: string
  user_id: string
  name: string
  description?: string | null
  amount: number
  category: string
  notes?: string | null
  created_at: string
}

export interface Customer {
  id: string
  user_id: string
  name: string
  phone: string | null
  email: string | null
  total_purchases: number
  created_at: string
}

export interface StockBatch {
  id: string
  user_id: string
  injection_id: string | null
  product_id: string
  qty_purchased: number
  qty_remaining: number
  unit_cost: number
  total_cost: number
  purchased_at: string
}

export interface BatchConsumption {
  id: string
  user_id: string
  sale_id: string
  batch_id: string | null
  injection_id: string | null
  qty: number
  unit_cost: number
  unit_price: number
  profit: number
  created_at: string
}

export type CapitalSource = 'microfinance' | 'personal' | 'family_friends' | 'investment' | 'other'
export type RiskTier = 'on_track' | 'watch' | 'at_risk'

export interface CapitalInjection {
  id: string
  user_id: string
  source: CapitalSource
  lender_name: string | null
  principal: number
  interest_amount: number
  total_repayable: number
  amount_repaid: number
  injection_date: string
  payback_months: number
  installment_count: number
  repayment_type: 'equal' | 'interest_only'
  status: 'active' | 'repaid' | 'closed'
  risk_tier: RiskTier
  risk_alerted: boolean
  notes: string | null
  created_at: string
}

export interface RepaymentInstallment {
  id: string
  user_id: string
  injection_id: string
  seq: number
  due_date: string
  amount_due: number
  amount_paid: number
  paid_at: string | null
  status: 'due' | 'paid' | 'overdue'
}

export interface BusinessProfile {
  id: string
  user_id: string
  business_name: string
  owner_name: string | null
  phone: string | null
  email: string | null
  logo_url?: string | null
  currency: string
  language: string
  status?: 'active' | 'suspended'
  suspended_at?: string | null
  suspended_reason?: string | null
  catalog_contribute?: boolean
  sms_sender_id?: string | null
  notify_sms?: boolean
  notify_email?: boolean
  notify_whatsapp?: boolean
  notify_receipts?: boolean
  notify_debt_reminders?: boolean
  notify_daily_summary?: boolean
  notify_critical?: boolean
  created_at: string
  updated_at: string
}

export interface SyncQueueItem {
  id: string
  user_id: string
  table_name: string
  operation: 'insert' | 'update' | 'delete'
  payload: Record<string, unknown>
  retry_count: number
  synced: boolean
  created_at: string
}
