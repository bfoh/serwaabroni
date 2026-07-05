// Records a short mic clip as 16-bit PCM WAV and returns base64, auto-stopping
// on silence. WAV is the most widely accepted format for speech recognition
// (Khaya ASR rejects webm/opus). Used for Twi input.
let activeStop: (() => void) | null = null

export function audioSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined'
}

export function stopRecording(): void {
  try {
    activeStop?.()
  } catch {
    /* ignore */
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([view], { type: 'audio/wav' })
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
  const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  const src = ac.createMediaStreamSource(stream)
  const processor = ac.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let spoke = false
  let lastLoud = Date.now()
  const started = Date.now()

  return await new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
    let done = false
    const cleanup = () => {
      try { processor.disconnect() } catch { /* ignore */ }
      try { src.disconnect() } catch { /* ignore */ }
      try { ac.close() } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop())
      activeStop = null
    }
    const finish = async () => {
      if (done) return
      done = true
      cleanup()
      try {
        const total = chunks.reduce((n, c) => n + c.length, 0)
        const merged = new Float32Array(total)
        let o = 0
        for (const c of chunks) { merged.set(c, o); o += c.length }
        const base64 = total > 0 ? await blobToBase64(encodeWav(merged, ac.sampleRate)) : ''
        resolve({ base64, mimeType: 'audio/wav' })
      } catch (e) {
        reject(e instanceof Error ? e : new Error('audio error'))
      }
    }
    activeStop = finish

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0)
      chunks.push(new Float32Array(input))
      let rms = 0
      for (let i = 0; i < input.length; i++) rms += input[i] * input[i]
      rms = Math.sqrt(rms / input.length)
      const now = Date.now()
      if (rms > 0.02) { spoke = true; lastLoud = now }
      if (now - started >= maxMs) return void finish()
      if (spoke && now - lastLoud >= silenceMs) return void finish()
    }

    src.connect(processor)
    processor.connect(ac.destination)
  })
}
