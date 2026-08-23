import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

/*
 * PRESS RECIPE — THE INK SINK.
 *
 * Every control, filled or text, sinks 1px on press: `translateY(1px)`.
 * scale() is banned outright (handoff 2026-08-24 global rules) — a page
 * does not zoom under a finger, it takes the ink. Touch devices have no
 * hover, so the sink plus (on the mobile commit bar) ink inversion is the
 * whole of the press feedback there.
 *
 * Focus keeps border-ring + ring; border-color stays in the transition list
 * so focus/invalid tween instead of snapping.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,background-color,color,border-color,box-shadow] duration-fast ease-swift outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/80 active:bg-primary/80',
        outline:
          'border-border-strong bg-background hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:active:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 dark:active:bg-muted/50',
        /*
         * DESTRUCTIVE (SPEC-INTERACTIONS §2) — the app's only chromatic
         * colour, and it is a TEXT LINK, never a fill: colour is the warning,
         * so no icon and no tinted box. The 1px underline appears on hover
         * only; a confirm dialog's destructive action pins it on with
         * `data-fixed-rule` (see §9).
         */
        destructive:
          'rounded-none border-0 border-b border-transparent bg-transparent px-0 font-normal text-destructive transition-[border-color,color,transform] hover:border-b-destructive active:border-b-destructive data-[fixed-rule]:border-b-destructive',
        link: 'text-primary underline-offset-4 hover:underline active:underline',
        /*
         * THE FOUR-TIER TEXT HIERARCHY (SPEC-INTERACTIONS §1). Text only,
         * never boxes; the tier is carried by size, ink and what the
         * underline does.
         *
         * 1 · statement — primary: 16px ink, a FIXED 1px underline 3px
         *   below the text, and a trailing arrow whose gap grows 8px→14px
         *   on hover (the gap transition lives on the call site's flex row;
         *   `SubmitButton` and the arrow helper below apply it).
         */
        statement:
          'rounded-none border-0 border-b border-foreground px-0 pb-[3px] text-base font-normal text-foreground disabled:cursor-default disabled:border-b-transparent disabled:text-[15px] disabled:text-[#c8c8c8] disabled:opacity-100',
        /*
         * 2 · statement-secondary — 15px meta grey; the underline GROWS from
         *   the left on hover (background-size 0%→100% of a 1px gradient)
         *   and the ink darkens to full.
         */
        'statement-secondary':
          'rounded-none border-0 bg-[linear-gradient(var(--foreground),var(--foreground))] bg-[length:0%_1px] bg-[position:left_bottom] bg-no-repeat px-0 pb-[3px] text-[15px] font-normal text-[#8a8a8a] transition-[background-size,color,transform] duration-[350ms] hover:bg-[length:100%_1px] hover:text-foreground disabled:cursor-default disabled:bg-none disabled:text-[#c8c8c8] disabled:opacity-100',
        /* 3 · statement-tertiary — 13.5px faint grey, colour only. No
         *   underline, ever. */
        'statement-tertiary':
          'rounded-none border-0 px-0 text-[13.5px] font-normal text-[#a8a8a8] transition-[color,transform] duration-[250ms] hover:text-[#565656]',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        touch: 'h-11 gap-2 rounded-xl px-4 text-sm',
        hero: 'h-13 w-full gap-2 rounded-xl px-5 text-base font-semibold',
        // STATEMENT companion size: content-height text control with a
        // comfortable tap zone supplied by line-height + py, not a fill box.
        text: 'h-auto gap-2 rounded-none px-0 py-2 text-base',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

/**
 * The trailing arrow of a primary action (SPEC-INTERACTIONS §1). The gap it
 * sits in grows 8px→14px on hover over .3s, on the one easing.
 *
 * `aria-hidden` on purpose: the arrow is punctuation, not part of the
 * button's name, so "Save" stays "Save" to a screen reader and to a test.
 */
export function ActionArrow() {
  return (
    <span aria-hidden="true" className="inline-block">
      →
    </span>
  )
}

/** The flex row a §1 primary label + arrow live in: gap 8px → 14px. */
export const ARROW_ROW =
  'inline-flex items-baseline gap-2 transition-[gap] duration-[300ms] ease-swift group-hover/button:gap-3.5'

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
