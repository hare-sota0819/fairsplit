'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Money } from '@/components/Money'

export interface BreakdownRowView {
  key: string
  /** "Travel card", "On the spot", "Sota's cash" — already resolved. */
  label: string
  /** "100 JPY = 913 KRW", or the same-currency note. Never omitted. */
  rate: string
  /** Spend-currency figure, formatted. Null on a same-currency trip. */
  spend: string | null
  /** Settlement-currency figure, formatted. */
  settlement: string
}

/**
 * One of the two headline figures on home, with its rate breakdown behind a
 * chevron.
 *
 * Two things this screen is built to prevent:
 *
 *  1. A CONVERTED NUMBER WITH NO RATE. The same ¥11,000 is a different sum
 *     of won depending on whether it came off a card bought at 913 or was
 *     tapped at the till at 920, and a bare total cannot be checked against
 *     anything. Every row states the rate that produced it.
 *  2. THE ROWS NOT ADDING UP. The total shown here is the fold of the rows
 *     (see `rate-breakdown.ts`), not a second computation, so they cannot
 *     disagree — and the last row repeats the total so that is visible.
 *
 * The two cards are laid out by the caller as a grid so their heights match
 * whatever the labels translate to; everything here is `items-start` and
 * fixed-height at the top so a two-line label cannot shove the number down
 * in one card and not the other.
 */
export function TotalCard({
  label,
  hint,
  icon,
  primary,
  secondary,
  expandLabel,
  totalLabel,
  emptyLabel,
  rows,
  totalRow,
  testId,
}: {
  label: string
  /** One short clarifying line. Reserved height, so both cards match. */
  hint: string
  icon: React.ReactNode
  /** The big figure: spend currency when there is one, else settlement. */
  primary: string
  /** The smaller figure underneath, or null when it would just repeat. */
  secondary: string | null
  expandLabel: string
  totalLabel: string
  emptyLabel: string
  rows: BreakdownRowView[]
  /** The summed row. Computed by the caller from the same fold. */
  totalRow: BreakdownRowView
  testId: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="flex flex-col rounded-xl bg-card ring-1 ring-border-strong"
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-label={expandLabel}
        // The WHOLE card is the tap target, not just the chevron.
        className="flex flex-col items-start gap-1 p-4 text-left"
      >
        {/* Fixed height and a two-line clamp. Matching the CARDS' heights is
            not enough — a label that grows to three lines pushes its own
            number down while the other card's stays put, and the two figures
            stop lining up. Labels here are meant to be short (that is the
            brief); anything longer is clamped rather than allowed to shove
            the number, and the full text still reaches assistive tech
            through the button's aria-label. */}
        <span className="flex h-9 w-full items-start gap-1.5 text-xs font-medium text-muted-foreground">
          <span aria-hidden="true" className="shrink-0 pt-px">
            {icon}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 leading-tight">
            {label}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`size-4 shrink-0 pt-px transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
        <Money size="lg" className="text-foreground">
          {primary}
        </Money>
        {/* Always rendered, even when empty, so a card with no secondary
            figure is exactly as tall as one that has it. */}
        <span
          className="text-xs text-muted-foreground"
          data-testid={`${testId}-secondary`}
        >
          {secondary ?? ' '}
        </span>
        <span className="text-xs leading-tight text-muted-foreground">
          {hint}
        </span>
      </button>

      {open ? (
        <div
          className="flex flex-col gap-2 border-t border-border px-4 py-3"
          data-testid={`${testId}-breakdown`}
        >
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{emptyLabel}</p>
          ) : (
            <>
              {rows.map((row) => (
                <BreakdownLine key={row.key} row={row} />
              ))}
              <BreakdownLine row={{ ...totalRow, label: totalLabel }} total />
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * One row. The SPEND currency leads and the settlement figure sits under it,
 * smaller — the brief's rule, and the right one: the yen figure is what the
 * receipt said, the won figure is what it became.
 */
function BreakdownLine({
  row,
  total = false,
}: {
  row: BreakdownRowView
  total?: boolean
}) {
  return (
    <div
      className={`flex items-start justify-between gap-2 ${total ? 'border-t border-border pt-2 font-semibold' : ''}`}
      data-testid={total ? 'breakdown-total' : 'breakdown-row'}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs leading-tight">{row.label}</span>
        {/* The rate line used to sit here. The owner asked twice for these
            two cards to say only WHAT IT WAS PAID WITH — the row's label
            already names the wallet or the card, and the rate belongs on the
            expense, not on a summary. */}
      </span>
      <span className="flex shrink-0 flex-col items-end">
        {row.spend ? (
          <Money className="text-foreground">{row.spend}</Money>
        ) : null}
        {row.settlement ? (
          <span className="text-xs text-muted-foreground">
            {row.settlement}
          </span>
        ) : null}
      </span>
    </div>
  )
}
