// ============================================
// VOICE INPUT SERVICE
// Uses Web Speech API for speech recognition
// ============================================

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent {
  error: string
}

interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

// Get SpeechRecognition constructor (cross-browser)
function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  const w = window as unknown as Record<string, unknown>
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition
  return (SR as new () => SpeechRecognitionInstance) || null
}

export function isVoiceSupported(): boolean {
  return !!getSpeechRecognition()
}

export class VoiceInput {
  private recognition: SpeechRecognitionInstance | null = null
  private onResultCallback: ((text: string) => void) | null = null
  private onEndCallback: (() => void) | null = null
  private isListening = false

  constructor(language = 'en-GH') {
    const SR = getSpeechRecognition()
    if (!SR) return

    const recognition = new SR()
    recognition.lang = language
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const results = event.results
      if (results.length > 0) {
        const lastResult = results[results.length - 1]
        const transcript = lastResult[0]?.transcript || ''
        if (lastResult.isFinal && this.onResultCallback) {
          this.onResultCallback(transcript.trim())
        }
      }
    }

    recognition.onerror = () => {
      this.isListening = false
      this.onEndCallback?.()
    }

    recognition.onend = () => {
      this.isListening = false
      this.onEndCallback?.()
    }

    this.recognition = recognition
  }

  start(onResult: (text: string) => void, onEnd?: () => void): boolean {
    if (!this.recognition || this.isListening) return false

    this.onResultCallback = onResult
    this.onEndCallback = onEnd || null
    this.isListening = true

    try {
      this.recognition.start()
      return true
    } catch {
      this.isListening = false
      return false
    }
  }

  stop(): void {
    if (!this.recognition || !this.isListening) return
    this.recognition.stop()
    this.isListening = false
  }

  abort(): void {
    if (!this.recognition) return
    this.recognition.abort()
    this.isListening = false
  }

  getListening(): boolean {
    return this.isListening
  }
}

// Helper for text-to-speech feedback
export function speak(text: string, lang = 'en-GH'): void {
  if (!('speechSynthesis' in window)) return

  // Cancel any ongoing speech
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 0.9 // Slightly slower for clarity
  utterance.pitch = 1.0

  window.speechSynthesis.speak(utterance)
}

// Parse voice command for product search
export function parseProductCommand(text: string): {
  productName?: string
  quantity?: number
  action: 'search' | 'add_sale' | 'unknown'
} {
  const lower = text.toLowerCase().trim()

  // Common patterns
  const quantityMatch = lower.match(/(\d+)/)
  const quantity = quantityMatch ? parseInt(quantityMatch[1]) : undefined

  // Check for sale-related keywords
  if (lower.includes('sell') || lower.includes('sale') || lower.includes('tonton')) {
    const productName = lower
      .replace(/\d+/g, '')
      .replace(/(sell|sale|tonton|of)/g, '')
      .trim()
    return { productName: productName || undefined, quantity, action: 'add_sale' }
  }

  // Check for search
  if (lower.includes('find') || lower.includes('where') || lower.includes('search') || lower.includes('hwehwɛ')) {
    const productName = lower
      .replace(/(find|where|search|hwehwɛ)/g, '')
      .trim()
    return { productName: productName || undefined, action: 'search' }
  }

  // Default: treat as search
  return { productName: lower || undefined, quantity, action: 'search' }
}
