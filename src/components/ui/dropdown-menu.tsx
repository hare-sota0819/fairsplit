'use client'

import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          // THE ONE MENU SKIN (FIXES §3): white surface, a single 1px
          // #dcdcdc border, radius 0, no shadow and no ring. §4's currency
          // picker opens "the same bordered menu as §3", so the menu is
          // defined here rather than per call site.
          'z-50 min-w-56 max-h-[min(60vh,22rem)] overflow-y-auto rounded-none border border-[#dcdcdc] bg-popover p-0 text-popover-foreground shadow-none',
          // `--dur-fast`: the same quick-popover token as select.tsx's
          // SelectContent, not an unexplained default.
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 duration-fast',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        // §3: 14.5px ink, 12px of vertical padding, radius 0. The 44px tap
        // floor this app holds everywhere else survives as a minimum.
        'flex min-h-11 cursor-default items-center rounded-none px-4 py-3 text-[14.5px] text-foreground outline-none select-none',
        // Radix already drives `data-highlighted` from pointerdown, hover,
        // AND keyboard nav in one mechanism — a manual `active:` press
        // class would be redundant with it. Just give the highlight a
        // --dur-fast transition instead of an instant snap.
        'transition-colors duration-fast focus:bg-[#f2f2f2] data-[highlighted]:bg-[#f2f2f2]',
        'data-[variant=destructive]:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('px-4 py-3', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      // §3: the hairline sits between GROUPS of rows, and it is #e4e4e4.
      className={cn('mx-0 my-0 h-px bg-[#e4e4e4]', className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
}
