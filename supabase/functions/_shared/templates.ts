// Message templates shared by send-notification and daily-tasks.
// Each notification type yields an SMS/WhatsApp string and (where relevant) an email
// subject + HTML body. Keep SMS short — Arkesel bills per 160-char segment.

const cedi = (n: number) => `GHC ${Number(n || 0).toFixed(2)}`

interface ReceiptItem {
  name: string
  qty: number
  price: number
  total: number
}

export interface NotificationData {
  businessName?: string
  ownerName?: string
  customerName?: string
  personName?: string
  amount?: number
  dueDate?: string
  date?: string
  items?: ReceiptItem[]
  total?: number
  totalSales?: number
  totalProfit?: number
  salesCount?: number
  pendingDebts?: number
  lowStockCount?: number
  title?: string
  message?: string
}

function emailShell(businessName: string, inner: string): string {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #EBE6D8; color: #1A150D; padding: 24px;">
    <div style="text-align: center; border-bottom: 3px solid #1A150D; padding-bottom: 16px; margin-bottom: 24px;">
      <h1 style="font-size: 28px; margin: 0; text-transform: uppercase; letter-spacing: 2px;">${businessName}</h1>
      <p style="color: #8A857A; margin: 8px 0 0;">Powered by SerwaaBroni</p>
    </div>
    ${inner}
    <p style="color: #8A857A; font-size: 12px; text-align: center; margin-top: 24px;">Sent by ${businessName} via SerwaaBroni</p>
  </div>`
}

export function receiptSMS(d: NotificationData): string {
  return `${d.businessName ?? 'Your vendor'}: Thank you ${d.customerName ?? ''}! Receipt total ${cedi(d.total ?? 0)} on ${d.date ?? ''}. Akwaaba!`.trim()
}

export function receiptEmail(d: NotificationData): { subject: string; html: string } {
  const rows = (d.items ?? [])
    .map(
      (i) => `
      <tr style="border-bottom: 1px solid #EBE6D8;">
        <td style="padding: 8px;">${i.name}</td>
        <td style="padding: 8px; text-align: center;">${i.qty}</td>
        <td style="padding: 8px; text-align: right;">${cedi(i.price)}</td>
        <td style="padding: 8px; text-align: right;">${cedi(i.total)}</td>
      </tr>`,
    )
    .join('')
  const inner = `
    <p style="font-size: 16px;">Dear ${d.customerName ?? 'Customer'},</p>
    <p>Thank you for your purchase. Here is your receipt:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: white; border: 2px solid #1A150D;">
      <thead>
        <tr style="background: #1A150D; color: white;">
          <th style="padding: 8px; text-align: left;">Item</th>
          <th style="padding: 8px; text-align: center;">Qty</th>
          <th style="padding: 8px; text-align: right;">Price</th>
          <th style="padding: 8px; text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="text-align: right; font-size: 18px; font-weight: bold;">Total: ${cedi(d.total ?? 0)}</p>`
  return {
    subject: `Receipt from ${d.businessName ?? 'your vendor'} - ${cedi(d.total ?? 0)}`,
    html: emailShell(d.businessName ?? 'SerwaaBroni', inner),
  }
}

export function debtReminderSMS(d: NotificationData): string {
  const due = d.dueDate ? ` (due ${d.dueDate})` : ''
  return `Hello ${d.personName ?? ''}, a friendly reminder from ${d.businessName ?? 'your vendor'}: your balance of ${cedi(d.amount ?? 0)}${due} is outstanding. Please arrange payment. Medaase!`.trim()
}

export function debtReminderEmail(d: NotificationData): { subject: string; html: string } {
  const due = d.dueDate ? ` (due ${d.dueDate})` : ''
  const inner = `
    <p style="font-size: 16px;">Hello ${d.personName ?? 'there'},</p>
    <p>This is a friendly reminder that your balance of <strong>${cedi(d.amount ?? 0)}</strong>${due} is still outstanding.</p>
    <p>Please arrange payment at your earliest convenience. Thank you!</p>`
  return {
    subject: `Payment reminder from ${d.businessName ?? 'your vendor'}`,
    html: emailShell(d.businessName ?? 'SerwaaBroni', inner),
  }
}

export function dailySummarySMS(d: NotificationData): string {
  return `${d.businessName ?? 'Shop'} ${d.date ?? 'today'}: Sales ${cedi(d.totalSales ?? 0)}, Profit ${cedi(d.totalProfit ?? 0)} from ${d.salesCount ?? 0} sales. Owed to you ${cedi(d.pendingDebts ?? 0)}. Low stock items: ${d.lowStockCount ?? 0}.`
}

export function dailySummaryEmail(d: NotificationData): { subject: string; html: string } {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px;color:#8A857A;">${label}</td><td style="padding:8px;text-align:right;font-weight:bold;">${value}</td></tr>`
  const inner = `
    <p style="font-size: 16px;">Hello ${d.ownerName ?? 'there'},</p>
    <p>Here is your daily summary for ${d.date ?? 'today'}:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: white; border: 2px solid #1A150D;">
      ${row('Total Sales', cedi(d.totalSales ?? 0))}
      ${row('Total Profit', cedi(d.totalProfit ?? 0))}
      ${row('Number of Sales', String(d.salesCount ?? 0))}
      ${row('Owed to You', cedi(d.pendingDebts ?? 0))}
      ${row('Low Stock Items', String(d.lowStockCount ?? 0))}
    </table>`
  return {
    subject: `${d.businessName ?? 'Your shop'} — daily summary ${d.date ?? ''}`,
    html: emailShell(d.businessName ?? 'SerwaaBroni', inner),
  }
}

export function criticalSMS(d: NotificationData): string {
  return `SerwaaBroni Alert: ${d.title ?? ''}. ${d.message ?? ''}`.trim()
}

export function criticalEmail(d: NotificationData): { subject: string; html: string } {
  const inner = `
    <p style="font-size: 16px; font-weight: bold; color: #C0392B;">${d.title ?? 'Alert'}</p>
    <p>${d.message ?? ''}</p>`
  return {
    subject: `Alert: ${d.title ?? 'SerwaaBroni'}`,
    html: emailShell(d.businessName ?? 'SerwaaBroni', inner),
  }
}

export type NotificationType = 'receipt' | 'debt_reminder' | 'daily_summary' | 'critical'

export function buildSMS(type: NotificationType, d: NotificationData): string {
  switch (type) {
    case 'receipt': return receiptSMS(d)
    case 'debt_reminder': return debtReminderSMS(d)
    case 'daily_summary': return dailySummarySMS(d)
    case 'critical': return criticalSMS(d)
  }
}

export function buildEmail(type: NotificationType, d: NotificationData): { subject: string; html: string } {
  switch (type) {
    case 'receipt': return receiptEmail(d)
    case 'debt_reminder': return debtReminderEmail(d)
    case 'daily_summary': return dailySummaryEmail(d)
    case 'critical': return criticalEmail(d)
  }
}
