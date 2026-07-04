import type { Product, Debt, Sale } from '@/lib/supabase'

export type AgentToolName =
  | 'new_product'
  | 'add_stock'
  | 'add_sale'
  | 'add_credit_sale'
  | 'get_summary'
  | 'get_low_stock'
  | 'get_debts'
  | 'get_top_products'
  | 'get_alerts'

export interface ToolCall {
  name: AgentToolName
  input: Record<string, unknown>
}

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentResponse {
  say: string
  toolCalls: ToolCall[]
}

export interface SnapshotProduct {
  id: string
  name: string
  qty: number
  unit: string
  price: number
}

export interface BusinessSnapshot {
  currency: 'GHS'
  todaySales: number
  todayProfit: number
  cashInHand: number
  cashInBank: number
  products: SnapshotProduct[]
  lowStock: { name: string; qty: number }[]
  owedTotal: number
  owingTotal: number
}

export type ConfirmKind = 'sale' | 'credit_sale' | 'new_product' | 'add_stock'

export interface ConfirmLine {
  label: string
  value: string
}

export interface SaleItemResolved {
  productId: string
  productName: string
  unitPrice: number
  unitCost: number
  qty: number
}

export interface ConfirmPreview {
  kind: ConfirmKind
  title: string
  lines: ConfirmLine[]
  warnings: string[]
  sale?: { items: SaleItemResolved[]; payment: 'cash' | 'bank' }
  credit?: { items: SaleItemResolved[]; customerName: string; dueDate: string | null }
  newProduct?: {
    name: string
    costPrice: number
    sellPrice: number
    qty: number
    category: string
    payment: 'cash' | 'bank' | 'supplier_credit'
  }
  addStock?: { productId: string; productName: string; qty: number; unitCost: number }
}

export interface ReadResult {
  text: string
}

// Re-export for convenience in agent modules.
export type { Product, Debt, Sale }
