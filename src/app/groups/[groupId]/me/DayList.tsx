'use client'

import { useSyncExternalStore } from 'react'
import { Money } from '@/components/Money'
import { toLocalDateKey } from '@/lib/datetime'

export interface SpendingRow {
  id: string
  title: string
  /** Absolute instant — the day it belongs to is a device-local question. */
  timestampIso: string
  amount: string
  personal: boolean
}

const subscribeNever = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/**
 * Per-day spending list. Grouping happens on the client because "which day
 * was that?" depends on the device's timezone, not the server's — a 23:30
 * dinner in Seoul is filed under the next day if the server (UTC) decides.
 */
export function DayList({
  rows,
  personalBadge,
}: {
  rows: SpendingRow[]
  personalBadge: string
}) {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    clientSnapshot,
    serverSnapshot,
  )
  const offset = hydrated ? new Date().getTimezoneOffset() : 0
  const days = new Map<string, SpendingRow[]>()
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
              <li
                key={row.id}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3"
              >
                <span>
                  {row.title}
                  {row.personal ? (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {personalBadge}
                    </span>
                  ) : null}
                </span>
                <Money>{row.amount}</Money>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
