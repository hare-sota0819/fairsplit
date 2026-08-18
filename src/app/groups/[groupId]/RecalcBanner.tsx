'use client'

import { useState, useTransition } from 'react'
import { Spinner } from '@/components/loaders'
import { Button } from '@/components/ui/button'

/**
 * "Someone's exchange records moved the numbers." Dismissing is a one-way,
 * per-member flag, and the banner removes itself the moment the write is
 * confirmed — no route refresh to wait on (a server action does not
 * re-render the segment it was fired from). It stays mounted, spinner
 * showing, until then: hiding first would let a page reload cancel the
 * in-flight write and the banner would come back.
 */
export function RecalcBanner({
  action,
  groupId,
  message,
  dismissLabel,
  onDismissed,
}: {
  action: (formData: FormData) => Promise<void>
  groupId: string
  message: string
  dismissLabel: string
  /** Chat-first entry (Task 5): this banner now renders as an assistant
   *  bubble parked in the transcript's message list. Once dismissed, the
   *  bubble itself should disappear rather than leave an empty shell behind
   *  — the transcript owns that removal, so this component reports the
   *  moment rather than doing it. Optional so the banner still works
   *  standalone (its local `dismissed` state below still hides its own
   *  content either way). */
  onDismissed?: () => void
}) {
  const [dismissed, setDismissed] = useState(false)
  const [pending, startTransition] = useTransition()
  if (dismissed) {
    return null
  }
  return (
    <div
      className="rounded-xl bg-notice-soft p-4 text-sm text-foreground"
      data-testid="recalc-banner"
    >
      <p>{message}</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          startTransition(async () => {
            const formData = new FormData()
            formData.set('groupId', groupId)
            await action(formData)
            setDismissed(true)
            onDismissed?.()
          })
        }
        className="mt-2 -ml-2.5"
        data-testid="recalc-dismiss"
      >
        {pending ? <Spinner /> : null}
        {dismissLabel}
      </Button>
    </div>
  )
}
