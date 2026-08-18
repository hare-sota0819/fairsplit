import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

/*
 * PRESS RECIPE — PITCH_TEARDOWN.md ## Press states, "Scale press" (`btn-1`,
 * the only transform in any measured press state) + the "derivation rule:
 * press-from-hover on touch" (every hover delta becomes an :active delta,
 * plus scale(0.97) on any control with a fill). `hover:` is already scoped
 * to `@media (hover: hover)` by Tailwind's own default, so desktop keeps
 * both hover and press; touch gets press only. `not-data-[variant=link]:`
 * excludes the one variant with nothing to fill (see the link variant's own
 * "Text colour shift" recipe below) — scale is reserved for filled controls.
 * `not-aria-[haspopup]` keeps popover/select triggers from scaling under
 * their own anchored content (pre-existing guard, carried over from the old
 * translate-y-px press). Duration/easing per ## Motion tokens: `--dur-fast`
 * + `--ease-swift`, the rev1-planned pair for this exact transform+colour
 * combination.
 */
const buttonVariants = cva(
  // `border-color` has to be in the transition list: focus-visible's
  // border-ring and aria-invalid's border-destructive both change it, and
  // without it here they snap instead of tweening (review catch).
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,background-color,color,border-color,box-shadow] duration-fast ease-swift outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:not-data-[variant=link]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/80 active:bg-primary/80',
        outline:
          // `border-border` is only 1.24-1.26:1 against a `bg-muted` ground
          // (the T3 carry) — this variant's own hover/press fill IS muted,
          // so it needs `border-border-strong` (1.9-2.19:1) to stay visible
          // through its own press state. Dark already uses `border-input`,
          // unaffected.
          'border-border-strong bg-background hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:active:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 dark:active:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 active:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:active:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        // "Text colour shift" (btn-3): ink -> brand text over 120ms, no
        // fill, no scale — this is the one variant the base's
        // `not-data-[variant=link]` guard excludes from the press scale.
        link: 'text-primary underline-offset-4 hover:underline active:underline',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        // Added for this app: shadcn's defaults are desktop-sized, and every
        // screen here is a phone. 44px is the minimum comfortable tap target.
        touch: 'h-11 gap-2 rounded-xl px-4 text-sm',
        hero: 'h-13 w-full gap-2 rounded-xl px-5 text-base font-semibold',
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
