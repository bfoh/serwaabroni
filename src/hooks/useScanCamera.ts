import { useEffect, useRef, useState } from 'react'
import {
  NATIVE_FORMATS,
  getBarcodeDetectorCtor,
  loadZbar,
  type NativeBarcodeDetector,
} from '@/lib/scanner'

interface UseScanCameraOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  active: boolean
  paused?: boolean
  onResult: (code: string) => void
}
interface UseScanCameraResult {
  stream: MediaStream | null
  error: string | null
}

// Owns the rear-camera stream and the per-frame decode loop (native
// BarcodeDetector, else ZBar WASM). Starts when `active` is true, holds decoding
// while `paused`, and tears everything down when `active` goes false / unmounts.
export function useScanCamera({ videoRef, active, paused, onResult }: UseScanCameraOptions): UseScanCameraResult {
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<NativeBarcodeDetector | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const decodeModeRef = useRef<'native' | 'zbar'>('zbar')
  const rafRef = useRef<number | null>(null)
  const pausedRef = useRef(false)
  const onResultRef = useRef(onResult)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { onResultRef.current = onResult }, [onResult])
  useEffect(() => { pausedRef.current = !!paused }, [paused])

  useEffect(() => {
    if (!active) return
    let cancelled = false

    const decodeFromVideo = async (): Promise<string | null> => {
      const video = videoRef.current
      if (!video || video.readyState < 2) return null
      if (decodeModeRef.current === 'native' && detectorRef.current) {
        const codes = await detectorRef.current.detect(video)
        return (codes && codes.length > 0 && codes[0].rawValue) || null
      }
      const vw = video.videoWidth, vh = video.videoHeight
      if (!vw || !vh) return null
      const scale = Math.min(1, 1280 / Math.max(vw, vh))
      const w = Math.round(vw * scale), h = Math.round(vh * scale)
      let canvas = canvasRef.current
      if (!canvas) { canvas = document.createElement('canvas'); canvasRef.current = canvas }
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      ctx.drawImage(video, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      const zbar = await loadZbar()
      const symbols = await zbar.scanImageData(imageData)
      if (symbols && symbols.length > 0) return symbols[0].decode() || null
      return null
    }

    const loop = () => {
      const tick = async () => {
        if (cancelled || !streamRef.current) return
        if (!pausedRef.current) {
          try {
            const code = await decodeFromVideo()
            if (code) onResultRef.current(code)
          } catch { /* transient decode error — keep scanning */ }
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    const start = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            advanced: [{ focusMode: 'continuous' }],
          } as unknown as MediaTrackConstraints,
          audio: false,
        })
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = s
        setStream(s)
        const video = videoRef.current
        if (video) {
          video.srcObject = s
          video.setAttribute('playsinline', 'true')
          video.muted = true
          await video.play().catch(() => {})
        }
        try {
          await s.getVideoTracks()[0].applyConstraints({
            advanced: [{ focusMode: 'continuous' }],
          } as unknown as MediaTrackConstraints)
        } catch { /* device has no focus control */ }

        const Ctor = getBarcodeDetectorCtor()
        if (Ctor) {
          try {
            let formats = NATIVE_FORMATS
            if (Ctor.getSupportedFormats) {
              const supported = await Ctor.getSupportedFormats()
              const filtered = NATIVE_FORMATS.filter((f) => supported.includes(f))
              if (filtered.length) formats = filtered
            }
            detectorRef.current = new Ctor({ formats })
            decodeModeRef.current = 'native'
          } catch {
            detectorRef.current = null
            decodeModeRef.current = 'zbar'
          }
        } else {
          decodeModeRef.current = 'zbar'
        }
        if (decodeModeRef.current === 'zbar') {
          const zbar = await loadZbar()
          zbar.getInstance().catch(() => {})
        }
        loop()
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Camera error')
      }
    }

    start()

    return () => {
      cancelled = true
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      detectorRef.current = null
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => { try { t.stop() } catch { /* ignore */ } })
        streamRef.current = null
      }
      if (videoRef.current) { try { videoRef.current.srcObject = null } catch { /* ignore */ } }
      setStream(null)
    }
  }, [active, videoRef])

  return { stream, error }
}
