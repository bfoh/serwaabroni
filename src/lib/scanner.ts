// Shared barcode/QR decode utilities used by both the delivery scanner and the
// sales (POS) scanner. Single source for normalization, decoder selection, and
// the lazy ZBar loader.

// Native BarcodeDetector format strings.
export const NATIVE_FORMATS = [
  'qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128',
  'code_39', 'code_93', 'codabar', 'itf', 'data_matrix', 'aztec', 'pdf417',
]

// Minimal typing for the native BarcodeDetector API (not in TS DOM lib yet).
export interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}
export interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): NativeBarcodeDetector
  getSupportedFormats?(): Promise<string[]>
}
export function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor || null
}

// Lazy ZBar WASM loader (kept out of the main bundle).
let zbarMod: typeof import('@undecaf/zbar-wasm') | null = null
export const loadZbar = async () => (zbarMod ??= await import('@undecaf/zbar-wasm'))

// EAN-13, UPC-A and UPC-E encode the same product number with different
// leading zeros, and a single physical barcode can decode either way on
// different scans. Normalise (strip leading zeros) so a code saved one scan
// still matches the next. Non-numeric codes (QR payloads) pass through trimmed.
export function normalizeBarcode(code: string | null | undefined): string {
  if (!code) return ''
  const trimmed = String(code).trim()
  if (!/^\d+$/.test(trimmed)) return trimmed
  return trimmed.replace(/^0+/, '') || trimmed
}
