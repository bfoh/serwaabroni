import type { ReactElement } from 'react'

interface ProductIconProps {
  category: string
  size?: number
  className?: string
}

export default function ProductIcon({ category, size = 32, className = '' }: ProductIconProps) {
  const strokeWidth = 2
  const color = '#1A150D'

  const icons: Record<string, ReactElement> = {
    Dairy: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="8" y="10" width="16" height="18" rx="1" stroke={color} strokeWidth={strokeWidth} />
        <path d="M11 10V7C11 6 12 5 13 5H19C20 5 21 6 21 7V10" stroke={color} strokeWidth={strokeWidth} />
        <line x1="12" y1="14" x2="20" y2="14" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Groceries: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="6" y="8" width="20" height="22" rx="2" stroke={color} strokeWidth={strokeWidth} />
        <path d="M12 8V5C12 4 13 3 14 3H18C19 3 20 4 20 5V8" stroke={color} strokeWidth={strokeWidth} />
        <line x1="6" y1="14" x2="26" y2="14" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Beverages: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <path d="M10 6L12 28H20L22 6" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
        <ellipse cx="16" cy="6" rx="6" ry="2" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Cooking: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <path d="M10 10C10 10 8 16 8 20C8 24 11 27 16 27C21 27 24 24 24 20C24 16 22 10 22 10" stroke={color} strokeWidth={strokeWidth} />
        <ellipse cx="16" cy="10" rx="6" ry="2" stroke={color} strokeWidth={strokeWidth} />
        <path d="M16 4V2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    ),
    Grains: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <path d="M8 12L16 6L24 12V26H8V12Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
        <path d="M12 26V18H20V26" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Canned: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="9" y="6" width="14" height="22" rx="2" stroke={color} strokeWidth={strokeWidth} />
        <ellipse cx="16" cy="6" rx="7" ry="2" stroke={color} strokeWidth={strokeWidth} />
        <line x1="9" y1="22" x2="23" y2="22" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Noodles: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="6" y="10" width="20" height="16" rx="1" stroke={color} strokeWidth={strokeWidth} />
        <path d="M6 14H26" stroke={color} strokeWidth={strokeWidth} />
        <path d="M10 10V6M16 10V6M22 10V6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    ),
    Bakery: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <path d="M6 18C6 12 10 8 16 8C22 8 26 12 26 18V26H6V18Z" stroke={color} strokeWidth={strokeWidth} />
        <path d="M10 14C12 12 20 12 22 14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    ),
    default: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="7" y="7" width="18" height="18" rx="2" stroke={color} strokeWidth={strokeWidth} />
        <circle cx="16" cy="16" r="4" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
  }

  return icons[category] || icons.default
}
