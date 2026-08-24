'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useFormStatus } from 'react-dom'
import { cn } from '@/lib/utils'
import { LoadingOverlay } from './LoadingOverlay'
import { DoubleRule, LoadingRule, MiniShuttle } from './motion/rules'
import { nextLoader } from './loaders'
import { ARROW_ROW, Button } from './ui/button'

type ButtonProps = React.ComponentProps<typeof Button>

/** How long the closed ledger is held before the button returns to idle. */
const DONE_HOLD_MS = 1600

/**
 * Part 5 — every action shows that it is running. Placed inside a <form>
 * this picks the pending state up from `useFormStatus` automatically; pass
 * `pending` explicitly when the caller already has it from `useActionState`.
 *
 * THREE ACTS (SPEC-INTERACTIONS §3/§4). One button plays the whole
 * transaction, and there is no spinner and no tick anywhere in it:
 *
 *   idle     the primary action — ink text, a fixed 1px underline, and a
 *            trailing arrow whose gap opens on hover.
 *   loading  the label swaps to the busy line at 14px meta grey, and the
 *            UNDERLINE BECOMES A LOADING BAR: a 132px 1px track with an ink
 *            fill sweeping in from the left and out to the right.
 *   done     the label swaps to "written in" and the DOUBLE RULE is drawn
 *            left→right beneath it — the app's closed-ledger gesture — held
 *            for 1.6s before the button returns to idle.
 *
 * ON MOBILE the primary commit is the one filled surface in the app (§4): a
 * full-width bar framed by 1px ink rules top and bottom, no side borders,
 * paper background. While pressed or saving it INVERTS — ink ground, paper
 * text, 180ms — a stamp pressed into paper. Minimum tap height 48px.
 *
 * Secondary tiers keep their existing skin and get the same grammar in
 * miniature: a hairline shuttle while running, the double rule on success.
 *
 * IT ALSO RAISES THE LOADING OVERLAY when asked. Saving an expense is the
 * one moment that genuinely needs it — a server round trip you cannot take
 * back. `overlay={false}` for the small in-place saves (a rename, a toggle)
 * where taking the screen would be heavier than the action.
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
  className,
  ...props
  // `asChild` is refused outright: a submit control is a <button>, and the
  // primary commit renders a raw one that would pass the prop to the DOM.
}: Omit<ButtonProps, 'type' | 'asChild'> & {
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

  // The third act. A pending→settled edge closes the ledger and holds it;
  // nothing else can put the button into `done`.
  const [closed, setClosed] = useState(false)
  const ran = useRef(false)
  useEffect(() => {
    if (pending) {
      ran.current = true
      return
    }
    if (!ran.current) return
    ran.current = false
    setClosed(true)
    const timer = setTimeout(() => setClosed(false), DONE_HOLD_MS)
    return () => clearTimeout(timer)
  }, [pending])
  const done = closed && !pending

  // Redrawn per save, for the same reason as NavLoader's overlay: drawn once
  // on mount, a button would show the same figure for its whole life.
  // `pending` is the POINT of this dependency, not an accident: it is what
  // draws a new figure when a navigation starts. Without it the memo never
  // recomputes and the figure is fixed for the element's whole life.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const motif = useMemo(() => nextLoader(), [pending])

  const label = pending
    ? (busyLabel ?? t('writing'))
    : done
      ? t('written')
      : children

  const raisedOverlay =
    overlay && pending ? (
      <LoadingOverlay caption={overlayCaption ?? t('saving')} id={motif} />
    ) : null

  // The primary commit plays the full three acts on its own frame — but
  // only when it IS the form's primary action.
  //
  // `variant="default"` and a full-width size. The bar is full-width by
  // definition (§4), so putting it on a `size="sm"` control — a rename
  // sitting beside its own text field — would eat the whole row and
  // squash the field to nothing. Those take the text path below, which
  // still gives them the shuttle and the double rule.
  //
  // `statement` is excluded too: the auth screens' rows came from the
  // batch-3 drop verbatim and already read in this grammar; taking them
  // over with the commit bar would undo a design already signed off.
  const isPrimaryCommit =
    variant === 'default' && (size === 'hero' || size === 'touch')
  if (isPrimaryCommit) {
    return (
      <button
        type="submit"
        disabled={pending || disabled}
        aria-busy={pending}
        data-testid={testId}
        className={cn(
          // Mobile (§4): the full-width ink-framed bar. It is the one filled
          // surface in the app, and only while it is being pressed.
          'group/button flex min-h-12 w-full flex-col items-center justify-center border-y border-foreground bg-background px-0 py-[15px] text-base text-foreground outline-none select-none',
          'transition-[background-color,color,transform] duration-[180ms] ease-swift',
          'active:translate-y-px active:bg-foreground active:text-background',
          'focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:pointer-events-none',
          // Desktop (§3): no frame at all — the label carries the underline.
          'sm:min-h-0 sm:w-auto sm:items-start sm:border-y-0 sm:bg-transparent sm:py-0 sm:text-foreground sm:active:bg-transparent sm:active:text-foreground',
          pending &&
            'bg-foreground text-background sm:bg-transparent sm:text-[#8a8a8a]',
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            pending || done ? 'inline-flex items-baseline gap-2' : ARROW_ROW,
            // The fixed 1px underline of a §1 primary — desktop only; on the
            // bar the frame's own rules do that job.
            !pending && !done && 'sm:border-b sm:border-foreground sm:pb-[3px]',
            (pending || done) && 'text-sm',
          )}
        >
          <span>{label}</span>
          {!pending && !done ? (
            <span aria-hidden="true" className="hidden sm:inline">
              →
            </span>
          ) : null}
          {/* "적혔습니다 ══" — on the bar the double rule sits in the label. */}
          {done ? <DoubleRule className="w-6 sm:hidden" /> : null}
        </span>
        {/* The 132px rule line under a desktop primary: the underline that
            became a loading bar, then the closed ledger. */}
        {pending || done ? (
          <span className="mt-[9px] hidden w-[132px] sm:block">
            {pending ? <LoadingRule /> : <DoubleRule />}
          </span>
        ) : null}
        {raisedOverlay}
      </button>
    )
  }

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending || disabled}
      aria-busy={pending}
      data-testid={testId}
      className={className}
      {...props}
    >
      {pending ? <MiniShuttle /> : null}
      {label}
      {done ? <DoubleRule className="w-6" /> : null}
      {raisedOverlay}
    </Button>
  )
}
