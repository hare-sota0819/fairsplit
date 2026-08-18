'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Toggle as TogglePrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * LOCAL MODIFICATION (see NOTICE): the shadcn preset marks the selected
 * state with `bg-muted`, which in this theme is the page background — on a
 * white card a selected chip was indistinguishable from an unselected one.
 * Selected toggles now take the accent.
 */
// Press recipe: same scale(0.97) + hover-mirrored :active as button.tsx (##
// Press states, "Scale press" + the touch-derivation rule) — a toggle
// always has (or is about to have) a fill, on or off. Radius: `rounded-sm`
// (8px, the input/chip step — ## Radii & borders row 9; a toggle/chip is
// not a primary tappable action, it's a filter/field-adjacent control).
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-sm text-sm font-medium whitespace-nowrap transition-[transform,background-color,color,border-color,box-shadow] duration-fast ease-swift outline-none hover:bg-muted hover:text-foreground active:scale-[0.97] active:bg-muted active:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-primary aria-pressed:text-primary-foreground data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground data-[state=on]:active:bg-primary data-[state=on]:active:text-primary-foreground dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent hover:bg-muted active:bg-muted',
      },
      size: {
        default:
          'h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        // Radius override removed: the base's rounded-sm (8px) is already
        // the sharp target — the old min(--radius-md,12px) clamp (11.2px)
        // would have read LARGER than the default it's meant to shrink.
        sm: "h-7 min-w-7 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Toggle({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
