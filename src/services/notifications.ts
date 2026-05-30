// ============================================
// BREVO EMAIL SERVICE
// ============================================

const BREVO_API_KEY = import.meta.env.VITE_BREVO_API_KEY || ''
const SENDER_EMAIL = 'noreply@serwaabroni.com'
const SENDER_NAME = 'SerwaaBroni'

interface EmailPayload {
  to: string
  toName?: string
  subject: string
  htmlContent: string
}

export async function sendEmail({ to, toName, subject, htmlContent }: EmailPayload): Promise<boolean> {
  if (!BREVO_API_KEY || BREVO_API_KEY === 'your-brevo-api-key') {
    console.warn('Brevo API key not configured')
    return false
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: to, name: toName || to }],
        subject,
        htmlContent,
      }),
    })

    return response.ok
  } catch (error) {
    console.error('Brevo email error:', error)
    return false
  }
}

// Email templates
export function generateInvoiceEmail(params: {
  customerName: string
  businessName: string
  items: Array<{ name: string; qty: number; price: number; total: number }>
  total: number
  date: string
}): { subject: string; html: string } {
  const itemsHtml = params.items
    .map(
      (item) => `
    <tr style="border-bottom: 1px solid #EBE6D8;">
      <td style="padding: 8px;">${item.name}</td>
      <td style="padding: 8px; text-align: center;">${item.qty}</td>
      <td style="padding: 8px; text-align: right;">GHC ${item.price.toFixed(2)}</td>
      <td style="padding: 8px; text-align: right;">GHC ${item.total.toFixed(2)}</td>
    </tr>
  `
    )
    .join('')

  const subject = `Invoice from ${params.businessName} - GHC ${params.total.toFixed(2)}`

  const html = `
    <div style="font-family: 'Oswald', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #EBE6D8; color: #1A150D; padding: 24px;">
      <div style="text-align: center; border-bottom: 3px solid #1A150D; padding-bottom: 16px; margin-bottom: 24px;">
        <h1 style="font-size: 28px; margin: 0; text-transform: uppercase; letter-spacing: 2px;">${params.businessName}</h1>
        <p style="color: #8A857A; margin: 8px 0 0;">Powered by SerwaaBroni</p>
      </div>
      
      <p style="font-size: 16px;">Dear ${params.customerName},</p>
      <p>Thank you for your purchase. Here is your invoice:</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: white; border: 2px solid #1A150D;">
        <thead>
          <tr style="background: #1A150D; color: white;">
            <th style="padding: 10px; text-align: left;">Item</th>
            <th style="padding: 10px; text-align: center;">Qty</th>
            <th style="padding: 10px; text-align: right;">Price</th>
            <th style="padding: 10px; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tfoot>
          <tr style="background: #1A150D; color: white; font-size: 18px;">
            <td colspan="3" style="padding: 12px; text-align: right; font-weight: bold;">TOTAL:</td>
            <td style="padding: 12px; text-align: right; font-weight: bold;">GHC ${params.total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
      
      <p style="color: #8A857A; font-size: 12px; text-align: center; margin-top: 24px;">
        Invoice Date: ${params.date}<br/>
        Thank you for doing business with us!
      </p>
    </div>
  `

  return { subject, html }
}

export function generateDailyReportEmail(params: {
  businessName: string
  ownerName: string
  date: string
  totalSales: number
  totalProfit: number
  totalExpenses: number
  transactionCount: number
  topProduct: string
}): { subject: string; html: string } {
  const subject = `Daily Report - ${params.businessName} - ${params.date}`

  const html = `
    <div style="font-family: 'Oswald', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #EBE6D8; color: #1A150D; padding: 24px;">
      <div style="text-align: center; border-bottom: 3px solid #1A150D; padding-bottom: 16px; margin-bottom: 24px;">
        <h1 style="font-size: 24px; margin: 0; text-transform: uppercase;">Daily Business Report</h1>
        <p style="color: #8A857A; margin: 8px 0 0;">${params.date}</p>
      </div>
      
      <p style="font-size: 16px;">Hello ${params.ownerName},</p>
      <p>Here is your daily business summary:</p>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0;">
        <div style="background: white; border: 2px solid #1A150D; padding: 16px; text-align: center;">
          <p style="color: #8A857A; font-size: 12px; text-transform: uppercase; margin: 0;">Total Sales</p>
          <p style="font-size: 24px; font-weight: bold; color: #4E8C4B; margin: 8px 0 0;">GHC ${params.totalSales.toFixed(2)}</p>
        </div>
        <div style="background: white; border: 2px solid #1A150D; padding: 16px; text-align: center;">
          <p style="color: #8A857A; font-size: 12px; text-transform: uppercase; margin: 0;">Profit</p>
          <p style="font-size: 24px; font-weight: bold; color: #4E8C4B; margin: 8px 0 0;">GHC ${params.totalProfit.toFixed(2)}</p>
        </div>
        <div style="background: white; border: 2px solid #1A150D; padding: 16px; text-align: center;">
          <p style="color: #8A857A; font-size: 12px; text-transform: uppercase; margin: 0;">Expenses</p>
          <p style="font-size: 24px; font-weight: bold; color: #E64632; margin: 8px 0 0;">GHC ${params.totalExpenses.toFixed(2)}</p>
        </div>
        <div style="background: white; border: 2px solid #1A150D; padding: 16px; text-align: center;">
          <p style="color: #8A857A; font-size: 12px; text-transform: uppercase; margin: 0;">Transactions</p>
          <p style="font-size: 24px; font-weight: bold; margin: 8px 0 0;">${params.transactionCount}</p>
        </div>
      </div>
      
      <div style="background: white; border: 2px solid #1A150D; padding: 16px; margin: 16px 0;">
        <p style="color: #8A857A; font-size: 12px; text-transform: uppercase; margin: 0 0 8px;">Top Selling Product</p>
        <p style="font-size: 18px; font-weight: bold; margin: 0;">${params.topProduct}</p>
      </div>
      
      <p style="color: #8A857A; font-size: 12px; text-align: center; margin-top: 24px;">
        Keep up the great work!<br/>
        <strong>SerwaaBroni</strong> - Your Business Partner
      </p>
    </div>
  `

  return { subject, html }
}

// ============================================
// ARKESEL SMS SERVICE
// ============================================

const ARKESEL_API_KEY = import.meta.env.VITE_ARKESEL_API_KEY || ''

function formatGhanaPhone(phone: string): string {
  // Convert 0244... to 233244...
  const cleaned = phone.replace(/\s/g, '').replace(/^0/, '233')
  return cleaned
}

export async function sendSMS(to: string, message: string): Promise<boolean> {
  if (!ARKESEL_API_KEY || ARKESEL_API_KEY === 'your-arkesel-api-key') {
    console.warn('Arkesel API key not configured')
    return false
  }

  try {
    const response = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: {
        'api-key': ARKESEL_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: 'SerwaaB',
        message,
        recipients: [formatGhanaPhone(to)],
      }),
    })

    return response.ok
  } catch (error) {
    console.error('Arkesel SMS error:', error)
    return false
  }
}

// SMS Templates
export function generateSaleConfirmationSMS(params: {
  customerName: string
  businessName: string
  productName: string
  quantity: number
  total: number
  paymentMethod: string
}): string {
  return `Hello ${params.customerName}, you bought ${params.quantity}x ${params.productName} from ${params.businessName} for GHC ${params.total.toFixed(2)}. Paid via ${params.paymentMethod.toUpperCase()}. Thank you! - SerwaaBroni`
}

export function generateDebtReminderSMS(params: {
  personName: string
  amount: number
  businessName: string
  dueDate?: string
}): string {
  const dueText = params.dueDate ? ` Due: ${params.dueDate}.` : ''
  return `Hello ${params.personName}, you owe ${params.businessName} GHC ${params.amount.toFixed(2)}.${dueText} Please make payment soon. Thank you! - ${params.businessName} via SerwaaBroni`
}

export function generateDailySummarySMS(params: {
  ownerName: string
  totalSales: number
  transactionCount: number
  profit: number
}): string {
  return `Hi ${params.ownerName}! Today's summary: Sales: GHC ${params.totalSales.toFixed(2)} (${params.transactionCount} sales), Profit: GHC ${params.profit.toFixed(2)}. Keep going! - SerwaaBroni`
}

export function generateLowStockSMS(params: {
  ownerName: string
  productName: string
  quantity: number
}): string {
  return `Hi ${params.ownerName}! ${params.productName} is running low. Only ${params.quantity} left in stock. Please restock soon. - SerwaaBroni`
}
