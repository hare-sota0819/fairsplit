import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Focus ring per PITCH_TEARDOWN.md ## Press states: `--dur-fast`
        // covers "press feedback, colour swaps, focus rings" as one
        // cluster. `border-input` (not `--border`) already clears the 3:1
        // UI floor even on a tinted ground (checked: 3.29-3.35:1 against
        // this palette's --secondary/--muted), so no border-strong swap is
        // needed here. `box-shadow` joins the transition list so the
        // focus ring (a ring-* box-shadow, not an outline) actually
        // animates in instead of snapping.
        // Radius: `rounded-sm` (## Radii & borders row 9 — inputs/chips get
        // the sharp 4-8px step, `--radius-sm` = 8px exactly; the app had
        // been shipping this inverted, at the 16px "pill" step).
        'h-8 w-full min-w-0 rounded-sm border border-input bg-transparent px-2.5 py-1 text-base transition-[border-color,background-color,box-shadow] duration-fast outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
