// Phase 1: English via the browser Web Speech API. Twi (Khaya) arrives in Phase 2.
function getRecognition(): SpeechRecognition | null {
  const Ctor =
    (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

export function speechSupported(): boolean {
  return getRecognition() !== null
}

export function listenOnce(opts?: { lang?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const rec = getRecognition()
    if (!rec) return reject(new Error('Voice input is not supported on this device.'))
    rec.lang = opts?.lang ?? 'en-GH'
    rec.interimResults = false
    rec.maxAlternatives = 1
    let finished = false
    rec.onresult = (e: SpeechRecognitionEvent) => {
      finished = true
      const transcript = e.results[0]?.[0]?.transcript ?? ''
      resolve(transcript.trim())
    }
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      finished = true
      reject(new Error(e.error || 'Could not hear you. Please try again.'))
    }
    rec.onend = () => {
      if (!finished) reject(new Error('I did not catch that. Please try again.'))
    }
    rec.start()
  })
}

export function speak(text: string, opts?: { lang?: string }): void {
  if (!('speechSynthesis' in window) || !text) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = opts?.lang ?? 'en-GH'
  u.rate = 1
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}
