'use client'

import { useState } from 'react'

/**
 * Compact rate-source pill ("my avg rate", "bank-charged", …); tapping it
 * toggles a one-line explanation of where the conversion rate came from.
 */
export function RateChip({
  label,
  explanation,
}: {
  label: string
  explanation: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex h-8 w-fit items-center rounded-full border border-border-strong px-3 text-xs text-muted-foreground outline-none transition-transform duration-fast ease-swift focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
        data-testid="rate-chip"
      >
        {label}
      </button>
      {open ? (
        <span
          className="mt-1 text-xs text-muted-foreground"
          data-testid="rate-chip-explanation"
        >
          {explanation}
        </span>
      ) : null}
    </span>
  )
}
