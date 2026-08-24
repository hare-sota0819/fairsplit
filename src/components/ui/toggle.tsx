'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Toggle as TogglePrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * LOCAL MODIFICATION (see NOTICE): the shadcn preset marks the selected
 * state with a fill. There are no fills here.
 *
 * SELECTION IS WHERE THE UNDERLINE IS (SPEC-INTERACTIONS §7): a selected
 * toggle is ink with a 1px rule under it; an unselected one is #b8b8b8 with
 * nothing, and hover only takes it half a step darker so the two never get
 * confused. No box, no radius, no chip.
 *
 * Press is the ink sink, like every other control.
 */
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-none border-0 bg-transparent text-[15.5px] font-normal whitespace-nowrap text-[#b8b8b8] transition-[transform,color,border-color] duration-fast ease-swift outline-none hover:text-[#565656] active:translate-y-px focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:text-[#c8c8c8] disabled:opacity-100 aria-invalid:text-destructive aria-pressed:text-foreground data-[state=on]:border-b data-[state=on]:border-foreground data-[state=on]:text-foreground data-[state=on]:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      // Both variants read the same now: the outline had a border to mark a
      // chip, and chips are gone.
      variant: {
        default: '',
        outline: '',
      },
      // No heights and no side padding: an option is a word. The vertical
      // padding is the tap zone, and it puts the selected rule 6px under
      // the text — §7's sliding underline, standing still.
      size: {
        default: 'py-2.5 pb-1.5',
        sm: 'py-2 pb-1.5 text-[14px]',
        lg: 'py-3 pb-1.5',
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
