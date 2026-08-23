'use client'

import { useSyncExternalStore } from 'react'
import { Money } from '@/components/Money'
import { NavLink } from '@/components/NavLoader'
import { toLocalDateKey } from '@/lib/datetime'
import type { MySpendingRow } from '@/lib/my-spending'

const subscribeNever = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/**
 * Per-day spending list. Grouping happens on the client because "which day
 * was that?" depends on the device's timezone, not the server's — a 23:30
 * dinner in Seoul is filed under the next day if the server (UTC) decides.
 */
export function DayList({
  groupId,
  rows,
  personalBadge,
  openCaption,
}: {
  groupId: string
  rows: MySpendingRow[]
  personalBadge: string
  /** The loading caption while a row's receipt opens. */
  openCaption: string
}) {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    clientSnapshot,
    serverSnapshot,
  )
  const offset = hydrated ? new Date().getTimezoneOffset() : 0
  const days = new Map<string, MySpendingRow[]>()
  for (const row of rows) {
    const key = toLocalDateKey(new Date(row.timestampIso), offset)
    days.set(key, [...(days.get(key) ?? []), row])
  }

  return (
    <>
      {[...days].map(([day, dayRows]) => (
        <section key={day} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground">{day}</h2>
          <ul className="-mx-5 divide-y divide-border text-sm">
            {dayRows.map((row) => (
              <li key={row.id}>
                {/* A row is the way into its receipt — where the expense
                    can be read line by line and CORRECTED (owner,
                    2026-08-22). Listing what you spent without a way to fix
                    it left this screen read-only for no reason: the detail
                    screen it now opens has had edit, cancel and the
                    bank-statement correction all along, and nothing on this
                    screen linked to it. */}
                <NavLink
                  href={`/groups/${groupId}/expenses/${row.id}`}
                  caption={openCaption}
                  testId="spending-row"
                  className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 transition-[background-color,transform] duration-fast ease-swift hover:bg-muted active:translate-y-px active:bg-muted"
                >
                  <span className="min-w-0 truncate">
                    {row.title}
                    {row.personal ? (
                      <span className="ml-2 border border-[#e4e4e4] px-2 py-0.5 text-xs text-[#8a8a8a]">
                        {personalBadge}
                      </span>
                    ) : null}
                  </span>
                  <Money className="shrink-0">{row.amount}</Money>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
