'use client'

import { useState, useTransition } from 'react'
import { Spinner } from '@/components/loaders'

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
      // A STATEMENT LINE, NOT A COLOURED CARD (FIXES §2). The beige fill was
      // the only chromatic surface left outside the destructive red, and a
      // notice does not need a colour to be a notice: two ink rules and the
      // sentence between them say it in the app's own voice.
      className="border-y border-[#141414] bg-transparent py-3"
      data-testid="recalc-banner"
    >
      <p className="text-sm text-foreground">{message}</p>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
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
          className="inline-flex items-center gap-2 text-[13px] text-[#a8a8a8] transition-colors duration-fast ease-swift outline-none select-none hover:text-[#565656] active:translate-y-px disabled:cursor-default"
          data-testid="recalc-dismiss"
        >
          {pending ? <Spinner /> : null}
          {dismissLabel}
        </button>
      </div>
    </div>
  )
}
