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
  /** Reports the dismissal so a container can drop the banner's own slot
   *  rather than leave an empty shell behind. Optional, and unused since
   *  the chat transcript that needed it went (2026-08-21) — home renders
   *  the banner standalone and its local `dismissed` state below hides the
   *  content either way. */
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
