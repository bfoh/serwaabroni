// Records a short mic clip and returns base64 audio, auto-stopping on silence.
// Used for Twi input (browser Web Speech only transcribes English).
let activeStop: (() => void) | null = null

export function audioSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}

export function stopRecording(): void {
  try {
    activeStop?.()
  } catch {
    /* ignore */
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('Could not read audio.'))
    reader.readAsDataURL(blob)
  })
}

export async function recordAudio(opts?: { maxMs?: number; silenceMs?: number }): Promise<{ base64: string; mimeType: string }> {
  if (!audioSupported()) throw new Error('Voice recording is not supported on this device.')
  const maxMs = opts?.maxMs ?? 15000
  const silenceMs = opts?.silenceMs ?? 1500

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

  // Silence detection via Web Audio.
  const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  const src = ac.createMediaStreamSource(stream)
  const analyser = ac.createAnalyser()
  analyser.fftSize = 512
  src.connect(analyser)
  const buf = new Uint8Array(analyser.fftSize)

  let spoke = false
  let lastLoud = Date.now()
  const started = Date.now()

  return await new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
    let done = false
    const cleanup = () => {
      try { ac.close() } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop())
      activeStop = null
    }
    const finish = async () => {
      if (done) return
      done = true
      clearInterval(timer)
      rec.onstop = async () => {
        cleanup()
        try {
          resolve({ base64: await blobToBase64(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })), mimeType: rec.mimeType || 'audio/webm' })
        } catch (e) {
          reject(e instanceof Error ? e : new Error('audio error'))
        }
      }
      try { rec.stop() } catch { cleanup(); resolve({ base64: '', mimeType: 'audio/webm' }) }
    }
    activeStop = finish

    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128))
      if (peak > 12) { spoke = true; lastLoud = Date.now() }
      const now = Date.now()
      if (now - started >= maxMs) return void finish()
      if (spoke && now - lastLoud >= silenceMs) return void finish()
    }, 150)

    rec.start()
  })
}
