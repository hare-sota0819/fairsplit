'use client'

import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A modal sheet: one question, its own fields, nothing else.
 *
 * The payment step had grown to five things visible at once — a shortfall
 * notice, a top-up offer, the portion list and two buttons — and the owner's
 * report was simply that it was too much to read. A dialog is how a screen
 * asks a follow-up without carrying the follow-up's controls around all the
 * time.
 *
 * Radix rather than a hand-rolled overlay: focus trapping, restoring focus to
 * the control that opened it, Escape, and `aria-modal` are the whole point,
 * and `radix-ui` is already a dependency.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  testId,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  closeLabel: string
  testId?: string
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            // `--scrim`/`--scrim-foreground` (globals.css) ARE the
            // teardown's scrim token — swapped in for the hardcoded
            // `bg-black/40` this used to carry. `--dur-base` + `ease-out`:
            // the measured pairing for opacity-only state changes (## Motion
            // tokens, row 1, 21 hits — the default).
            'fixed inset-0 z-50 bg-scrim',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'duration-base ease-out',
          )}
        />
        {/* Bottom sheet on a phone, centred card once there is room: the
            control that opens this sits low on a long form, and a centred
            card there means the answer appears nowhere near the question. */}
        <DialogPrimitive.Content
          data-testid={testId}
          className={cn(
            'fixed z-50 flex flex-col gap-4 bg-card p-5 shadow-lg',
            // On the mobile bottom-sheet layout this sits flush against the
            // real bottom edge — with `viewportFit: 'cover'` (root layout)
            // that is the home-indicator area, so the sheet's own bottom
            // padding needs the device inset on top of its normal `p-5`.
            // `sm:` (the centred-card layout) doesn't touch any edge, so it
            // stays at the plain `p-5` the shorthand above already gives it.
            'pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5',
            // `rounded-2xl` (24px) is already the teardown's "panel" radius
            // step (## Radii & borders derived scale) — verified correct,
            // no change needed.
            'inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl',
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[min(28rem,calc(100vw-2rem))]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'duration-base ease-out',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-base font-semibold">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                // Radix warns when Content has no description; saying there
                // is none is the documented way to mean it.
                <DialogPrimitive.Description className="sr-only">
                  {title}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label={closeLabel}
              data-testid={testId ? `${testId}-close` : undefined}
              // "Opacity dim" (btn-0 in ## Press states): 1 -> 0.6 at
              // --dur-fast, held through down — the measured recipe for an
              // icon-only control with nothing to fill.
              className="-m-1 rounded-lg p-1 text-muted-foreground transition-[color,opacity] duration-fast hover:text-foreground active:opacity-60"
            >
              <X aria-hidden="true" className="size-5" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
