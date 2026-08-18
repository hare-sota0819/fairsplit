'use client'

import { Collapsible as CollapsiblePrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      // Had no open/close motion at all — content snapped in/out at its
      // full height instantly. `--radix-collapsible-content-height` is set
      // by Radix itself; `animate-collapsible-down/up` (tw-animate-css) is
      // the matching height keyframe pair. `--dur-base`: this moves
      // position/height, the same bucket as an entrance (## Motion tokens).
      className={cn(
        'overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up duration-base',
        className,
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
