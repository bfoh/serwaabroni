// Industry-specific unit choices for the stock-quantity dropdown, mirroring
// how src/lib/categories.ts templates categories per industry. Falls back to
// General/Other's list for any unrecognized industry (never throws).
export interface UnitOption {
  value: string
  label: string
}

const GENERAL_UNITS: UnitOption[] = [
  { value: 'piece', label: 'Piece' },
  { value: 'pack', label: 'Pack' },
  { value: 'box', label: 'Box' },
  { value: 'bag', label: 'Bag' },
  { value: 'unit', label: 'Unit' },
  { value: 'set', label: 'Set' },
]

const GENERAL_SMALL_UNITS: UnitOption[] = [
  { value: 'piece', label: 'Piece' },
  { value: 'unit', label: 'Unit' },
]

// Full unit list per industry — shown for a single-unit product, or as the
// "bigger unit" (pack_unit) choice for a multi-unit one.
const UNIT_OPTIONS_BY_INDUSTRY: Record<string, UnitOption[]> = {
  'Supermarket': [
    { value: 'piece', label: 'Piece' },
    { value: 'tin', label: 'Tin' },
    { value: 'bag', label: 'Bag' },
    { value: 'bottle', label: 'Bottle' },
    { value: 'pack', label: 'Pack' },
    { value: 'loaf', label: 'Loaf' },
    { value: 'sachet', label: 'Sachet' },
    { value: 'carton', label: 'Carton' },
    { value: 'litre', label: 'Litre' },
    { value: 'kg', label: 'Kg' },
  ],
  'Hardware/Plumbing': [
    { value: 'piece', label: 'Piece' },
    { value: 'metre', label: 'Metre' },
    { value: 'roll', label: 'Roll' },
    { value: 'coil', label: 'Coil' },
    { value: 'sheet', label: 'Sheet' },
    { value: 'box', label: 'Box' },
    { value: 'bag', label: 'Bag' },
    { value: 'set', label: 'Set' },
    { value: 'litre', label: 'Litre' },
    { value: 'kg', label: 'Kg' },
  ],
  'Hair & Beauty': [
    { value: 'piece', label: 'Piece' },
    { value: 'bottle', label: 'Bottle' },
    { value: 'tube', label: 'Tube' },
    { value: 'jar', label: 'Jar' },
    { value: 'sachet', label: 'Sachet' },
    { value: 'pack', label: 'Pack' },
    { value: 'box', label: 'Box' },
    { value: 'set', label: 'Set' },
  ],
  'Fashion/Clothing': [
    { value: 'piece', label: 'Piece' },
    { value: 'pair', label: 'Pair' },
    { value: 'set', label: 'Set' },
    { value: 'dozen', label: 'Dozen' },
    { value: 'pack', label: 'Pack' },
    { value: 'box', label: 'Box' },
  ],
  'Electronics': [
    { value: 'piece', label: 'Piece' },
    { value: 'unit', label: 'Unit' },
    { value: 'set', label: 'Set' },
    { value: 'pack', label: 'Pack' },
    { value: 'box', label: 'Box' },
    { value: 'carton', label: 'Carton' },
  ],
  'Pharmacy': [
    { value: 'piece', label: 'Piece' },
    { value: 'strip', label: 'Strip' },
    { value: 'tube', label: 'Tube' },
    { value: 'vial', label: 'Vial' },
    { value: 'sachet', label: 'Sachet' },
    { value: 'bottle', label: 'Bottle' },
    { value: 'pack', label: 'Pack' },
    { value: 'box', label: 'Box' },
    { value: 'carton', label: 'Carton' },
  ],
  'Building Materials': [
    { value: 'piece', label: 'Piece' },
    { value: 'bag', label: 'Bag' },
    { value: 'sheet', label: 'Sheet' },
    { value: 'rod', label: 'Rod' },
    { value: 'bundle', label: 'Bundle' },
    { value: 'litre', label: 'Litre' },
    { value: 'kg', label: 'Kg' },
  ],
  'Second-Hand Goods': [
    { value: 'piece', label: 'Piece' },
    { value: 'bale', label: 'Bale' },
    { value: 'bundle', label: 'Bundle' },
    { value: 'set', label: 'Set' },
    { value: 'pair', label: 'Pair' },
  ],
  'Telecom & Mobile Money': [
    { value: 'piece', label: 'Piece' },
    { value: 'pack', label: 'Pack' },
    { value: 'set', label: 'Set' },
  ],
  'Food & Beverages': [
    { value: 'piece', label: 'Piece' },
    { value: 'plate', label: 'Plate' },
    { value: 'bottle', label: 'Bottle' },
    { value: 'pack', label: 'Pack' },
    { value: 'crate', label: 'Crate' },
    { value: 'litre', label: 'Litre' },
    { value: 'kg', label: 'Kg' },
  ],
  'Auto Parts & Spares': [
    { value: 'piece', label: 'Piece' },
    { value: 'set', label: 'Set' },
    { value: 'pair', label: 'Pair' },
    { value: 'litre', label: 'Litre' },
    { value: 'box', label: 'Box' },
  ],
  'Agro & Farm Supplies': [
    { value: 'piece', label: 'Piece' },
    { value: 'bag', label: 'Bag' },
    { value: 'sack', label: 'Sack' },
    { value: 'litre', label: 'Litre' },
    { value: 'kg', label: 'Kg' },
    { value: 'box', label: 'Box' },
  ],
  'Furniture & Woodworking': [
    { value: 'piece', label: 'Piece' },
    { value: 'set', label: 'Set' },
    { value: 'pack', label: 'Pack' },
    { value: 'sheet', label: 'Sheet' },
  ],
  'Stationery & Books': [
    { value: 'piece', label: 'Piece' },
    { value: 'pack', label: 'Pack' },
    { value: 'box', label: 'Box' },
    { value: 'ream', label: 'Ream' },
    { value: 'set', label: 'Set' },
  ],
  'General/Other': GENERAL_UNITS,
}

// Smaller/individual-item units — shown as the "smaller unit" choice for a
// multi-unit product (e.g. loose sachets sold out of a box). Deliberately
// excludes bulk/container units (Box, Carton, Set) that only make sense as
// the bigger pack unit.
const SMALL_UNIT_OPTIONS_BY_INDUSTRY: Record<string, UnitOption[]> = {
  'Supermarket': [
    { value: 'piece', label: 'Piece' },
    { value: 'tin', label: 'Tin' },
    { value: 'bag', label: 'Bag' },
    { value: 'sachet', label: 'Sachet' },
    { value: 'bottle', label: 'Bottle' },
  ],
  'Hardware/Plumbing': [
    { value: 'piece', label: 'Piece' },
    { value: 'metre', label: 'Metre' },
    { value: 'sheet', label: 'Sheet' },
  ],
  'Hair & Beauty': [
    { value: 'piece', label: 'Piece' },
    { value: 'sachet', label: 'Sachet' },
    { value: 'tube', label: 'Tube' },
  ],
  'Fashion/Clothing': [
    { value: 'piece', label: 'Piece' },
    { value: 'pair', label: 'Pair' },
  ],
  'Electronics': [
    { value: 'piece', label: 'Piece' },
    { value: 'unit', label: 'Unit' },
  ],
  'Pharmacy': [
    { value: 'piece', label: 'Piece' },
    { value: 'strip', label: 'Strip' },
    { value: 'sachet', label: 'Sachet' },
    { value: 'tube', label: 'Tube' },
  ],
  'Building Materials': [
    { value: 'piece', label: 'Piece' },
    { value: 'sheet', label: 'Sheet' },
    { value: 'rod', label: 'Rod' },
  ],
  'Second-Hand Goods': [
    { value: 'piece', label: 'Piece' },
    { value: 'pair', label: 'Pair' },
  ],
  'Telecom & Mobile Money': [
    { value: 'piece', label: 'Piece' },
  ],
  'Food & Beverages': [
    { value: 'piece', label: 'Piece' },
    { value: 'plate', label: 'Plate' },
    { value: 'bottle', label: 'Bottle' },
  ],
  'Auto Parts & Spares': [
    { value: 'piece', label: 'Piece' },
    { value: 'pair', label: 'Pair' },
  ],
  'Agro & Farm Supplies': [
    { value: 'piece', label: 'Piece' },
    { value: 'kg', label: 'Kg' },
  ],
  'Furniture & Woodworking': [
    { value: 'piece', label: 'Piece' },
  ],
  'Stationery & Books': [
    { value: 'piece', label: 'Piece' },
  ],
  'General/Other': GENERAL_SMALL_UNITS,
}

export function unitOptionsForIndustry(industry: string | null | undefined): UnitOption[] {
  return UNIT_OPTIONS_BY_INDUSTRY[industry ?? ''] ?? UNIT_OPTIONS_BY_INDUSTRY['General/Other']
}

export function smallUnitOptionsForIndustry(industry: string | null | undefined): UnitOption[] {
  return SMALL_UNIT_OPTIONS_BY_INDUSTRY[industry ?? ''] ?? SMALL_UNIT_OPTIONS_BY_INDUSTRY['General/Other']
}
