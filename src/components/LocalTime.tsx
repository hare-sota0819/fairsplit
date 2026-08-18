'use client'

import { useLocale } from 'next-intl'
import { useSyncExternalStore } from 'react'
import { formatLocalDateTime } from '@/lib/datetime'

const subscribeNever = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/**
 * Renders an instant in the DEVICE's timezone. Server components render
 * timestamps in the server's zone (UTC on Vercel), which is what made the
 * expense form show 7:31 AM to a user standing in Seoul at 4:41 PM. Until
 * hydration the UTC text is shown so SSR and the client agree.
 */
export function LocalTime({ iso }: { iso: string }) {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    clientSnapshot,
    serverSnapshot,
  )
  const locale = useLocale()
  const offset = hydrated ? new Date().getTimezoneOffset() : 0
  return (
    <time dateTime={iso} data-testid="local-time">
      {formatLocalDateTime(new Date(iso), offset, locale)}
    </time>
  )
}
