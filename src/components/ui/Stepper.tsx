'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { QuantityRoll } from '@/components/motion/Odometer'

/**
 * THE STEPPER (SPEC-INTERACTIONS §8).
 *
 * − and + are BARE GLYPHS, 19px meta grey, inking on hover — no boxes, no
 * icons, no borders. Their tap zone is 10-12px of padding pulled back out
 * of the layout with a negative margin, so the control still measures as
 * two glyphs while staying comfortably tappable.
 *
 * The quantity is a serif figure ROLLING vertically in a 30px-tall window
 * (§8, and the app-wide rule that numbers never swap instantly).
 *
 * IT IS STILL TYPEABLE. The Phase-4A brief asked for both — a stepper alone
 * is slow past three, a keyboard alone is slow for one more beer — so the
 * figure hands over to a real number input the moment it takes focus, and
 * hands back when it loses it. The input is always mounted, so anything
 * addressing it by test id still finds it.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max,
  testId,
  ariaLabel,
  className,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  testId?: string
  ariaLabel: string
  className?: string
}) {
  const t = useTranslations('expenses.form')
  const [typing, setTyping] = useState(false)
  const clamp = (next: number): number =>
    Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, next))

  const glyph =
    'px-3 py-2.5 -mx-3 -my-2.5 text-[19px] leading-none text-[#8a8a8a] transition-[color,transform] duration-[200ms] ease-swift hover:text-foreground active:translate-y-px disabled:text-[#c8c8c8] disabled:pointer-events-none'

  return (
    <span className={cn('flex items-center gap-5', className)}>
      <button
        type="button"
        className={glyph}
        aria-label={t('qtyDown')}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
        data-testid={testId ? `${testId}-down` : undefined}
      >
        −
      </button>
      <span className="relative inline-flex h-[30px] min-w-[34px] justify-center">
        {typing ? null : (
          <QuantityRoll
            value={value}
            max={Math.max(max ?? 9, 9)}
            className="text-2xl"
          />
        )}
        <input
          inputMode="numeric"
          value={String(value)}
          aria-label={ariaLabel}
          onFocus={(event) => {
            setTyping(true)
            event.currentTarget.select()
          }}
          onBlur={() => setTyping(false)}
          onChange={(event) => {
            const parsed = Number(event.target.value.replace(/\D/g, ''))
            onChange(
              clamp(Number.isFinite(parsed) && parsed > 0 ? parsed : min),
            )
          }}
          className={cn(
            'absolute inset-0 w-full border-0 bg-transparent p-0 text-center font-heading text-2xl leading-[30px] tabular-nums text-foreground outline-none',
            typing ? 'opacity-100' : 'opacity-0',
          )}
          data-testid={testId}
        />
      </span>
      <button
        type="button"
        className={glyph}
        aria-label={t('qtyUp')}
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(clamp(value + 1))}
        data-testid={testId ? `${testId}-up` : undefined}
      >
        +
      </button>
    </span>
  )
}
