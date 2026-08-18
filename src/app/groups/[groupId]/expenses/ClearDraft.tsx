'use client'

import { useEffect } from 'react'

/**
 * Renders nothing; drops one parked draft. Mounted by the expense detail page
 * only when it was reached by a save that actually succeeded (the redirect
 * carries ?created=1 or ?saved=1), so a failed save keeps everything typed.
 */
export function ClearDraft({ storageKey }: { storageKey: string }) {
  useEffect(() => {
    try {
      sessionStorage.removeItem(storageKey)
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }, [storageKey])
  return null
}
