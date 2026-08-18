'use client'

import { cn } from '@/lib/utils'

/**
 * An on/off switch.
 *
 * The app had no such control — binary settings were checkboxes — but a
 * checkbox reads as "tick this to opt in", and the settlement flag is a thing
 * that is already ON and can be turned off. A switch says that; a cleared
 * checkbox says the opposite.
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
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full',
        // Track colour + focus outline at --dur-fast (## Press states:
        // "press feedback, colour swaps, focus rings" is one measured
        // cluster; the outline-color transition specifically matches the
        // one real measured focus recipe, `outline-color 0.15s`). Scale
        // press: this track has a fill either way (on or off), so it gets
        // the universal scale(0.97) recipe too — `transform` has to be in
        // the property list (review catch: it was missing, so the scale
        // snapped instead of tweening, unlike button.tsx/toggle.tsx which
        // both include it).
        'transition-[background-color,outline-color,transform] duration-fast ease-swift disabled:opacity-60 active:scale-[0.97]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]',
        checked ? 'bg-primary' : 'bg-muted-foreground/40',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow transition-transform duration-fast ease-swift',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
