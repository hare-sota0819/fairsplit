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
 *
 * THE SHEET IS PAPER (SPEC-INTERACTIONS §9): radius 0, white ground, a
 * single 1px #dcdcdc border and NO SHADOW — the panel is a piece of paper
 * laid on the page, not a card floating above it. The title is the display
 * serif at 19px ink, the body 13.5px meta grey, and the actions are text
 * links (a destructive one keeps its underline pinned on). The scrim stays.
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
            'fixed z-50 flex flex-col gap-4 bg-white p-5 dark:bg-card',
            // §9: one hairline, no shadow, no ring.
            'border border-[#dcdcdc] dark:border-border',
            // On the mobile bottom-sheet layout this sits flush against the
            // real bottom edge — with `viewportFit: 'cover'` (root layout)
            // that is the home-indicator area, so the sheet's own bottom
            // padding needs the device inset on top of its normal `p-5`.
            // `sm:` (the centred-card layout) doesn't touch any edge, so it
            // stays at the plain `p-5` the shorthand above already gives it.
            'pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5',
            // Radius 0 everywhere — the statement grammar has no rounded
            // corners, and a sheet is no exception.
            'inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-none',
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[min(28rem,calc(100vw-2rem))]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'duration-base ease-out',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="font-heading text-[19px] leading-tight text-foreground">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-[13.5px] leading-[21px] text-[#8a8a8a]">
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
              // Tertiary chrome (§1 tier 3): faint grey, colour on hover,
              // and the ink sink on press like every other control.
              className="-m-1 rounded-none p-1 text-[#a8a8a8] transition-[color,transform] duration-fast hover:text-[#565656] active:translate-y-px"
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
