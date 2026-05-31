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
  logo_url?: string | null
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
