import { useEffect, useState } from 'react'

interface OdometerProps {
  value: number
  prefix?: string
  className?: string
}

export default function Odometer({ value, prefix = '', className = '' }: OdometerProps) {
  const [displayValue, setDisplayValue] = useState(0)
  const digits = displayValue.toFixed(2).split('')

  useEffect(() => {
    const duration = 1500
    const startTime = performance.now()
    const startValue = displayValue
    const endValue = value

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = startValue + (endValue - startValue) * eased
      setDisplayValue(current)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className={`odometer ${className}`}>
      {prefix && (
        <span
          className="font-display text-ink mr-1"
          style={{ fontSize: '2.5rem', lineHeight: '3.5rem' }}
        >
          {prefix}
        </span>
      )}
      {digits.map((digit, i) => {
        if (digit === '.') {
          return (
            <span
              key={`dot-${i}`}
              className="font-display text-ink"
              style={{ fontSize: '2.5rem', lineHeight: '3.5rem', height: '3.5rem' }}
            >
              .
            </span>
          )
        }
        const numDigit = parseInt(digit)
        return (
          <div
            key={`col-${i}`}
            className="overflow-hidden"
            style={{ height: '3.5rem' }}
          >
            <div
              className="digit-column"
              style={{
                transform: `translateY(-${numDigit * 3.5}rem)`,
              }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <span
                  key={n}
                  className="font-display text-ink"
                  style={{ fontSize: '2.5rem', lineHeight: '3.5rem', height: '3.5rem' }}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
