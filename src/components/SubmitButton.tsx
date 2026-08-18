'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useFormStatus } from 'react-dom'
import { LoadingOverlay } from './LoadingOverlay'
import { Spinner } from './loaders'
import { nextLoader } from './loaders'
import { Button } from './ui/button'

type ButtonProps = React.ComponentProps<typeof Button>

/**
 * Part 5 — every action shows that it is running. Placed inside a <form>
 * this picks the pending state up from `useFormStatus` automatically; pass
 * `pending` explicitly when the caller already has it from
 * `useActionState`. Everything else is a shadcn Button, so press, focus and
 * disabled states come from the design system rather than from here.
 *
 * IT ALSO RAISES THE LOADING OVERLAY. Saving an expense is the one moment
 * that genuinely needs it — a server round trip you cannot take back — and it
 * was the one moment that never showed one, because the overlay was wired to
 * navigation only. A spinner inside the button is not enough feedback when
 * the whole screen is about to change underneath you.
 *
 * `overlay={false}` for the small in-place saves (a rename, a toggle) where
 * taking the screen would be heavier than the action.
 */
export function SubmitButton({
  children,
  pending: pendingProp,
  busyLabel,
  disabled,
  testId,
  variant = 'default',
  size = 'touch',
  overlay = false,
  overlayCaption,
  ...props
}: Omit<ButtonProps, 'type'> & {
  pending?: boolean
  busyLabel?: string
  testId?: string
  /** Raise the full-screen indicator while this action runs. */
  overlay?: boolean
  overlayCaption?: string
}) {
  const status = useFormStatus()
  const t = useTranslations('loading')
  const pending = pendingProp ?? status.pending
  // Redrawn per save, for the same reason as NavLoader's overlay: drawn once
  // on mount, a button would show the same figure for its whole life.
  // `pending` is the POINT of this dependency, not an accident: it is what
  // draws a new figure when a navigation starts. Without it the memo never
  // recomputes and the figure is fixed for the element's whole life.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const motif = useMemo(() => nextLoader(), [pending])
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending || disabled}
      aria-busy={pending}
      data-testid={testId}
      {...props}
    >
      {pending ? <Spinner /> : null}
      {pending && busyLabel ? busyLabel : children}
      {overlay && pending ? (
        <LoadingOverlay
          caption={overlayCaption ?? t('saving')}
          id={motif}
        />
      ) : null}
    </Button>
  )
}
