import { Money } from '@/components/Money'
import { Odometer } from '@/components/motion/Odometer'
import { NavLink } from '@/components/NavLoader'
import type { MySpendingRow } from '@/lib/my-spending'

/**
 * "My spending", on home: one statement row that opens into the expenses
 * behind it (owner sketch, 2026-08-22; restated by FIXES §5).
 *
 * IT IS A ROW, NOT A CARD. The bordered box and its chevron are gone: the
 * line reads "내 소비 ····· ₩0" — meta-grey label, a dotted leader on a 7px
 * pitch, and the figure in Newsreader at the right margin, rolling per
 * digit column when it changes. The whole row is the tap target (44px).
 *
 * The point of the fold is that a total on its own is not checkable — "did
 * I really spend that?" is answered by the list, in purchase order with the
 * most recent at the top, and every row opens its receipt. Opened, the list
 * is an INDENTED BLOCK BEHIND A LEFT HAIRLINE — the same expansion grammar
 * as the expense feed. Only the first few are shown; the rest are one tap
 * away on the full screen rather than pushing the settlement figures below
 * off the bottom of home.
 *
 * A plain <details>: no client component for the fold, no hydration, and it
 * still works with JavaScript unavailable.
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
    <section data-testid="home-spending">
      <details>
        <summary
          className="flex min-h-11 cursor-pointer list-none items-baseline gap-2.5 py-2"
          aria-label={labels.toggle}
          data-testid="home-spending-toggle"
        >
          <h2 className="text-sm text-[#8a8a8a]">{title}</h2>
          {/* The leader: 1px dots on a 7px pitch, #c8c8c8. */}
          <span
            aria-hidden="true"
            className="sem-leader h-px flex-1 -translate-y-[3px] text-[#c8c8c8]"
          />
          <span data-testid="home-spending-total">
            <Odometer
              value={total}
              line={26}
              className="font-heading text-[22px] text-foreground"
            />
          </span>
        </summary>

        {/* The expansion: a left hairline with the detail set in behind it. */}
        <div className="mt-3 border-l border-[#e4e4e4] pl-[18px]">
          {rows.length === 0 ? (
            <p className="py-4 text-sm text-[#8a8a8a]">{labels.empty}</p>
          ) : (
            <ul className="text-sm" data-testid="home-spending-rows">
              {shown.map((row) => (
                <li key={row.id}>
                  <NavLink
                    href={`/groups/${groupId}/expenses/${row.id}`}
                    caption={labels.toggle}
                    testId="home-spending-row"
                    className="flex min-h-11 items-baseline gap-2.5 py-2.5 transition-[background-color,transform] duration-fast ease-swift hover:bg-muted active:translate-y-px"
                  >
                    <span className="min-w-0 truncate">
                      {row.title}
                      {row.personal ? (
                        <span className="ml-2 border border-[#e4e4e4] px-2 py-0.5 text-xs text-[#8a8a8a]">
                          {labels.personal}
                        </span>
                      ) : null}
                    </span>
                    <span
                      aria-hidden="true"
                      className="sem-leader h-px flex-1 -translate-y-[3px] text-[#c8c8c8]"
                    />
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
                    className="flex min-h-11 items-center bg-[linear-gradient(var(--foreground),var(--foreground))] bg-[length:0%_1px] bg-[position:left_bottom_11px] bg-no-repeat text-[15px] text-[#8a8a8a] transition-[background-size,color] duration-fast ease-swift hover:bg-[length:100%_1px] hover:text-foreground"
                  >
                    {labels.more}
                  </NavLink>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </details>
    </section>
  )
}
