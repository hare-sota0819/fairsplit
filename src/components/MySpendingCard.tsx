import { ChevronDown } from 'lucide-react'
import { Money } from '@/components/Money'
import { NavLink } from '@/components/NavLoader'
import type { MySpendingRow } from '@/lib/my-spending'

/**
 * "My spending", on home: one big number that opens into the expenses
 * behind it (owner sketch, 2026-08-22).
 *
 * The point of the fold is that a total on its own is not checkable — "did
 * I really spend that?" is answered by the list, in purchase order with the
 * most recent at the top, and every row opens its receipt. Only the first
 * few are shown; the rest are one tap away on the full screen rather than
 * pushing the settlement figures below off the bottom of home.
 *
 * A plain <details>: no client component, no hydration, and the fold still
 * works with JavaScript unavailable.
 */
export function MySpendingCard({
  groupId,
  title,
  total,
  rows,
  labels,
  visibleCount = 4,
}: {
  groupId: string
  title: string
  total: string
  rows: MySpendingRow[]
  labels: {
    toggle: string
    more: string
    personal: string
    /** Shown in place of the list when nothing has been spent yet. */
    empty: string
  }
  visibleCount?: number
}) {
  const shown = rows.slice(0, visibleCount)
  const hidden = rows.length - shown.length

  return (
    <section className="flex flex-col gap-2" data-testid="home-spending">
      <h2 className="text-sm font-semibold">{title}</h2>
      <details className="group rounded-xl border border-border">
        <summary
          className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4"
          aria-label={labels.toggle}
          data-testid="home-spending-toggle"
        >
          <span data-testid="home-spending-total">
            <Money size="hero">{total}</Money>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-5 shrink-0 text-chevron transition-transform group-open:rotate-180"
          />
        </summary>

        {rows.length === 0 ? (
          <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {labels.empty}
          </p>
        ) : (
          <ul
            className="divide-y divide-border border-t border-border text-sm"
            data-testid="home-spending-rows"
          >
            {shown.map((row) => (
              <li key={row.id}>
                <NavLink
                  href={`/groups/${groupId}/expenses/${row.id}`}
                  caption={labels.toggle}
                  testId="home-spending-row"
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-[background-color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted"
                >
                  <span className="min-w-0 truncate">
                    {row.title}
                    {row.personal ? (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {labels.personal}
                      </span>
                    ) : null}
                  </span>
                  <Money className="shrink-0">{row.amount}</Money>
                </NavLink>
              </li>
            ))}
            {hidden > 0 ? (
              <li>
                <NavLink
                  href={`/groups/${groupId}/me`}
                  caption={labels.toggle}
                  testId="home-spending-more"
                  className="flex min-h-12 items-center justify-center px-4 py-3 text-sm font-medium text-primary transition-colors duration-fast hover:bg-muted"
                >
                  {labels.more}
                </NavLink>
              </li>
            ) : null}
          </ul>
        )}
      </details>
    </section>
  )
}
