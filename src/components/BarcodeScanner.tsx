import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Flashlight, FlashlightOff, Package, Plus, Minus, Camera,
  Mic, ChevronDown, ChevronUp, Trash2, Check, Barcode as BarcodeIcon,
  QrCode, Keyboard, Upload, AlertTriangle
} from 'lucide-react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { scanImageData, getInstance } from '@undecaf/zbar-wasm'
import { useStore } from '@/lib/store'
import type { Product } from '@/lib/supabase'
import { uid, formatCurrency } from '@/lib/data'

// ============================================================
// TYPES
// ============================================================
interface ScannedItem {
  id: string
  barcode: string | null
  name: string
  cost_price: number
  selling_price: number
  quantity: number
  unit: string
  category: string
  low_stock_threshold: number
  source: 'qr' | 'barcode-local' | 'barcode-api' | 'manual'
}

interface BarcodeScannerProps {
  isOpen: boolean
  onClose: () => void
}

type ScanMode = 'camera' | 'keyboard' | 'upload' | 'manual'

// ============================================================
// OPEN FOOD FACTS API
// ============================================================
type ProductInfo = { name: string; category: string }

// Open Food Facts — strong for packaged food/drinks worldwide.
async function lookupOpenFoodFacts(barcode: string): Promise<ProductInfo | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    if (data.status === 1 && data.product) {
      const p = data.product
      const name = p.product_name_en || p.product_name || p.generic_name
      if (name) {
        return {
          name,
          category: p.categories?.split(',')[0]?.trim() || 'Groceries',
        }
      }
    }
  } catch {
    // ignore
  }
  return null
}

// UPCitemdb (free trial) — general retail products, not just food.
async function lookupUPCItemDB(barcode: string): Promise<ProductInfo | null> {
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`, { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    const item = data?.items?.[0]
    if (item?.title) {
      return {
        name: item.title,
        category: item.category?.split('>').pop()?.trim() || 'Groceries',
      }
    }
  } catch {
    // ignore (CORS / rate limit / offline) — caller falls back to manual entry
  }
  return null
}

// Try every product database in turn; first hit wins.
async function lookupProduct(barcode: string): Promise<ProductInfo | null> {
  return (await lookupOpenFoodFacts(barcode)) || (await lookupUPCItemDB(barcode))
}

// ============================================================
// SUPPORTED CODE FORMATS — all common retail 1D + 2D codes.
// Limiting the set lets the decoder focus and lock faster.
// ============================================================
const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.AZTEC,
]

// Native BarcodeDetector format strings (used when the browser supports it).
const NATIVE_FORMATS = [
  'qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128',
  'code_39', 'code_93', 'codabar', 'itf', 'data_matrix', 'aztec', 'pdf417',
]

// Minimal typing for the native BarcodeDetector API (not in TS DOM lib yet).
interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): NativeBarcodeDetector
  getSupportedFormats?(): Promise<string[]>
}
function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor || null
}

// ============================================================
// COMPONENT
// ============================================================
export default function BarcodeScanner({ isOpen, onClose }: BarcodeScannerProps) {
  const { state, showToast, addProduct, updateProduct } = useStore()
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Native BarcodeDetector pipeline (preferred — instant, no library overhead)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<NativeBarcodeDetector | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // 'native' = BarcodeDetector (Android); 'zbar' = ZBar WASM (iOS Safari etc.)
  const decodeModeRef = useRef<'native' | 'zbar'>('zbar')
  const rafRef = useRef<number | null>(null)
  const engineRef = useRef<'native' | 'fallback' | null>(null)
  const isPausedRef = useRef(false)

  // Scanner state
  const isProcessingRef = useRef(false)
  // Holds latest scan handler so the running camera always calls fresh logic
  // (avoids stale product list / processing closure captured at start time).
  const onScanSuccessRef = useRef<(text: string) => void>(() => {})
  const [isScanning, setIsScanning] = useState(false)
  // Which camera engine is live — drives which preview element is visible.
  const [engine, setEngine] = useState<'native' | 'fallback' | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraBlocked, setCameraBlocked] = useState(false)

  // Active scan mode
  const [scanMode, setScanMode] = useState<ScanMode>('camera')

  // Keyboard input
  const [typedBarcode, setTypedBarcode] = useState('')
  const [isProcessingBarcode, setIsProcessingBarcode] = useState(false)

  // Upload processing
  const [isProcessingUpload, setIsProcessingUpload] = useState(false)

  // Delivery basket
  const [basket, setBasket] = useState<ScannedItem[]>([])
  const [showBasket, setShowBasket] = useState(false)

  // Current scan being processed
  const [currentItem, setCurrentItem] = useState<ScannedItem | null>(null)
  const [showItemSheet, setShowItemSheet] = useState(false)

  // Manual entry fallback
  const [manualName, setManualName] = useState('')
  const [manualCost, setManualCost] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [manualQty, setManualQty] = useState(1)
  const [isListening, setIsListening] = useState(false)

  // ==========================================================
  // PAUSE / RESUME (engine-aware)
  // ==========================================================
  const pauseScanning = useCallback(() => {
    isPausedRef.current = true
    if (engineRef.current === 'fallback') {
      try { if (scannerRef.current?.getState() === 2) scannerRef.current.pause(true) } catch { /* ignore */ }
    }
    // Native loop simply skips detection while isPausedRef is true.
  }, [])

  const resumeScanning = useCallback(() => {
    isPausedRef.current = false
    isProcessingRef.current = false
    if (engineRef.current === 'fallback') {
      try { if (scannerRef.current?.getState() === 3) scannerRef.current.resume() } catch { /* ignore */ }
    }
  }, [])

  // ==========================================================
  // NATIVE BarcodeDetector LOOP — decodes every animation frame.
  // Fires the instant a code resolves, i.e. as soon as it's in focus.
  // ==========================================================
  // Decode one frame. BarcodeDetector when available (Android); otherwise draw
  // the frame to a canvas and run it through ZBar WASM (works great on iOS).
  const decodeFromVideo = useCallback(async (): Promise<string | null> => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return null

    if (decodeModeRef.current === 'native' && detectorRef.current) {
      const codes = await detectorRef.current.detect(video)
      return (codes && codes.length > 0 && codes[0].rawValue) || null
    }

    // ZBar path
    const vw = video.videoWidth, vh = video.videoHeight
    if (!vw || !vh) return null
    // Downscale large frames — ZBar is fast and a ~1280px longest side keeps
    // the loop smooth on phones while staying sharp enough to read bars.
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
    const symbols = await scanImageData(imageData)
    if (symbols && symbols.length > 0) {
      const text = symbols[0].decode()
      return text || null
    }
    return null
  }, [])

  // ==========================================================
  // DECODE LOOP — runs every animation frame, fires the instant a code reads.
  // ==========================================================
  const runDetectLoop = useCallback(() => {
    const tick = async () => {
      if (!streamRef.current) return // scanner stopped
      if (!isProcessingRef.current && !isPausedRef.current) {
        try {
          const code = await decodeFromVideo()
          if (code) onScanSuccessRef.current(code)
        } catch { /* transient decode error — keep scanning */ }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [decodeFromVideo])

  // ==========================================================
  // START / STOP CAMERA SCANNER
  // ==========================================================
  const isPermissionError = (msg: string) =>
    msg.includes('permission') || msg.includes('Permissions policy') ||
    msg.includes('not allowed') || msg.includes('Permission denied') ||
    msg.includes('NotAllowed')

  const startCameraScanner = useCallback(async () => {
    // Warm up the ZBar WASM in parallel with the camera so the first decode is
    // instant rather than paying the ~240KB instantiation cost on first scan.
    getInstance().catch(() => { /* loads lazily on first decode otherwise */ })

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        advanced: [{ focusMode: 'continuous' }],
      } as unknown as MediaTrackConstraints,
      audio: false,
    })
    streamRef.current = stream
    const video = videoRef.current
    if (!video) throw new Error('Video element not mounted')
    video.srcObject = stream
    video.setAttribute('playsinline', 'true')
    video.muted = true
    await video.play()

    // Best-effort continuous autofocus on the live track.
    try {
      await stream.getVideoTracks()[0].applyConstraints({
        advanced: [{ focusMode: 'continuous' }],
      } as unknown as MediaTrackConstraints)
    } catch { /* device doesn't expose focus control */ }

    // Pick the decoder: native BarcodeDetector (Android) else ZBar WASM (iOS).
    const DetectorCtor = getBarcodeDetectorCtor()
    if (DetectorCtor) {
      try {
        let formats = NATIVE_FORMATS
        if (DetectorCtor.getSupportedFormats) {
          const supported = await DetectorCtor.getSupportedFormats()
          const filtered = NATIVE_FORMATS.filter((f) => supported.includes(f))
          if (filtered.length) formats = filtered
        }
        detectorRef.current = new DetectorCtor({ formats })
        decodeModeRef.current = 'native'
      } catch {
        detectorRef.current = null
        decodeModeRef.current = 'zbar'
      }
    } else {
      decodeModeRef.current = 'zbar'
    }

    engineRef.current = 'native'
    isPausedRef.current = false
    setEngine('native')
    setIsScanning(true)
    runDetectLoop()
  }, [runDetectLoop])

  const startScanner = useCallback(async () => {
    if (engineRef.current) return // already running — camera stays mounted
    setCameraError(null)
    setCameraBlocked(false)
    try {
      await startCameraScanner()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Camera error'
      setCameraError(message)
      setCameraBlocked(isPermissionError(message))
      setIsScanning(false)
    }
  }, [startCameraScanner])

  const stopScanner = useCallback(async () => {
    // Native pipeline teardown
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    detectorRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop() } catch { /* ignore */ } })
      streamRef.current = null
    }
    if (videoRef.current) { try { videoRef.current.srcObject = null } catch { /* ignore */ } }
    // Fallback pipeline teardown
    try {
      if (scannerRef.current && scannerRef.current.isScanning) await scannerRef.current.stop()
    } catch { /* ignore */ }
    scannerRef.current = null
    engineRef.current = null
    isPausedRef.current = false
    setEngine(null)
    setTorchOn(false)
    setIsScanning(false)
  }, [])

  // Start/stop on open/close
  useEffect(() => {
    if (isOpen) {
      setBasket([])
      setShowBasket(false)
      setCurrentItem(null)
      setShowItemSheet(false)
      setScanMode('camera')
      setTypedBarcode('')
      setManualName('')
      setManualCost('')
      setManualPrice('')
      setManualQty(1)
      setCameraError(null)
      setCameraBlocked(false)
      startScanner()
    } else {
      stopScanner()
    }
    return () => { stopScanner() }
  }, [isOpen, startScanner, stopScanner])

  // ==========================================================
  // PROCESS SCANNED / TYPED / UPLOADED CODE (shared logic)
  // ==========================================================
  const processScannedCode = useCallback(async (code: string) => {
    // 1. Try QR Code (JSON data)
    try {
      const json = JSON.parse(code)
      if (json.type === 'delivery' || json.product_name || json.name) {
        setCurrentItem({
          id: uid(),
          barcode: json.barcode || null,
          name: json.product_name || json.name || 'Unknown Product',
          cost_price: Number(json.cost_price) || 0,
          selling_price: Number(json.selling_price) || Number(json.price) || 0,
          quantity: Number(json.quantity) || 1,
          unit: json.unit || 'unit',
          category: json.category || 'Groceries',
          low_stock_threshold: 5,
          source: 'qr',
        })
        setShowItemSheet(true)
        return
      }
    } catch { /* not JSON */ }

    // 2. Barcode — check local products first
    const existing = state.products.find((p) => p.barcode === code || p.qr_code === code)
    if (existing) {
      setCurrentItem({
        id: uid(),
        barcode: code,
        name: existing.name,
        cost_price: existing.cost_price,
        selling_price: existing.selling_price,
        quantity: 1,
        unit: existing.unit || 'unit',
        category: existing.category,
        low_stock_threshold: existing.low_stock_threshold || 5,
        source: 'barcode-local',
      })
      setShowItemSheet(true)
      return
    }

    // 3. Barcode — check online product databases (food + general retail)
    const apiData = await lookupProduct(code)
    if (apiData) {
      setCurrentItem({
        id: uid(),
        barcode: code,
        name: apiData.name,
        cost_price: 0,
        selling_price: 0,
        quantity: 1,
        unit: 'unit',
        category: apiData.category,
        low_stock_threshold: 5,
        source: 'barcode-api',
      })
      setShowItemSheet(true)
      return
    }

    // 4. Unknown barcode — show manual entry
    setCurrentItem({
      id: uid(),
      barcode: code,
      name: '',
      cost_price: 0,
      selling_price: 0,
      quantity: 1,
      unit: 'unit',
      category: 'Groceries',
      low_stock_threshold: 5,
      source: 'manual',
    })
    setScanMode('manual')
    setManualName('')
    setManualCost('')
    setManualPrice('')
    setManualQty(1)
  }, [state.products])

  // ==========================================================
  // CAMERA SCAN SUCCESS
  // ==========================================================
  const onScanSuccess = useCallback((decodedText: string) => {
    if (isProcessingRef.current || isPausedRef.current) return
    isProcessingRef.current = true
    pauseScanning() // hold the camera while we process / show the sheet

    // Haptic feedback
    try {
      if (navigator.vibrate) navigator.vibrate(200)
    } catch {}

    processScannedCode(decodedText).finally(() => {
      isProcessingRef.current = false
    })
  }, [processScannedCode, pauseScanning])

  // Keep the running camera pointed at the freshest handler (fresh product list).
  useEffect(() => {
    onScanSuccessRef.current = onScanSuccess
  }, [onScanSuccess])

  // The camera stays mounted across mode switches; pause detection whenever the
  // user leaves camera mode (keyboard/upload/manual) so it can't fire offscreen.
  useEffect(() => {
    if (scanMode === 'camera') resumeScanning()
    else pauseScanning()
  }, [scanMode, resumeScanning, pauseScanning])

  // ==========================================================
  // HANDLE TYPED BARCODE
  // ==========================================================
  const handleTypedBarcode = useCallback(async () => {
    if (!typedBarcode.trim()) return
    setIsProcessingBarcode(true)
    await processScannedCode(typedBarcode.trim())
    setTypedBarcode('')
    setIsProcessingBarcode(false)
  }, [typedBarcode, processScannedCode])

  // ==========================================================
  // HANDLE FILE UPLOAD
  // ==========================================================
  const handleFileUpload = useCallback(async (file: File) => {
    setIsProcessingUpload(true)
    try {
      const scanner = new Html5Qrcode('upload-scanner-hidden', {
        verbose: false,
        useBarCodeDetectorIfSupported: true,
        formatsToSupport: SUPPORTED_FORMATS,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      })
      const decodedText = await scanner.scanFile(file, false)
      await processScannedCode(decodedText)
      await scanner.clear()
    } catch {
      showToast('Could not read barcode from image', 'error')
    } finally {
      setIsProcessingUpload(false)
    }
  }, [processScannedCode, showToast])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
    e.target.value = ''
  }, [handleFileUpload])

  // ==========================================================
  // TORCH
  // ==========================================================
  const toggleTorch = useCallback(async () => {
    const next = !torchOn
    try {
      if (engineRef.current === 'native' && streamRef.current) {
        // Toggle torch on the LIVE track — opening a second stream would conflict.
        const track = streamRef.current.getVideoTracks()[0]
        const caps = track.getCapabilities() as Record<string, unknown>
        if (!('torch' in caps)) { showToast('Torch not available', 'error'); return }
        await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
        setTorchOn(next)
      } else if (engineRef.current === 'fallback' && scannerRef.current) {
        await scannerRef.current.applyVideoConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
        setTorchOn(next)
      } else {
        showToast('Torch not available', 'error')
      }
    } catch {
      showToast('Torch not available', 'error')
    }
  }, [torchOn, showToast])

  // ==========================================================
  // BASKET ACTIONS
  // ==========================================================
  const addToBasket = useCallback((item: ScannedItem) => {
    setBasket((prev) => [...prev, item])
    setShowItemSheet(false)
    setCurrentItem(null)
    showToast(`${item.name} added`, 'success')
    resumeScanning() // resume live scanning for the next item
  }, [showToast, resumeScanning])

  const removeFromBasket = useCallback((id: string) => {
    setBasket((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const saveAllToStock = useCallback(async () => {
    let added = 0, updated = 0
    for (const item of basket) {
      const existing = state.products.find((p) => p.barcode === item.barcode && item.barcode)
      if (existing) {
        await updateProduct(existing.id, { quantity: existing.quantity + item.quantity })
        updated++
      } else {
        await addProduct({
          id: uid(),
          name: item.name,
          cost_price: item.cost_price,
          selling_price: item.selling_price,
          quantity: item.quantity,
          unit: item.unit,
          category: item.category,
          low_stock_threshold: 5,
          barcode: item.barcode,
          qr_code: null,
          created_at: new Date().toISOString(),
        } as Omit<Product, 'user_id'>)
        added++
      }
    }
    const msg = added > 0 && updated > 0 ? `${added} new, ${updated} restocked` : added > 0 ? `${added} items added` : `${updated} items restocked`
    showToast(msg, 'success')
    setBasket([])
    setShowBasket(false)
    onClose()
  }, [basket, state.products, addProduct, updateProduct, showToast, onClose])

  // ==========================================================
  // VOICE INPUT
  // ==========================================================
  const startVoiceInput = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { showToast('Voice not supported', 'error'); return }
    const recognition = new SR()
    recognition.lang = 'en-GB'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => setIsListening(false)
    recognition.onresult = (event: SpeechRecognitionEvent) => { setManualName(event.results[0][0].transcript) }
    recognition.onerror = () => { setIsListening(false); showToast('Voice error', 'error') }
    recognition.start()
  }, [showToast])

  // ==========================================================
  // RENDER
  // ==========================================================
  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10000] bg-black flex flex-col"
      >
        {/* Hidden scanner for file upload decoding */}
        <div id="upload-scanner-hidden" className="hidden" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="hidden"
        />

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-10">
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10">
            <X size={20} strokeWidth={2.5} className="text-white" />
          </button>
          <p className="font-display text-sm text-white uppercase tracking-wider">
            {scanMode === 'camera' && (basket.length > 0 ? `${basket.length} items` : 'SCAN')}
            {scanMode === 'keyboard' && 'TYPE BARCODE'}
            {scanMode === 'upload' && 'UPLOAD PHOTO'}
            {scanMode === 'manual' && (currentItem?.barcode ? 'NEW BARCODE' : 'ADD MANUALLY')}
          </p>
          <button
            onClick={toggleTorch}
            className={`w-10 h-10 flex items-center justify-center rounded-full ${torchOn ? 'bg-amber-400/20' : 'bg-white/10'}`}
          >
            {torchOn ? <Flashlight size={20} strokeWidth={2} className="text-amber-400" /> : <FlashlightOff size={20} strokeWidth={2} className="text-white/70" />}
          </button>
        </div>

        {/* ======== CAMERA MODE ======== */}
        {/* Kept mounted across mode switches so the native detect loop / stream
            never tears down — just hidden when another mode is active. */}
        <div className={`flex-1 relative overflow-hidden ${scanMode === 'camera' ? '' : 'hidden'}`}>
          {/* Native BarcodeDetector preview */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${engine === 'fallback' ? 'hidden' : ''}`}
          />
          {/* Fallback html5-qrcode preview (library injects its own <video> here) */}
          <div id="scanner-camera" className={`absolute inset-0 w-full h-full ${engine === 'native' ? 'hidden' : ''}`} />

            {/* Scanning overlay - active */}
            {isScanning && !cameraError && (
              <div className="absolute inset-0 pointer-events-none">
                <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                  <defs>
                    <mask id="scan-mask">
                      <rect width="100%" height="100%" fill="white" />
                      <rect x="50%" y="40%" width="300" height="150" rx="8" fill="black" transform="translate(-150, -75)" />
                    </mask>
                  </defs>
                  <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#scan-mask)" />
                </svg>
                <div className="absolute left-1/2 top-[40%] w-[300px] h-[150px] -translate-x-1/2 -translate-y-1/2">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-accent-green rounded-tl-sm" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-accent-green rounded-tr-sm" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-accent-green rounded-bl-sm" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-accent-green rounded-br-sm" />
                  <motion.div
                    animate={{ top: ['0%', '100%', '0%'] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                    className="absolute left-0 right-0 h-[2px] bg-accent-green/70 shadow-[0_0_8px_rgba(76,124,72,0.6)]"
                  />
                </div>
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/50 px-3 py-1.5 rounded-full">
                  <QrCode size={12} className="text-white/60" />
                  <span className="text-white/40 text-[10px]">QR</span>
                  <div className="w-px h-3 bg-white/20" />
                  <BarcodeIcon size={12} className="text-white/60" />
                  <span className="text-white/40 text-[10px]">BARCODE</span>
                </div>
              </div>
            )}

            {/* Camera error state */}
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black z-20 px-6">
                <div className="text-center w-full max-w-sm">
                  <Camera size={40} strokeWidth={1.5} className="text-white/30 mx-auto mb-4" />
                  <p className="text-white font-display text-lg uppercase tracking-tight mb-2">Camera Blocked</p>
                  <p className="text-white/50 text-xs mb-6 leading-relaxed">
                    {cameraBlocked
                      ? 'This browser does not allow camera access. Use one of the options below instead.'
                      : 'Could not start camera. Please check your device settings.'}
                  </p>

                  {/* Three fallback options */}
                  <div className="space-y-3">
                    {/* Type Barcode */}
                    <button
                      onClick={() => { setScanMode('keyboard'); setTypedBarcode(''); }}
                      className="w-full h-14 bg-white/10 rounded-sm flex items-center justify-center gap-3"
                    >
                      <Keyboard size={20} strokeWidth={2} className="text-accent-green" />
                      <span className="font-display text-sm text-white uppercase tracking-wider">Type Barcode Number</span>
                    </button>

                    {/* Upload Photo */}
                    <button
                      onClick={() => { setScanMode('upload'); if (fileInputRef.current) fileInputRef.current.click(); }}
                      className="w-full h-14 bg-white/10 rounded-sm flex items-center justify-center gap-3"
                    >
                      <Upload size={20} strokeWidth={2} className="text-accent-green" />
                      <span className="font-display text-sm text-white uppercase tracking-wider">Upload Barcode Photo</span>
                    </button>

                    {/* Add Manual */}
                    <button
                      onClick={() => { setScanMode('manual'); setCurrentItem(null); setManualName(''); setManualCost(''); setManualPrice(''); setManualQty(1); }}
                      className="w-full h-14 bg-white/5 rounded-sm flex items-center justify-center gap-3"
                    >
                      <Plus size={20} strokeWidth={2} className="text-white/50" />
                      <span className="font-display text-sm text-white/70 uppercase tracking-wider">Add Without Barcode</span>
                    </button>
                  </div>

                  {/* Retry camera */}
                  {!cameraBlocked && (
                    <button
                      onClick={() => { setCameraError(null); startScanner(); }}
                      className="mt-6 text-white/40 text-xs font-display uppercase tracking-wider"
                    >
                      Try Camera Again
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

        {/* ======== KEYBOARD MODE ======== */}
        {scanMode === 'keyboard' && (
          <div className="flex-1 bg-black flex flex-col items-center justify-center px-6">
            <BarcodeIcon size={48} strokeWidth={1.5} className="text-accent-green mb-4" />
            <p className="font-display text-lg text-white uppercase tracking-tight mb-1">Enter Barcode</p>
            <p className="text-white/40 text-xs mb-6 text-center">Type the numbers under the barcode</p>

            <div className="w-full max-w-sm">
              <input
                type="number"
                value={typedBarcode}
                onChange={(e) => setTypedBarcode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTypedBarcode()}
                placeholder="e.g. 4601234567890"
                className="w-full h-14 bg-white harsh-border rounded-sm px-4 font-display text-xl text-ink text-center tracking-widest mb-4"
                autoFocus
              />
              <button
                onClick={handleTypedBarcode}
                disabled={!typedBarcode.trim() || isProcessingBarcode}
                className="w-full h-14 bg-ink rounded-sm font-display text-sm text-white uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {isProcessingBarcode ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <BarcodeIcon size={16} />
                    LOOKUP BARCODE
                  </>
                )}
              </button>

              {/* Mode switcher */}
              <div className="flex gap-3 mt-6 justify-center">
                <button onClick={() => { setScanMode('upload'); if (fileInputRef.current) fileInputRef.current.click(); }} className="text-white/40 text-xs font-display uppercase flex items-center gap-1">
                  <Upload size={12} /> Upload
                </button>
                <div className="w-px h-4 bg-white/20" />
                <button onClick={() => { setScanMode('camera'); setCameraError(null); startScanner(); }} className="text-white/40 text-xs font-display uppercase flex items-center gap-1">
                  <Camera size={12} /> Camera
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======== UPLOAD MODE ======== */}
        {scanMode === 'upload' && (
          <div className="flex-1 bg-black flex flex-col items-center justify-center px-6">
            {isProcessingUpload ? (
              <div className="text-center">
                <div className="w-12 h-12 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
                <p className="text-white/60 text-sm">Reading barcode...</p>
              </div>
            ) : (
              <>
                <Upload size={48} strokeWidth={1.5} className="text-accent-green mb-4" />
                <p className="font-display text-lg text-white uppercase tracking-tight mb-1">Upload Photo</p>
                <p className="text-white/40 text-xs mb-6 text-center">Take a clear photo of the barcode</p>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full max-w-sm h-14 bg-ink rounded-sm font-display text-sm text-white uppercase tracking-wider flex items-center justify-center gap-2 mb-4"
                >
                  <Camera size={16} />
                  CHOOSE PHOTO
                </button>

                {/* Mode switcher */}
                <div className="flex gap-3 mt-6 justify-center">
                  <button onClick={() => { setScanMode('keyboard'); setTypedBarcode(''); }} className="text-white/40 text-xs font-display uppercase flex items-center gap-1">
                    <Keyboard size={12} /> Type
                  </button>
                  <div className="w-px h-4 bg-white/20" />
                  <button onClick={() => { setScanMode('camera'); setCameraError(null); startScanner(); }} className="text-white/40 text-xs font-display uppercase flex items-center gap-1">
                    <Camera size={12} /> Camera
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ======== MANUAL MODE ======== */}
        {scanMode === 'manual' && (
          <div className="flex-1 bg-black overflow-y-auto">
            <div className="max-w-sm mx-auto px-5 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              {currentItem?.barcode && (
                <div className="flex items-center gap-2 mb-3 bg-white/5 rounded-sm px-3 py-2">
                  <AlertTriangle size={14} className="text-amber-400" />
                  <span className="text-[10px] text-amber-400 font-display uppercase">UNKNOWN BARCODE</span>
                  <span className="text-[10px] text-white/40 font-mono ml-auto">{currentItem.barcode}</span>
                </div>
              )}

              <h3 className="font-display text-xl text-white uppercase tracking-tight mb-5">
                {currentItem?.barcode ? 'Add Product Details' : 'Add Without Barcode'}
              </h3>

              {/* Product name */}
              <div className="mb-4">
                <label className="text-[10px] text-white/40 uppercase tracking-wider mb-1 block">Product Name</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    className="flex-1 h-12 bg-white harsh-border rounded-sm px-3 font-display text-base text-ink"
                    placeholder="Enter name or use voice"
                  />
                  <button
                    onClick={startVoiceInput}
                    className={`w-12 h-12 rounded-sm flex items-center justify-center flex-shrink-0 ${isListening ? 'bg-accent-red/20' : 'bg-white/10'}`}
                  >
                    <Mic size={18} className={isListening ? 'text-accent-red animate-pulse' : 'text-white'} />
                  </button>
                </div>
                {isListening && <p className="text-[10px] text-accent-red mt-1">Listening...</p>}
              </div>

              {/* Quantity */}
              <div className="mb-4">
                <label className="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Quantity</label>
                <div className="flex items-center gap-4">
                  <button onClick={() => setManualQty((q) => Math.max(1, q - 1))} className="w-12 h-12 bg-white/10 rounded-sm flex items-center justify-center">
                    <Minus size={18} strokeWidth={2.5} className="text-white" />
                  </button>
                  <span className="font-display text-3xl text-white w-16 text-center">{manualQty}</span>
                  <button onClick={() => setManualQty((q) => q + 1)} className="w-12 h-12 bg-white/10 rounded-sm flex items-center justify-center">
                    <Plus size={18} strokeWidth={2.5} className="text-white" />
                  </button>
                </div>
              </div>

              {/* Price fields */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="text-[10px] text-white/40 uppercase tracking-wider mb-1 block">Cost Price</label>
                  <input
                    type="number"
                    value={manualCost}
                    onChange={(e) => setManualCost(e.target.value)}
                    className="w-full h-12 bg-white harsh-border rounded-sm px-3 font-display text-lg text-ink"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 uppercase tracking-wider mb-1 block">Selling Price</label>
                  <input
                    type="number"
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                    className="w-full h-12 bg-white harsh-border rounded-sm px-3 font-display text-lg text-ink"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Projected profit */}
              <div className="bg-accent-green/10 rounded-sm p-3 mb-5">
                <p className="text-[10px] text-accent-green uppercase tracking-wider mb-1">Projected Profit</p>
                <p className="font-display text-lg text-accent-green">
                  {formatCurrency((Number(manualPrice || 0) - Number(manualCost || 0)) * manualQty)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button onClick={() => setScanMode('camera')} className="flex-1 h-14 bg-white/10 rounded-sm font-display text-sm text-white/70 uppercase tracking-wider">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    addToBasket({
                      id: uid(),
                      barcode: currentItem?.barcode || null,
                      name: manualName || 'Unknown Product',
                      cost_price: Number(manualCost) || 0,
                      selling_price: Number(manualPrice) || 0,
                      quantity: manualQty,
                      unit: 'unit',
                      category: 'Groceries',
                      low_stock_threshold: 5,
                      source: 'manual',
                    })
                    setManualName('')
                    setManualCost('')
                    setManualPrice('')
                    setManualQty(1)
                  }}
                  className="flex-1 h-14 bg-ink rounded-sm font-display text-sm text-white uppercase tracking-wider flex items-center justify-center gap-2"
                >
                  <Plus size={18} />
                  ADD TO DELIVERY
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======== BOTTOM: BASKET + MODE TOGGLE ======== */}
        <div className="bg-black/90 z-10">
          {/* Basket toggle */}
          {basket.length > 0 && (
            <button onClick={() => setShowBasket(!showBasket)} className="w-full flex items-center justify-center gap-2 py-2 border-b border-white/10">
              <Package size={14} className="text-accent-green" />
              <span className="text-white/70 text-xs font-display">{basket.length} items in delivery</span>
              {showBasket ? <ChevronDown size={14} className="text-white/40" /> : <ChevronUp size={14} className="text-white/40" />}
            </button>
          )}

          {/* Basket items */}
          <AnimatePresence>
            {showBasket && basket.length > 0 && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden border-b border-white/10">
                <div className="max-h-[200px] overflow-y-auto p-3 space-y-2">
                  {basket.map((item) => (
                    <div key={item.id} className="flex items-center justify-between bg-white/5 rounded-sm px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{item.name}</p>
                        <p className="text-white/40 text-[10px]">{item.quantity} {item.unit} × {formatCurrency(item.cost_price)}</p>
                      </div>
                      <button onClick={() => removeFromBasket(item.id)} className="w-8 h-8 flex items-center justify-center ml-2">
                        <Trash2 size={14} className="text-accent-red" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="p-3 pt-0">
                  <button onClick={saveAllToStock} className="w-full h-12 bg-accent-green rounded-sm font-display text-sm text-white uppercase tracking-wider flex items-center justify-center gap-2">
                    <Check size={18} strokeWidth={2.5} />
                    SAVE ALL TO STOCK
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mode switcher when camera works */}
          {scanMode === 'camera' && isScanning && (
            <div className="flex items-center justify-center gap-4 py-3">
              <button onClick={() => { setScanMode('keyboard'); setTypedBarcode(''); }} className="flex items-center gap-1.5 text-white/40">
                <Keyboard size={14} />
                <span className="text-[10px] font-display uppercase">Type</span>
              </button>
              <div className="w-px h-4 bg-white/20" />
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 text-white/40">
                <Upload size={14} />
                <span className="text-[10px] font-display uppercase">Upload</span>
              </button>
              <div className="w-px h-4 bg-white/20" />
              <button onClick={() => { setScanMode('manual'); setCurrentItem(null); setManualName(''); setManualCost(''); setManualPrice(''); setManualQty(1); }} className="flex items-center gap-1.5 text-white/40">
                <Plus size={14} />
                <span className="text-[10px] font-display uppercase">Manual</span>
              </button>
            </div>
          )}

          {/* Manual entry from camera mode (when camera works) */}
          {scanMode === 'camera' && isScanning && (
            <button onClick={() => { setScanMode('manual'); setCurrentItem(null); setManualName(''); setManualCost(''); setManualPrice(''); setManualQty(1); }} className="w-full flex items-center justify-center gap-2 py-3 border-t border-white/10">
              <Plus size={14} className="text-white/40" />
              <span className="text-white/40 text-xs font-display">ADD WITHOUT BARCODE</span>
            </button>
          )}
        </div>

        {/* ========================================== */}
        {/* ITEM CONFIRMATION SHEET (QR / known barcode) */}
        {/* ========================================== */}
        <AnimatePresence>
          {showItemSheet && currentItem && (
            <>
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                className="absolute inset-0 bg-black/60 z-[110]" 
                onClick={() => {
                  setShowItemSheet(false)
                  setCurrentItem(null)
                  resumeScanning()
                }}
              />
              <motion.div
                initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="absolute bottom-0 left-0 right-0 bg-sand z-[120] rounded-t-2xl max-h-[90vh] overflow-y-auto"
              >
                <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 bg-ink/20 rounded-full" /></div>
                <div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                  <div className="flex items-center gap-2 mb-4">
                    {currentItem.source === 'qr' ? <QrCode size={14} className="text-accent-green" /> : <BarcodeIcon size={14} className="text-accent-green" />}
                    <span className="text-[10px] text-accent-green font-display uppercase tracking-wider">
                      {currentItem.source === 'qr' ? 'QR DELIVERY' : currentItem.source === 'barcode-local' ? 'KNOWN PRODUCT' : 'FROM DATABASE'}
                    </span>
                  </div>
                  <h3 className="font-display text-xl text-ink uppercase tracking-tight mb-4">{currentItem.name}</h3>
                  {currentItem.barcode && <p className="text-[10px] text-muted-text font-mono mb-4">{currentItem.barcode}</p>}

                  <div className="mb-4">
                    <label className="text-micro text-muted-text mb-2 block">QUANTITY RECEIVED</label>
                    <div className="flex items-center gap-4">
                      <button onClick={() => setCurrentItem((prev) => prev ? { ...prev, quantity: Math.max(1, prev.quantity - 1) } : null)} className="w-12 h-12 bg-warm-gray rounded-sm flex items-center justify-center">
                        <Minus size={18} strokeWidth={2.5} className="text-ink" />
                      </button>
                      <span className="font-display text-3xl text-ink w-16 text-center">{currentItem.quantity}</span>
                      <button onClick={() => setCurrentItem((prev) => prev ? { ...prev, quantity: prev.quantity + 1 } : null)} className="w-12 h-12 bg-warm-gray rounded-sm flex items-center justify-center">
                        <Plus size={18} strokeWidth={2.5} className="text-ink" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <div>
                      <label className="text-micro text-muted-text mb-1 block">COST PRICE</label>
                      <input
                        type="number"
                        value={currentItem.cost_price || ''}
                        onChange={(e) => setCurrentItem((prev) => prev ? { ...prev, cost_price: Number(e.target.value) } : null)}
                        className="w-full h-12 bg-white harsh-border rounded-sm px-3 font-display text-lg text-ink"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-micro text-muted-text mb-1 block">SELLING PRICE</label>
                      <input
                        type="number"
                        value={currentItem.selling_price || ''}
                        onChange={(e) => setCurrentItem((prev) => prev ? { ...prev, selling_price: Number(e.target.value) } : null)}
                        className="w-full h-12 bg-white harsh-border rounded-sm px-3 font-display text-lg text-ink"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="bg-accent-green/10 rounded-sm p-3 mb-5">
                    <p className="text-[10px] text-accent-green uppercase tracking-wider mb-1">Projected Profit</p>
                    <p className="font-display text-lg text-accent-green">{formatCurrency((currentItem.selling_price - currentItem.cost_price) * currentItem.quantity)}</p>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={() => { setShowItemSheet(false); setCurrentItem(null); resumeScanning() }} className="flex-1 h-14 bg-warm-gray rounded-sm font-display text-sm text-ink uppercase tracking-wider">Cancel</button>
                    <button onClick={() => currentItem && addToBasket(currentItem)} className="flex-1 h-14 bg-ink rounded-sm font-display text-sm text-white uppercase tracking-wider flex items-center justify-center gap-2">
                      <Plus size={18} /> ADD TO DELIVERY
                    </button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  )
}
