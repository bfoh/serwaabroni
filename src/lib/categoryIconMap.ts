import {
  Box, Milk, CupSoda, Wheat, Package, Soup, Croissant, Utensils, Wrench, Hammer,
  Droplet, Scissors, Sparkles, Shirt, Footprints, Watch, Cpu, Smartphone, Laptop,
  Plug, Battery, Pill, Syringe, Stethoscope, type LucideIcon,
} from 'lucide-react'

// Maps a business_categories.icon key (see CURATED_ICONS in
// src/lib/categories.ts) to the Lucide component that renders it.
export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  'box': Box,
  'milk': Milk,
  'cup-soda': CupSoda,
  'wheat': Wheat,
  'package': Package,
  'soup': Soup,
  'croissant': Croissant,
  'utensils': Utensils,
  'wrench': Wrench,
  'hammer': Hammer,
  'droplet': Droplet,
  'scissors': Scissors,
  'sparkles': Sparkles,
  'shirt': Shirt,
  'footprints': Footprints,
  'watch': Watch,
  'cpu': Cpu,
  'smartphone': Smartphone,
  'laptop': Laptop,
  'plug': Plug,
  'battery': Battery,
  'pill': Pill,
  'syringe': Syringe,
  'stethoscope': Stethoscope,
}
