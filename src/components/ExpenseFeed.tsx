'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Money } from '@/components/Money'
import { NavLink } from '@/components/NavLoader'
import { Badge } from '@/components/ui/badge'

export interface FeedItemView {
  key: string
  /** "Beer ×2" — the units THIS viewer took, not what the line held. */
  name: string
  /** The viewer's part of the line, in the expense's own currency. */
  amount: string
}

export interface FeedRowView {
  id: string
  title: string
  /** "Alice · 3 items · entered by Bob" */
  meta: string
  /**
   * WHAT THE VIEWER CONSUMED, in the expense's own currency — not the
   * receipt total. The feed answers "what did I have?", and on a shared
   * receipt those are different numbers.
   */
  amount: string
  /** The receipt total, stated inside the expanded row so it is not lost. */
  receiptTotal: string
  /** Rate-source chip text, or null when nothing was converted. */
  chip: string | null
  cancelled: boolean
  /** Where "open this expense" goes. */
  href: string
  items: FeedItemView[]
  /** "Split evenly, 3 people" — set only for an expense with no items. */
  evenSplit: string | null
  /** The viewer had no part in this one at all. */
  none: boolean
}

/**
 * The recent-expenses feed.
 *
 * Three things it does differently from the plain list it replaces:
 *
 *  1. TAPPING A ROW EXPANDS IT rather than leaving the screen. Glancing at
 *     the feed is a "what did we buy again?" question, and the answer is a
 *     line or two — not worth a page load and a way back. The full detail
 *     screen (edit, cancel, the bank-statement correction) is still one tap
 *     away from inside the expanded row, because otherwise home would have
 *     no route to it at all.
 *  2. IT SHOWS THREE. Home was growing without limit; the rest are behind
 *     one button. `initialCount` is not a hard ceiling on what exists, just
 *     on what is shown before asking.
 *  3. EVERY FIGURE IS THE VIEWER'S OWN. The row states what they consumed
 *     and the expansion lists only the lines they had. A receipt total tells
 *     you how big the table's bill was; this screen is for remembering what
 *     YOU ate, so the receipt total is demoted to one muted line inside.
 */
export function ExpenseFeed({
  rows,
  labels,
  initialCount = 3,
}: {
  rows: FeedRowView[]
  labels: {
    expand: string
    open: string
    /** Shown when the viewer had no part in the expense. */
    none: string
    /** Prefixes the muted receipt-total line. */
    receiptTotal: string
    /**
     * Already formatted with the hidden count. A FUNCTION cannot cross the
     * server/client boundary — passing one here threw the whole home screen
     * into its error boundary — and it does not need to: how many rows are
     * hidden is fixed by `rows.length - initialCount`, both known on the
     * server.
     */
    more: string
    less: string
  }
  initialCount?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const shown = expanded ? rows : rows.slice(0, initialCount)

  return (
    <>
      {/*
       * Flat list, not cards (Phase 4B). The reference puts rows straight on
       * the page with one full-bleed hairline between them; `-mx-5` cancels
       * the page gutter so the rule reaches both edges, and `px-5` puts the
       * content back where it was.
       */}
      <ul className="-mx-5 divide-y divide-border text-sm">
        {shown.map((row) => {
          const isOpen = open === row.id
          return (
            <li
              key={row.id}
              className={row.cancelled ? 'opacity-50' : ''}
              data-testid={row.cancelled ? 'feed-cancelled' : 'feed-row'}
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : row.id)}
                aria-expanded={isOpen}
                aria-label={labels.expand}
                // The whole row is the tap target, like every other
                // disclosure in the app.
                className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted"
              >
                <span
                  className={`min-w-0 truncate ${row.cancelled ? 'line-through' : ''}`}
                >
                  {row.title}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {row.meta}
                  </span>
                </span>
                <span className="ml-2 flex shrink-0 items-center gap-2">
                  {row.chip ? (
                    <Badge variant="secondary" data-testid="feed-rate-chip">
                      {row.chip}
                    </Badge>
                  ) : null}
                  <Money className={row.cancelled ? 'line-through' : ''}>
                    {row.amount}
                  </Money>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-chevron transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </span>
              </button>

              {isOpen ? (
                <div
                  className="flex flex-col gap-1.5 border-t border-border bg-muted/40 px-5 py-3 text-xs"
                  data-testid="feed-detail"
                >
                  {row.none ? (
                    <p className="text-muted-foreground">{labels.none}</p>
                  ) : null}
                  {row.evenSplit ? (
                    <p className="text-muted-foreground">{row.evenSplit}</p>
                  ) : null}
                  {row.items.map((item) => (
                    <span
                      key={item.key}
                      className="flex items-baseline justify-between gap-3"
                      data-testid="feed-item"
                    >
                      <span className="min-w-0">{item.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {item.amount}
                      </span>
                    </span>
                  ))}
                  <span className="text-muted-foreground">
                    {labels.receiptTotal} {row.receiptTotal}
                  </span>
                  <NavLink
                    href={row.href}
                    caption={labels.open}
                    className="mt-1 w-fit font-medium text-primary underline"
                    testId="feed-open"
                  >
                    {labels.open}
                  </NavLink>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {rows.length > initialCount ? (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          className="-mx-5 h-14 w-full border-b border-border text-sm font-medium text-primary transition-colors hover:bg-muted"
          data-testid="feed-show-more"
        >
          {expanded ? labels.less : labels.more}
        </button>
      ) : null}
    </>
  )
}
