import { cn } from '@/lib/utils'

/**
 * THE CLOSED-LEDGER GESTURE (SPEC-INTERACTIONS §3, SPEC-LOADERS).
 *
 * Two 1px ink lines 2px apart, each drawn left→right over .4s, the second
 * .12s behind the first. This is how the app says "done" — there is no
 * checkmark icon anywhere, and no green.
 *
 * Draws in `currentColor`, so it inherits whatever ink the surrounding
 * label uses (ink on paper, paper on the inverted mobile bar).
 */
export function DoubleRule({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('block', className)}>
      <span className="sem-rule block h-px bg-current" />
      <span className="sem-rule sem-rule-late mt-0.5 block h-px bg-current" />
    </span>
  )
}

/**
 * THE UNDERLINE TURNED LOADING BAR (SPEC-INTERACTIONS §3).
 *
 * 1px track (#ececec), 1px ink fill animating scaleX 0→1 from the left then
 * 1→0 from the right, 1s infinite, cubic-bezier(.45,0,.4,1). The commit
 * button's own underline becomes this while the action runs — no spinner.
 *
 * The track literal is the spec's #ececec; dark theme gets the mirrored
 * value so the bar is still visible on ink paper.
 */
export function LoadingRule({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block h-px overflow-hidden bg-[#ececec] dark:bg-[#2c2c2c]',
        className,
      )}
    >
      <span className="sem-load absolute inset-0 block bg-current" />
    </span>
  )
}

/**
 * THE INLINE MINI SHUTTLE (SPEC-LOADERS, "인라인 배치").
 *
 * A 56px hairline whose ink segment shuttles left→right. This is what
 * replaced the spinner: contextual waits are stated where the action
 * happened, at the weight of a rule, not a rotating disc.
 */
export function MiniShuttle({
  className,
  lag = false,
}: {
  className?: string
  /** Second and later shuttles on one screen start .4s behind the first. */
  lag?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-block w-14 align-middle', className)}
    >
      <span className="block h-px bg-[#ececec] dark:bg-[#2c2c2c]" />
      <span
        className={cn(
          'sem-mini absolute top-0 left-0 block h-px bg-current',
          lag && 'sem-mini-lag',
        )}
      />
    </span>
  )
}

/**
 * THE CONTEXTUAL LEDGER (SPEC-LOADERS, "영수증 스캔 / 체크포인트").
 *
 * A statement filling itself in: two rows whose dotted leaders FLOW while
 * the work runs, closed by a static double rule. This is the figure for
 * work that has no honest percentage to report — reading a receipt,
 * closing a checkpoint — and it sits inline, where the action happened,
 * rather than taking the screen.
 */
export function LedgerLeader({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex w-[170px] flex-col gap-[13px]', className)}
    >
      {[
        { label: 40, amount: 24, lag: false },
        { label: 30, amount: 30, lag: true },
      ].map((row) => (
        <span key={row.label} className="flex items-center gap-2">
          <span
            className="h-px bg-current opacity-20"
            style={{ width: `${row.label}px` }}
          />
          <span
            className={cn(
              'sem-leader sem-leader-flow h-px flex-1 opacity-30',
              row.lag && '[animation-delay:0.2s]',
            )}
          />
          <span
            className="h-px bg-current opacity-20"
            style={{ width: `${row.amount}px` }}
          />
        </span>
      ))}
      <span className="mt-0.5 block">
        <span className="block h-px bg-current" />
        <span className="mt-0.5 block h-px bg-current" />
      </span>
    </span>
  )
}
