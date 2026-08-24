import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

/*
 * BUTTONS ARE TEXT, NEVER BOXES (SPEC-INTERACTIONS §1).
 *
 * The four tiers are carried by size, ink and what the underline does —
 * there is no fill, no border and no radius on any of them. The ONE filled
 * surface left in the app is the mobile commit bar (§4), which SubmitButton
 * draws itself.
 *
 *   1 default            16px ink, a FIXED 1px underline 3px under the text,
 *                        and a trailing arrow whose gap opens on hover.
 *   2 outline/secondary  15px meta grey; the underline GROWS from the left
 *                        on hover and the ink darkens to full.
 *   3 ghost              13.5px faint grey, colour only. No underline, ever.
 *   - disabled           15px #c8c8c8, no underline, cursor default.
 *   - destructive (§2)   the app's one chromatic colour, as a text link:
 *                        the underline appears on HOVER only, and is pinned
 *                        on inside a confirm dialog (`data-fixed-rule`).
 *
 * PRESS IS THE INK SINK. `translateY(1px)` on every control, filled or not;
 * scale() is banned outright. Touch has no hover, so `@media (hover:none)`
 * in globals.css rests tier 2's underline ON — otherwise a control whose
 * only affordance is a hover state has none at all on a phone.
 *
 * MECHANICS. Tier 1's underline is `text-decoration`, not a border, so it
 * hugs the text at any padding. Tier 2's has to animate its width, which a
 * text-decoration cannot, so it is a 1px background gradient positioned
 * `left bottom 7px` — the tiers all carry a uniform 10px of vertical
 * padding for the tap zone, which puts that exactly 3px under the text.
 */

/** Every variant that renders as text rather than as a box. */
const TEXT_TIERS = [
  'default',
  'outline',
  'secondary',
  'ghost',
  'destructive',
  'statement',
  'statement-secondary',
  'statement-tertiary',
] as const

/** Every size that is a run of text rather than a square icon well. */
const TEXT_SIZES = [
  'default',
  'xs',
  'sm',
  'lg',
  'touch',
  'hero',
  'text',
] as const

/** Tier 2's underline: a 1px ink gradient, 0%→100% wide over .35s. */
const GROWING_RULE =
  'bg-[linear-gradient(var(--foreground),var(--foreground))] bg-[length:0%_1px] bg-[position:left_bottom_7px] bg-no-repeat hover:bg-[length:100%_1px]'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,background-size,background-color,color,border-color,box-shadow] duration-fast ease-swift outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Tier 1 — the primary action.
        default:
          'text-base text-foreground underline decoration-1 underline-offset-[3px] aria-expanded:text-foreground',
        // Tier 2 — a secondary action, and the "not selected" half of a
        // two-button choice: the underline is the whole difference.
        outline: `text-[15px] text-[#8a8a8a] hover:text-foreground aria-expanded:text-foreground ${GROWING_RULE}`,
        secondary: `text-[15px] text-[#8a8a8a] hover:text-foreground aria-expanded:text-foreground ${GROWING_RULE}`,
        // Tier 3 — dismiss, close, "not now".
        ghost:
          'text-[13.5px] text-[#a8a8a8] hover:text-[#565656] aria-expanded:text-[#565656]',
        // §2 — the app's only chromatic colour. Colour IS the warning, so
        // no icon and no tinted box; the rule shows on hover, and stays on
        // inside a confirm.
        destructive:
          'text-[15px] text-destructive decoration-1 underline-offset-[3px] hover:underline data-[fixed-rule]:underline',
        link: 'text-primary underline-offset-4 hover:underline active:underline',
        // The explicit tier names, for call sites that want to pin a tier
        // regardless of what the action means structurally.
        statement:
          'text-base text-foreground underline decoration-1 underline-offset-[3px]',
        'statement-secondary': `text-[15px] text-[#8a8a8a] hover:text-foreground ${GROWING_RULE}`,
        'statement-tertiary': 'text-[13.5px] text-[#a8a8a8] hover:text-[#565656]',
      },
      size: {
        default: 'gap-1.5',
        xs: "gap-1 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "gap-1 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'gap-1.5',
        touch: 'gap-2',
        // The full-width primary row. It keeps its width and its centring;
        // what it loses is the fill.
        hero: 'w-full gap-2',
        text: 'gap-2',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
      },
    },
    compoundVariants: [
      {
        variant: [...TEXT_TIERS],
        size: [...TEXT_SIZES],
        // The geometry reset: no box, no radius, no fill, and a uniform
        // 10px of vertical padding that both supplies the tap zone and puts
        // tier 2's underline exactly 3px under the text.
        className:
          'h-auto rounded-none border-0 bg-transparent px-0 py-2.5 font-normal shadow-none disabled:cursor-default disabled:text-[15px] disabled:text-[#c8c8c8] disabled:no-underline disabled:bg-none disabled:opacity-100',
      },
      {
        // An icon-only control is bare chrome: no fill, no border, no
        // radius — just the glyph, greying to ink on hover.
        variant: [...TEXT_TIERS],
        size: ['icon', 'icon-xs', 'icon-sm', 'icon-lg'],
        className:
          'rounded-none border-0 bg-transparent text-[#8a8a8a] shadow-none hover:text-foreground',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

/**
 * The trailing arrow of a primary action (SPEC-INTERACTIONS §1).
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
