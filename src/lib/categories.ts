// Static, read-only reference data for the multi-industry category picker.
// See docs/superpowers/specs/2026-08-03-multi-industry-categories-design.md

// Curated for prevalence among small/informal Ghanaian retail and trade
// businesses — provision shops, hardware/building suppliers, salons,
// secondhand ("obroni wawu") and boutique clothing dealers, phone/electronics
// and telecom/MoMo vendors, chemical shops, chop bars, Abossey Okai-style
// spare parts dealers, agro-input dealers, furniture workshops, and
// stationery/bookshops are among the most common shop-owner trades in Ghana.
// General/Other stays last as the universal fallback.
export const INDUSTRIES = [
  'Supermarket',
  'Hardware/Plumbing',
  'Building Materials',
  'Hair & Beauty',
  'Fashion/Clothing',
  'Second-Hand Goods',
  'Electronics',
  'Telecom & Mobile Money',
  'Pharmacy',
  'Food & Beverages',
  'Auto Parts & Spares',
  'Agro & Farm Supplies',
  'Furniture & Woodworking',
  'Stationery & Books',
  'General/Other',
] as const

export type Industry = typeof INDUSTRIES[number]

export interface CategoryTemplateEntry {
  name: string
  icon: string
  sortOrder: number
}

// Curated set of Lucide icon keys offered in the category icon picker
// (Settings) and used to seed industry templates. Keep in sync with
// CATEGORY_ICON_MAP in src/lib/categoryIconMap.ts — every key here must have
// a matching entry there (enforced by categoryIconMap.test.ts).
export const CURATED_ICONS: string[] = [
  'box', 'milk', 'cup-soda', 'wheat', 'package', 'soup', 'croissant', 'utensils',
  'wrench', 'hammer', 'droplet', 'scissors', 'sparkles', 'shirt', 'footprints',
  'watch', 'cpu', 'smartphone', 'laptop', 'plug', 'battery', 'pill', 'syringe',
  'stethoscope', 'zap', 'palette', 'settings', 'shield', 'brush', 'flower-2',
  'shopping-bag', 'gem', 'scroll', 'cable', 'headphones', 'refrigerator',
  'flask-conical', 'bandage', 'baby', 'shapes', 'chef-hat', 'shopping-basket',
  'brick-wall', 'layers', 'construction', 'grid-3x3', 'door-open', 'paint-bucket',
  'mountain', 'disc', 'car', 'sprout', 'shovel', 'paw-print', 'sofa', 'bed',
  'tree-pine', 'umbrella', 'book-open', 'pencil', 'backpack', 'paintbrush',
  'printer', 'wifi', 'wallet', 'battery-charging', 'flame', 'sandwich', 'briefcase',
]

// Builtin category every tenant gets, never deletable. Not part of any
// industry's editable template — inserted separately at seed time.
export const UNCATEGORIZED: CategoryTemplateEntry = { name: 'Uncategorized', icon: 'box', sortOrder: 99 }

export const INDUSTRY_TEMPLATES: Record<Industry, CategoryTemplateEntry[]> = {
  'Supermarket': [
    { name: 'Groceries', icon: 'shopping-basket', sortOrder: 0 },
    { name: 'Dairy', icon: 'milk', sortOrder: 1 },
    { name: 'Beverages', icon: 'cup-soda', sortOrder: 2 },
    { name: 'Cooking', icon: 'chef-hat', sortOrder: 3 },
    { name: 'Grains', icon: 'wheat', sortOrder: 4 },
    { name: 'Canned', icon: 'package', sortOrder: 5 },
    { name: 'Noodles', icon: 'soup', sortOrder: 6 },
    { name: 'Bakery', icon: 'croissant', sortOrder: 7 },
  ],
  'Hardware/Plumbing': [
    { name: 'Pipes & Fittings', icon: 'wrench', sortOrder: 0 },
    { name: 'Tools', icon: 'hammer', sortOrder: 1 },
    { name: 'Paints & Sealants', icon: 'palette', sortOrder: 2 },
    { name: 'Electrical', icon: 'zap', sortOrder: 3 },
    { name: 'Fasteners & Hardware', icon: 'settings', sortOrder: 4 },
    { name: 'Safety Gear', icon: 'shield', sortOrder: 5 },
  ],
  'Building Materials': [
    { name: 'Cement & Blocks', icon: 'brick-wall', sortOrder: 0 },
    { name: 'Roofing Sheets', icon: 'layers', sortOrder: 1 },
    { name: 'Iron Rods & Steel', icon: 'construction', sortOrder: 2 },
    { name: 'Tiles & Flooring', icon: 'grid-3x3', sortOrder: 3 },
    { name: 'Doors & Windows', icon: 'door-open', sortOrder: 4 },
    { name: 'Paints', icon: 'paint-bucket', sortOrder: 5 },
    { name: 'Sand & Aggregates', icon: 'mountain', sortOrder: 6 },
  ],
  'Hair & Beauty': [
    { name: 'Hair Care', icon: 'scissors', sortOrder: 0 },
    { name: 'Extensions & Wigs', icon: 'brush', sortOrder: 1 },
    { name: 'Skin Care', icon: 'droplet', sortOrder: 2 },
    { name: 'Makeup', icon: 'sparkles', sortOrder: 3 },
    { name: 'Fragrances', icon: 'flower-2', sortOrder: 4 },
    { name: 'Tools & Equipment', icon: 'plug', sortOrder: 5 },
  ],
  'Fashion/Clothing': [
    { name: 'Clothing', icon: 'shirt', sortOrder: 0 },
    { name: 'Footwear', icon: 'footprints', sortOrder: 1 },
    { name: 'Accessories', icon: 'watch', sortOrder: 2 },
    { name: 'Bags', icon: 'shopping-bag', sortOrder: 3 },
    { name: 'Jewelry', icon: 'gem', sortOrder: 4 },
    { name: 'Fabrics', icon: 'scroll', sortOrder: 5 },
  ],
  'Second-Hand Goods': [
    { name: 'Clothing', icon: 'shirt', sortOrder: 0 },
    { name: 'Shoes', icon: 'footprints', sortOrder: 1 },
    { name: 'Bags', icon: 'shopping-bag', sortOrder: 2 },
    { name: 'Household Items', icon: 'box', sortOrder: 3 },
    { name: 'Electronics', icon: 'smartphone', sortOrder: 4 },
    { name: 'Accessories', icon: 'watch', sortOrder: 5 },
  ],
  'Electronics': [
    { name: 'Phones', icon: 'smartphone', sortOrder: 0 },
    { name: 'Computers', icon: 'laptop', sortOrder: 1 },
    { name: 'Accessories', icon: 'cable', sortOrder: 2 },
    { name: 'Components', icon: 'cpu', sortOrder: 3 },
    { name: 'Audio', icon: 'headphones', sortOrder: 4 },
    { name: 'Home Appliances', icon: 'refrigerator', sortOrder: 5 },
  ],
  'Telecom & Mobile Money': [
    { name: 'Airtime & Data', icon: 'wifi', sortOrder: 0 },
    { name: 'Phone Accessories', icon: 'cable', sortOrder: 1 },
    { name: 'SIM Cards', icon: 'smartphone', sortOrder: 2 },
    { name: 'Mobile Money Services', icon: 'wallet', sortOrder: 3 },
    { name: 'Phone Repairs', icon: 'wrench', sortOrder: 4 },
    { name: 'Chargers & Cables', icon: 'battery-charging', sortOrder: 5 },
  ],
  'Pharmacy': [
    { name: 'Medicines', icon: 'pill', sortOrder: 0 },
    { name: 'Supplements', icon: 'flask-conical', sortOrder: 1 },
    { name: 'First Aid', icon: 'bandage', sortOrder: 2 },
    { name: 'Injections', icon: 'syringe', sortOrder: 3 },
    { name: 'Baby Care', icon: 'baby', sortOrder: 4 },
    { name: 'Personal Care', icon: 'droplet', sortOrder: 5 },
  ],
  'Food & Beverages': [
    { name: 'Local Dishes', icon: 'soup', sortOrder: 0 },
    { name: 'Fast Food', icon: 'sandwich', sortOrder: 1 },
    { name: 'Drinks', icon: 'cup-soda', sortOrder: 2 },
    { name: 'Snacks & Pastries', icon: 'croissant', sortOrder: 3 },
    { name: 'Ingredients & Spices', icon: 'flame', sortOrder: 4 },
    { name: 'Packaged Foods', icon: 'package', sortOrder: 5 },
  ],
  'Auto Parts & Spares': [
    { name: 'Engine Parts', icon: 'settings', sortOrder: 0 },
    { name: 'Tyres & Wheels', icon: 'disc', sortOrder: 1 },
    { name: 'Body Parts', icon: 'car', sortOrder: 2 },
    { name: 'Batteries', icon: 'battery', sortOrder: 3 },
    { name: 'Lubricants & Oils', icon: 'droplet', sortOrder: 4 },
    { name: 'Accessories', icon: 'cable', sortOrder: 5 },
  ],
  'Agro & Farm Supplies': [
    { name: 'Seeds', icon: 'sprout', sortOrder: 0 },
    { name: 'Fertilizers & Chemicals', icon: 'flask-conical', sortOrder: 1 },
    { name: 'Farm Tools', icon: 'shovel', sortOrder: 2 },
    { name: 'Animal Feed', icon: 'wheat', sortOrder: 3 },
    { name: 'Irrigation Equipment', icon: 'droplet', sortOrder: 4 },
    { name: 'Livestock Supplies', icon: 'paw-print', sortOrder: 5 },
  ],
  'Furniture & Woodworking': [
    { name: 'Living Room', icon: 'sofa', sortOrder: 0 },
    { name: 'Bedroom', icon: 'bed', sortOrder: 1 },
    { name: 'Office Furniture', icon: 'briefcase', sortOrder: 2 },
    { name: 'Wood & Timber', icon: 'tree-pine', sortOrder: 3 },
    { name: 'Fittings & Accessories', icon: 'settings', sortOrder: 4 },
    { name: 'Outdoor Furniture', icon: 'umbrella', sortOrder: 5 },
  ],
  'Stationery & Books': [
    { name: 'Books', icon: 'book-open', sortOrder: 0 },
    { name: 'Writing Materials', icon: 'pencil', sortOrder: 1 },
    { name: 'School Supplies', icon: 'backpack', sortOrder: 2 },
    { name: 'Office Supplies', icon: 'briefcase', sortOrder: 3 },
    { name: 'Art & Craft', icon: 'paintbrush', sortOrder: 4 },
    { name: 'Printing & Photocopy', icon: 'printer', sortOrder: 5 },
  ],
  'General/Other': [
    { name: 'General', icon: 'box', sortOrder: 0 },
    { name: 'Services', icon: 'wrench', sortOrder: 1 },
    { name: 'Supplies', icon: 'package', sortOrder: 2 },
    { name: 'Miscellaneous', icon: 'shapes', sortOrder: 3 },
  ],
}

// Returns the editable starter category list for an industry. Unrecognized
// input (stale data, future template removal) falls back to General/Other
// rather than throwing.
export function templateForIndustry(industry: string): CategoryTemplateEntry[] {
  return INDUSTRY_TEMPLATES[industry as Industry] ?? INDUSTRY_TEMPLATES['General/Other']
}

// "Load starter categories" idempotency: keep only template entries whose
// name isn't already present (case-insensitive) among the tenant's existing
// categories.
export function mergeSeedNames(
  existingNames: string[],
  template: CategoryTemplateEntry[],
): CategoryTemplateEntry[] {
  const existingLower = new Set(existingNames.map((n) => n.toLowerCase()))
  return template.filter((t) => !existingLower.has(t.name.toLowerCase()))
}
