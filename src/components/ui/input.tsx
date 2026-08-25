import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * FIELDS ARE UNDERLINES, NOT BOXES (FIXES §4).
 *
 * The bordered, rounded, ring-focused box is gone. A field is a run of text
 * sitting on a 1px #d8d8d8 hairline; focusing it draws the ink line in over
 * the top from the left (the reference's "잉크가 스밈"), which is both the
 * focus affordance and the only chrome the control has. Radius 0, no fill,
 * no shadow, no ring — the page is the surface.
 *
 * MECHANICS. Two stacked 1px background gradients: the ink one starts at 0%
 * wide and grows to 100% on focus, the grey one is always full width. A
 * border cannot animate its width, which is why this is a background and
 * not a `border-bottom`.
 */
const FIELD_RULE =
  'bg-[linear-gradient(var(--foreground),var(--foreground)),linear-gradient(#d8d8d8,#d8d8d8)] ' +
  'bg-[position:left_bottom,left_bottom] bg-[length:0%_1px,100%_1px] bg-no-repeat ' +
  'focus-visible:bg-[length:100%_1px,100%_1px] ' +
  'aria-invalid:bg-[linear-gradient(var(--destructive),var(--destructive)),linear-gradient(var(--destructive),var(--destructive))] ' +
  'aria-invalid:bg-[length:100%_1px,100%_1px]'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'w-full min-w-0 rounded-none border-0 px-0 py-[9px] text-base text-foreground outline-none',
        'transition-[background-size] duration-[250ms] ease-swift',
        FIELD_RULE,
        'placeholder:text-[#c8c8c8]',
        'file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The same underline, for the native `<select>`s the app uses instead of a
 * listbox (the phone's own picker beats a Radix one). They sat in the same
 * rounded box `Input` just left behind, and a boxed select next to an
 * underlined field reads as two different design systems in one form.
 * `min-h-11` keeps the 44px tap target the box used to supply.
 */
export const SELECT_FIELD = cn(
  'w-full min-h-11 appearance-none cursor-pointer rounded-none border-0 px-0 py-[9px] text-base text-foreground outline-none',
  'transition-[background-size] duration-[250ms] ease-swift',
  FIELD_RULE,
  'disabled:cursor-default disabled:opacity-50',
)

export { Input }
