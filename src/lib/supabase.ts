import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient(supabaseUrl, supabaseKey, {
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
  total: number
  profit: number
  customer_name: string | null
  customer_phone: string | null
  payment_method: 'cash' | 'momo' | 'bank'
  qr_invoice?: string | null
  created_at: string
}

export interface Debt {
  id: string
  user_id: string
  person_name: string
  phone: string | null
  amount: number
  description: string | null
  type: 'owed' | 'owing'
  due_date: string | null
  is_paid: boolean
  paid_at: string | null
  reminder_sent?: boolean
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

export interface BusinessProfile {
  id: string
  user_id: string
  business_name: string
  owner_name: string | null
  phone: string | null
  email: string | null
  currency: string
  language: string
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
