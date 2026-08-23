import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * STATEMENT FIELD (handoff SPEC.md §4): an uppercase tracked label over a
 * borderless input whose only chrome is a 1px bottom hairline — ink on
 * focus. Replaces the boxed Input+Label pair on restyled screens; the boxed
 * primitives stay for screens not yet moved over.
 */
export function StatementField({
  id,
  label,
  className,
  ...props
}: React.ComponentProps<'input'> & { label: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className="text-[12px] tracking-[0.12em] text-muted-foreground uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        data-slot="input"
        className="h-10 w-full min-w-0 rounded-none border-0 border-b border-border bg-transparent px-0 text-base text-foreground transition-[border-color] duration-fast outline-none placeholder:text-muted-foreground focus-visible:border-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive"
        {...props}
      />
    </div>
  )
}
