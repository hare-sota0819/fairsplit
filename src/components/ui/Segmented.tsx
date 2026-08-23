'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * SEGMENTED CONTROL (SPEC-INTERACTIONS §7) — no boxes anywhere.
 *
 * The options are plain 15.5px text, ink when selected and #b8b8b8 when
 * not, and A SINGLE 1px INK UNDERLINE SLIDES beneath the selected one
 * (left and width both transitioning over .3s). Selection in this app is
 * always expressed as "where is the underline", never as a filled pill.
 *
 * The underline is measured rather than computed, because the options are
 * words of different lengths in two languages.
 */
export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  ariaLabel,
  className,
}: {
  options: { value: T; label: string; testId?: string }[]
  value: T
  onValueChange: (next: T) => void
  ariaLabel: string
  className?: string
}) {
  const items = useRef(new Map<string, HTMLButtonElement>())
  const [rule, setRule] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  })

  useEffect(() => {
    const measure = () => {
      const node = items.current.get(value)
      if (!node) return
      setRule({ left: node.offsetLeft, width: node.offsetWidth })
    }
    measure()
    // Fonts land after first paint, and the labels are the measurement.
    const observer = new ResizeObserver(measure)
    for (const node of items.current.values()) observer.observe(node)
    return () => observer.disconnect()
  }, [value, options])

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('relative inline-flex gap-9', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          data-testid={option.testId}
          ref={(node) => {
            if (node) items.current.set(option.value, node)
            else items.current.delete(option.value)
          }}
          onClick={() => onValueChange(option.value)}
          className={cn(
            'pb-1.5 text-[15.5px] transition-[color,transform] duration-[250ms] ease-swift active:translate-y-px',
            option.value === value ? 'text-foreground' : 'text-[#b8b8b8]',
          )}
        >
          {option.label}
        </button>
      ))}
      <span
        aria-hidden="true"
        className="absolute bottom-0 h-px bg-foreground transition-[left,width] duration-[300ms] ease-swift"
        style={{ left: rule.left, width: rule.width }}
      />
    </div>
  )
}
