'use client'

import { cn } from '@/lib/utils'

/**
 * AN ON/OFF SWITCH — THE ABACUS BEAD (SPEC-INTERACTIONS §6).
 *
 * The track is a 1px hairline 34px wide, ink when on and #d8d8d8 when off.
 * The knob is a 14px ink dot that slides 0→20px over .28s — and it is THE
 * ONE ROUNDED ELEMENT IN THE APP, because a bead sliding along a wire is
 * the whole idea. Off, the dot greys to #b8b8b8.
 *
 * The app had no such control — binary settings were checkboxes — but a
 * checkbox reads as "tick this to opt in", and the settlement flag is a
 * thing that is already ON and can be turned off. A switch says that; a
 * cleared checkbox says the opposite.
 *
 * Plain `<button role="switch">` rather than a dependency: this is the only
 * switch in the app, and the accessible contract is one attribute.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  testId,
  // 'submit' lets the switch BE the form's submit control, which is how the
  // one-tap direction works: no wrapper button, so no button inside a button.
  type = 'button',
  'aria-labelledby': labelledBy,
}: {
  checked: boolean
  onCheckedChange?: (next: boolean) => void
  disabled?: boolean
  id?: string
  testId?: string
  type?: 'button' | 'submit'
  'aria-labelledby'?: string
}) {
  return (
    <button
      type={type}
      role="switch"
      id={id}
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        // A 34x14 field with a comfortable tap zone around it, taken back
        // out of the layout with a negative margin so the control still
        // measures 34px on the page.
        'relative inline-block h-3.5 w-[34px] shrink-0 p-3 -m-3',
        'transition-[outline-color,transform] duration-fast ease-swift active:translate-y-px disabled:opacity-60',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-3 h-3.5 w-[34px] -translate-y-1/2"
      >
        {/* The wire. */}
        <span
          className={cn(
            'absolute inset-x-0 top-1/2 h-px transition-colors duration-[250ms]',
            checked ? 'bg-foreground' : 'bg-[#d8d8d8]',
          )}
        />
        {/* The bead — the one rounded element in the app. */}
        <span
          className={cn(
            'absolute top-1/2 left-0 -mt-[7px] size-3.5 rounded-full',
            'transition-[transform,background-color] duration-[280ms] ease-swift',
            checked ? 'bg-foreground' : 'bg-[#b8b8b8]',
          )}
          style={{ transform: `translateX(${checked ? 20 : 0}px)` }}
        />
      </span>
    </button>
  )
}

/**
 * The meta label that sits to the right of a switch (§6): 12px #a8a8a8,
 * right-aligned in a fixed 34px column so 켬/끔 do not shift the row.
 */
export function SwitchState({
  on,
  labels,
}: {
  on: boolean
  labels: { on: string; off: string }
}) {
  return (
    <span
      aria-hidden="true"
      className="w-[34px] text-right text-xs text-[#a8a8a8]"
    >
      {on ? labels.on : labels.off}
    </span>
  )
}
