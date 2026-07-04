import { uid } from '@/lib/data'
import { saleMovement } from '@/lib/cashPosting'
import type { ConfirmPreview, SaleItemResolved } from './types'

export interface StoreExecApi {
  addSaleBatch: (
    sales: Record<string, unknown>[],
    items: { productId: string; qty: number }[],
  ) => Promise<void>
  addDebt: (debt: Record<string, unknown>) => Promise<void>
  addProduct: (
    product: Record<string, unknown>,
    injectionId?: string | null,
    opts?: { account?: 'cash' | 'bank'; unpaid?: boolean },
  ) => Promise<void>
  updateProduct: (id: string, updates: Record<string, unknown>) => Promise<void>
  findProductQty: (id: string) => number
  postMovement: (mv: {
    account: 'cash' | 'bank'; direction: 'in' | 'out'; amount: number;
    category: string; ref_table: string; ref_id: string; note: string | null; created_at: string
  }) => Promise<void>
  receiveStock: (params: {
    productId: string; qty: number; unitCost: number
    account?: 'cash' | 'bank'; unpaid?: boolean
  }) => Promise<unknown>
}

function buildSaleRows(
  items: SaleItemResolved[],
  paymentMethod: 'cash' | 'bank' | 'credit',
  groupId: string,
  createdAt: string,
) {
  const sales = items.map((i) => ({
    id: uid(),
    product_id: i.productId,
    product_name: i.productName,
    quantity: i.qty,
    unit_price: i.unitPrice,
    total: i.unitPrice * i.qty,
    profit: (i.unitPrice - i.unitCost) * i.qty,
    customer_name: null as string | null,
    customer_phone: null,
    payment_method: paymentMethod,
    sale_group_id: groupId,
    sale_unit: null,
    sale_unit_qty: null,
    created_at: createdAt,
  }))
  const rowItems = items.map((i) => ({ productId: i.productId, qty: i.qty }))
  return { sales, rowItems }
}

export async function executePreview(preview: ConfirmPreview, api: StoreExecApi): Promise<void> {
  const createdAt = new Date().toISOString()
  const groupId = uid()

  if (preview.kind === 'sale' && preview.sale) {
    const method = preview.sale.payment === 'bank' ? 'bank' : 'cash'
    const { sales, rowItems } = buildSaleRows(preview.sale.items, method, groupId, createdAt)
    await api.addSaleBatch(sales, rowItems)
    const total = preview.sale.items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
    const mv = saleMovement(method, total, 0)
    if (mv) {
      await api.postMovement({
        account: mv.account, direction: 'in', amount: mv.amount,
        category: 'sale', ref_table: 'sales', ref_id: groupId, note: null, created_at: createdAt,
      })
    }
    return
  }

  if (preview.kind === 'credit_sale' && preview.credit) {
    const { sales, rowItems } = buildSaleRows(preview.credit.items, 'credit', groupId, createdAt)
    // Credit sales carry the customer name on each row.
    sales.forEach((s) => { s.customer_name = preview.credit!.customerName })
    await api.addSaleBatch(sales, rowItems)
    const total = preview.credit.items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
    const itemCount = preview.credit.items.reduce((s, i) => s + i.qty, 0)
    await api.addDebt({
      id: uid(),
      person_name: preview.credit.customerName,
      phone: null,
      amount: total,
      amount_paid: 0,
      payments: [],
      description: `${itemCount} ${itemCount === 1 ? 'item' : 'items'} on credit`,
      type: 'owed',
      due_date: preview.credit.dueDate,
      injection_id: null,
      sale_group_id: groupId,
      is_paid: false,
      paid_at: null,
      created_at: createdAt,
    })
    return
  }

  if (preview.kind === 'new_product' && preview.newProduct) {
    const np = preview.newProduct
    const product = {
      id: uid(),
      name: np.name,
      cost_price: np.costPrice,
      selling_price: np.sellPrice,
      quantity: np.qty,
      unit: 'piece',
      units_per_pack: 1,
      category: np.category,
      low_stock_threshold: 5,
      created_at: createdAt,
    }
    const account = np.payment === 'bank' ? 'bank' : 'cash'
    const unpaid = np.payment === 'supplier_credit'
    await api.addProduct(product, null, { account, unpaid })
    return
  }

  if (preview.kind === 'add_stock' && preview.addStock) {
    const current = api.findProductQty(preview.addStock.productId)
    await api.updateProduct(preview.addStock.productId, { quantity: current + preview.addStock.qty })
    try {
      await api.receiveStock({
        productId: preview.addStock.productId,
        qty: preview.addStock.qty,
        unitCost: preview.addStock.unitCost,
        account: 'cash',
        unpaid: false,
      })
    } catch {
      /* offline or error — quantity already bumped; batch can reconcile later */
    }
    return
  }
}
