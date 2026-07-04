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
// written before the number (GH₵ 30) but spoken AFTER it ("thirty Ghana Cedis").
// Chat text keeps the symbol; only the spoken copy is rewritten.
export function toSpeakable(text: string): string {
  return text.replace(
    /(?:GH₵|GHS|GHC|₵)\s?([\d,]+(?:\.\d+)?)/gi,
    (_match, num: string) => {
      const clean = num.replace(/,/g, '').replace(/\.00$/, '')
      return `${clean} Ghana Cedis`
    },
  )
}

export function speak(text: string, opts?: { lang?: string }): void {
  if (!('speechSynthesis' in window) || !text) return
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
  try {
    synth.cancel()
    synth.resume()
    synth.speak(u)
  } catch {
    /* ignore — TTS unavailable */
  }
}
