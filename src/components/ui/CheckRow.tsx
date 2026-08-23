'use client'

import { cn } from '@/lib/utils'

/**
 * PARTICIPANT PICKING (SPEC-INTERACTIONS §5).
 *
 * THE WHOLE ROW IS THE TAP TARGET, minimum 44px — not a 14px box you have
 * to hit. The mark is a 14px square with a 1px border (ink when checked,
 * #c8c8c8 when not) whose inner ink square, inset 2px, scales 0→1 over
 * .22s: the tick fills in rather than appearing.
 *
 * Unchecking greys the row AT ONCE — the name to #a8a8a8, the amount to
 * #c8c8c8 — so "not included" is legible without reading the box. Rows are
 * separated by hairlines and wash #f2f2f2 on hover; press is the ink sink.
 */
export function CheckRow({
  checked,
  onCheckedChange,
  label,
  amount,
  disabled,
  testId,
  className,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  label: React.ReactNode
  /** The person's share, if this row carries one. */
  amount?: React.ReactNode
  disabled?: boolean
  testId?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'flex min-h-11 w-full items-center gap-3.5 border-t border-[#e4e4e4] px-1 py-[13px] text-left',
        'transition-[background-color,transform] duration-[250ms] ease-swift',
        'hover:bg-[#f2f2f2] active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative size-3.5 flex-none border transition-[border-color] duration-[220ms] ease-swift',
          checked ? 'border-foreground' : 'border-[#c8c8c8]',
        )}
      >
        <span
          className="absolute inset-0.5 bg-foreground transition-transform duration-[220ms] ease-swift"
          style={{ transform: `scale(${checked ? 1 : 0})` }}
        />
      </span>
      <span
        className={cn(
          'flex-1 text-[15px] transition-colors duration-[220ms]',
          checked ? 'text-foreground' : 'text-[#a8a8a8]',
        )}
      >
        {label}
      </span>
      {amount !== undefined ? (
        <span
          className={cn(
            'text-[13.5px] tabular-nums transition-colors duration-[220ms]',
            checked ? 'text-foreground' : 'text-[#c8c8c8]',
          )}
        >
          {amount}
        </span>
      ) : null}
    </button>
  )
}
