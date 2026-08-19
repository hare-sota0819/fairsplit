import { cn } from '@/lib/utils'

/**
 * The one way money reaches the screen.
 *
 * Two rules the design brief is strict about:
 *  - tabular numerals, so columns of figures line up and a changing amount
 *    does not make the row jitter;
 *  - a balance's direction is NEVER carried by colour alone. Every signed
 *    figure is labelled in words ("To receive" / "To pay"), so it survives
 *    greyscale, colour-blindness and a glance in sunlight.
 */
export function Money({
  children,
  className,
  size = 'md',
}: {
  children: React.ReactNode
  className?: string
  size?: 'md' | 'lg' | 'hero'
}) {
  return (
    <span
      className={cn(
        'tabular-nums',
        size === 'hero' && 'text-4xl font-bold',
        size === 'lg' && 'text-xl font-semibold',
        size === 'md' && 'font-medium',
        className,
      )}
    >
      {children}
    </span>
  )
}

export type BalanceDirection = 'owed' | 'owing' | 'even'

export function directionOf(net: bigint): BalanceDirection {
  return net > 0n ? 'owed' : net < 0n ? 'owing' : 'even'
}

export const DIRECTION_STYLE: Record<BalanceDirection, string> = {
  owed: 'text-positive',
  owing: 'text-negative',
  even: 'text-muted-foreground',
}

/**
 * A directional balance: a one-word label beside the amount, tinted by
 * direction.
 *
 * Colour never carries the meaning on its own — the LABEL does, which is why
 * it is a required prop. The earlier arrow-plus-sentence form was accessible
 * too, but it was too heavy for dense lists, and running two treatments for
 * one concept made users learn it twice. Signs are deliberately absent: next
 * to the ₩ glyph a minus reads as part of the symbol.
 */
export function BalanceAmount({
  direction,
  amount,
  label,
  size = 'md',
  className,
}: {
  direction: BalanceDirection
  amount: string
  /** One word naming the direction, e.g. "To receive". Never optional. */
  label: string
  size?: 'md' | 'lg' | 'hero'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5',
        DIRECTION_STYLE[direction],
        className,
      )}
    >
      <span className="text-xs font-medium">{label}</span>
      <Money size={size}>{amount}</Money>
    </span>
  )
}
