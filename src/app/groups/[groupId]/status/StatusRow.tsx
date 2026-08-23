'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  BalanceAmount,
  DIRECTION_STYLE,
  Money,
  type BalanceDirection,
} from '@/components/Money'
import { NavLink } from '@/components/NavLoader'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

export interface PairwiseLine {
  id: string
  /** A full sentence naming both sides, e.g. "owes Minsu" — Status shows a
   *  THIRD PARTY's ledger, not the viewer's, so the row's implicit subject
   *  (the member whose row this is) is not enough on its own; the verb
   *  says which way the money moves. Unlike home/with-member, the amount
   *  next to it is plain (no "To pay"/"To receive" label) to avoid saying
   *  the direction twice. */
  text: string
  amount: string
  direction: BalanceDirection
  /** Set only on the VIEWER's own row: opens the two-person shared history
   *  with this line's counterpart — home's old per-person row (`pairwise-
   *  link`) moved here (Task 5, app-shell restructure) since that was its
   *  only entry point. Other members' rows leave this unset: "member X's
   *  view of member Y" is not a screen the viewer can open. */
  href?: string
}

/**
 * Part 4 — a net balance alone does not tell three people who pays whom, so
 * every row opens onto its pairwise ledger.
 */
export function StatusRow({
  name,
  leftLabel,
  netAmount,
  netDirection,
  cashCell,
  lines,
  settledLabel,
  expandLabel,
  balanceLabels,
}: {
  name: string
  leftLabel: string | null
  netAmount: string
  netDirection: BalanceDirection
  cashCell: React.ReactNode
  lines: PairwiseLine[]
  settledLabel: string
  expandLabel: string
  balanceLabels: Record<BalanceDirection, string>
}) {
  const [open, setOpen] = useState(false)
  const tLoading = useTranslations('loading')
  return (
    <li data-testid="status-row">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          aria-label={expandLabel}
          className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:translate-y-px active:bg-muted"
          data-testid="status-row-toggle"
        >
          <span className="flex min-w-0 items-center">
            <span className="font-semibold">
              {name}
              {leftLabel ? (
                <span className="ml-2 border border-[#e4e4e4] px-2 py-0.5 text-xs font-normal text-[#8a8a8a]">
                  {leftLabel}
                </span>
              ) : null}
            </span>
          </span>
          <span className="flex items-center gap-3">
            {netDirection === 'even' ? (
              <span className="text-sm text-muted-foreground">{netAmount}</span>
            ) : (
              <BalanceAmount
                direction={netDirection}
                amount={netAmount}
                label={balanceLabels[netDirection]}
                size="lg"
              />
            )}
            {cashCell}
            <ChevronDown
              aria-hidden="true"
              className={`size-4 shrink-0 text-chevron transition-transform ${
                open ? 'rotate-180' : ''
              }`}
            />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul
            className="flex flex-col gap-2 border-t border-border bg-muted/40 px-5 py-3 text-sm"
            data-testid="pairwise-breakdown"
          >
            {lines.length === 0 ? (
              <li className="text-muted-foreground">{settledLabel}</li>
            ) : (
              lines.map((line) => {
                // A settled line's text is already a full sentence ("Settled
                // with Bob") — there is no number to state next to it, so
                // nothing renders on the trailing side (contrast the
                // owing/owed lines, which are an arrow+name with the amount
                // stated separately).
                const trailing =
                  line.direction === 'even' ? null : (
                    <Money className={DIRECTION_STYLE[line.direction]}>
                      {line.amount}
                    </Money>
                  )
                return line.href ? (
                  <li key={line.id}>
                    <NavLink
                      href={line.href}
                      caption={tLoading('withMember')}
                      testId="pairwise-link"
                      className="flex justify-between gap-3"
                    >
                      <span className="text-muted-foreground">{line.text}</span>
                      {trailing}
                    </NavLink>
                  </li>
                ) : (
                  <li key={line.id} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{line.text}</span>
                    {trailing}
                  </li>
                )
              })
            )}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
