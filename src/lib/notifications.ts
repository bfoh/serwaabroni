import type { Alert } from './alerts'
import type { Customer } from './supabase'

/**
 * Handles external notifications via Arkesel (SMS) and WhatsApp.
 * NOTE: This is a stub for demonstration purposes until production API keys are provided.
 */

/**
 * Send an SMS via Arkesel API
 * Documentation: https://arkesel.com/api/v2/sms
 */
async function sendArkeselSMS(phone: string, message: string): Promise<boolean> {
  console.log(`[STUB] Sending SMS to ${phone} via Arkesel...`)
  console.log(`[STUB] Message: "${message}"`)
  
  // Example implementation (commented out until API key is available):
  /*
  try {
    const response = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: {
        'api-key': process.env.VITE_ARKESEL_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: 'Serwaa', // Registered sender ID
        message,
        recipients: [phone],
      }),
    })
    return response.ok
  } catch (error) {
    console.error('Failed to send Arkesel SMS:', error)
    return false
  }
  */
  return true // Assume success for stub
}

/**
 * Send a WhatsApp Message via Twilio/Arkesel WhatsApp API
 */
async function sendWhatsAppMessage(phone: string, message: string): Promise<boolean> {
  console.log(`[STUB] Sending WhatsApp message to ${phone}...`)
  console.log(`[STUB] Message: "${message}"`)
  return true
}

/**
 * Evaluates alerts and dispatches critical ones to the business owner
 * @param alerts The list of generated alerts
 * @param ownerPhone The business owner's phone number
 */
export async function dispatchCriticalAlerts(alerts: Alert[], ownerPhone: string) {
  if (!ownerPhone) return

  const criticalAlerts = alerts.filter(a => a.isCritical)

  // In a real app, we should check a database table (e.g. `dispatched_alerts`)
  // to ensure we don't send the same SMS multiple times a day.
  for (const alert of criticalAlerts) {
    const message = `🚨 SerwaaBroni Alert: ${alert.title}. ${alert.message}`
    
    // As per user request: "if it's critical, send sms and whatsapp message"
    await Promise.allSettled([
      sendArkeselSMS(ownerPhone, message),
      sendWhatsAppMessage(ownerPhone, message)
    ])
  }
}

/**
 * Sends a polite debt collection reminder to a customer
 * @param customer The customer owing money
 * @param amount The amount owed
 */
export async function sendDebtReminder(customer: Customer, amount: number, dueDate: string) {
  if (!customer.phone) return false

  const message = `Hello ${customer.name}, this is a polite reminder from your vendor that your payment of GH₵${amount} was due on ${dueDate}. Please arrange payment as soon as possible. Thank you!`
  
  // Prefer WhatsApp for customers if possible, fallback to SMS
  await Promise.allSettled([
    sendWhatsAppMessage(customer.phone, message),
    sendArkeselSMS(customer.phone, message)
  ])

  return true
}
