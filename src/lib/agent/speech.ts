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

// The recognition currently running, so a continuous conversation can abort it
// when the user stops the session.
let activeRec: SpeechRecognition | null = null

export function listenOnce(opts?: { lang?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const rec = getRecognition()
    if (!rec) return reject(new Error('Voice input is not supported on this device.'))
    rec.lang = opts?.lang ?? 'en-GH'
    rec.interimResults = false
    rec.maxAlternatives = 1
    activeRec = rec
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
      if (activeRec === rec) activeRec = null
      if (!finished) reject(new Error('I did not catch that. Please try again.'))
    }
    rec.start()
  })
}

// Abort any in-flight recognition (used to stop a continuous conversation).
export function stopListening(): void {
  try {
    activeRec?.abort()
  } catch {
    /* ignore */
  }
  activeRec = null
}

// Stop any in-progress speech immediately.
export function stopSpeaking(): void {
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* ignore */
    }
  }
}

// Mobile browsers block speech synthesis until it is triggered inside a user
// gesture. Call this from a click handler (opening the sheet, tapping the mic)
// to "unlock" the engine so later async replies can actually be heard.
export function primeSpeech(): void {
  if (!('speechSynthesis' in window)) return
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    window.speechSynthesis.resume()
    window.speechSynthesis.speak(u)
  } catch {
    /* ignore — best-effort unlock */
  }
}

// Turn written amounts into words the voice reads naturally. The Ghana Cedi is
// written as GH₵/GHS/GHC (which TTS spells out "G-H-S") but should be spoken as
// "Ghana Cedis", AFTER the number ("thirty Ghana Cedis"). Chat text keeps the
// symbol; only the spoken copy is rewritten.
export function toSpeakable(text: string): string {
  const num = (s: string) => s.replace(/,/g, '').replace(/\.00$/, '')
  return (
    text
      // symbol before the number: "GH₵ 30", "GHS30", "₵12.50"
      .replace(/(?:GH₵|GHS|GHC|₵)\s?(\d[\d,]*(?:\.\d+)?)/gi, (_m, n: string) => `${num(n)} Ghana Cedis`)
      // number before the symbol: "30 GHS", "12.50₵"
      .replace(/(\d[\d,]*(?:\.\d+)?)\s?(?:GH₵|GHS|GHC|₵)/gi, (_m, n: string) => `${num(n)} Ghana Cedis`)
      // any bare leftover currency token
      .replace(/GH₵|₵/g, 'Ghana Cedis')
      .replace(/\b(?:GHS|GHC)\b/gi, 'Ghana Cedis')
  )
}

// Speaks the text and resolves when speech finishes (or immediately if TTS is
// unavailable). Awaiting this lets a continuous conversation wait for the reply
// to finish before it listens again, so the mic never captures the agent's voice.
export function speak(text: string, opts?: { lang?: string }): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text) return resolve()
    const synth = window.speechSynthesis
    const u = new SpeechSynthesisUtterance(toSpeakable(text))
    // Don't force a locale that has no installed voice (e.g. 'en-GH' is usually
    // absent → silent). Prefer the requested locale, then any English voice, then
    // the device default.
    const want = opts?.lang ?? 'en-GH'
    const voices = synth.getVoices()
    const voice =
      voices.find((v) => v.lang === want) ??
      voices.find((v) => v.lang?.toLowerCase().startsWith('en')) ??
      voices[0]
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? 'en-US'
    u.rate = 1
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    u.onend = finish
    u.onerror = finish
    try {
      synth.cancel()
      synth.resume()
      synth.speak(u)
    } catch {
      finish()
    }
    // Safety net: never hang the conversation loop if onend never fires.
    setTimeout(finish, Math.min(15000, 2000 + text.length * 90))
  })
}
