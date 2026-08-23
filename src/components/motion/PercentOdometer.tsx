'use client'

import { cn } from '@/lib/utils'

/**
 * DETERMINATE PROGRESS (SPEC-LOADERS §C) — image upload, receipt OCR.
 *
 * Three serif digit columns rolling simultaneously and locking
 * hundreds→tens→ones. It is driven by the REAL percentage, so it lands
 * exactly on the value it is given and stops at 100 — it never keeps
 * rolling after completion, and it never invents progress it does not have.
 *
 * Same mechanical lag as the amount odometer (§8): the leading column
 * settles first, each column to its right 60ms slower and 40ms later.
 */

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
const LOCK = [
  { duration: 320, delay: 0 },
  { duration: 380, delay: 40 },
  { duration: 440, delay: 80 },
]

export function PercentOdometer({
  percent,
  size = 64,
  className,
}: {
  /** 0-100. Clamped and floored — this shows real progress only. */
  percent: number
  /** Type size in px. The spec's full-screen size is 64. */
  size?: number
  className?: string
}) {
  const value = Math.max(0, Math.min(100, Math.floor(percent)))
  const columns = [
    Math.floor(value / 100),
    Math.floor(value / 10) % 10,
    value % 10,
  ]
  return (
    <span
      className={cn('inline-flex', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span
        aria-hidden="true"
        className="flex font-heading leading-none tabular-nums text-foreground"
        style={{ fontSize: `${size}px` }}
      >
        {columns.map((digit, index) => (
          <span
            key={index}
            className="overflow-hidden"
            style={{ height: '1em' }}
          >
            <span
              className="flex flex-col ease-swift"
              style={{
                transform: `translateY(-${digit}em)`,
                transitionProperty: 'transform',
                transitionDuration: `${LOCK[index].duration}ms`,
                transitionDelay: `${LOCK[index].delay}ms`,
              }}
            >
              {DIGITS.map((glyph) => (
                <span key={glyph} style={{ height: '1em' }}>
                  {glyph}
                </span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </span>
  )
}
