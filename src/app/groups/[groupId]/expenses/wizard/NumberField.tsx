'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Stepper } from '@/components/ui/Stepper'

/**
 * Focusing a numeric field selects what is already in it, so typing replaces
 * rather than appends. Without this, tapping a quantity of "1" and typing 3
 * gave 13 — reported from a real phone.
 *
 * Three handlers, because `onFocus` alone does not survive a real click:
 * the browser places the caret on MOUSEUP, which lands after focus and
 * collapses the selection — so a mouseup that is part of the click that
 * focused the field is suppressed. Clicking again inside an already-focused
 * field still positions the caret normally. The extra frame is for iOS
 * Safari, which moves the caret after the focus handler has run.
 *
 * A module-level flag is enough: only one element can be under the pointer.
 */
let pressedWhileFocused = false

export const selectOnFocusProps = {
  onMouseDown(event: React.MouseEvent<HTMLInputElement>) {
    pressedWhileFocused = document.activeElement === event.currentTarget
  },
  onMouseUp(event: React.MouseEvent<HTMLInputElement>) {
    if (!pressedWhileFocused) event.preventDefault()
  },
  onFocus(event: React.FocusEvent<HTMLInputElement>) {
    const input = event.currentTarget
    input.select()
    requestAnimationFrame(() => {
      if (document.activeElement === input) input.select()
    })
  },
}

/**
 * A numeric input that always states its unit and shows what the number it
 * holds actually works out to. Global rule 1 of the Phase 4A brief: two
 * production bugs came from a bare number box whose meaning had to be
 * guessed (the FX rate field, and unit price vs line total).
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  unit,
  result,
  placeholder,
  testId,
  className = '',
  inputClassName = '',
  required,
  ariaLabel,
}: {
  id?: string
  label?: string
  value: string
  onChange: (value: string) => void
  /** Currency code or other unit, shown inside the field. */
  unit?: string
  /** What this number produces — rendered immediately beneath. */
  result?: React.ReactNode
  placeholder?: string
  testId?: string
  className?: string
  inputClassName?: string
  required?: boolean
  ariaLabel?: string
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <span className="relative flex items-center">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...selectOnFocusProps}
          placeholder={placeholder}
          required={required}
          aria-label={ariaLabel ?? label}
          className={`tabular-nums ${unit ? 'pr-14' : ''} ${inputClassName}`}
          data-testid={testId}
        />
        {unit ? (
          <span className="pointer-events-none absolute right-3 text-xs font-semibold text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </span>
      {result ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {result}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Quantity: typeable AND steppable — now in the §8 grammar (bare −/+
 * glyphs, a serif figure rolling in a 30px window). The wrapper stays so
 * the wizard's call sites and their test ids are untouched.
 */
export function QtyStepper({
  value,
  onChange,
  min = 1,
  max,
  testId,
  ariaLabel,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  testId?: string
  ariaLabel: string
}) {
  return (
    <Stepper
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      testId={testId}
      ariaLabel={ariaLabel}
    />
  )
}
