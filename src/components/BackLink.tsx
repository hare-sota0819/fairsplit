import { ChevronLeft } from 'lucide-react'
import { NavLink } from '@/components/NavLoader'

/**
 * The conventional back affordance: a chevron at the TOP LEFT of the screen,
 * on the same line as the title.
 *
 * The wallets screen used to put a full-width "← Done" button under its
 * heading, which is not where anyone looks for a way back — every phone OS
 * puts it top-left, and a full-width button reads as the screen's primary
 * action rather than an escape hatch.
 *
 * Still a `NavLink`, so the navigation overlay fires the same as everywhere
 * else, and still a 44px tap target despite being visually small.
 */
export function BackLink({
  href,
  caption,
  label,
  testId,
}: {
  href: string
  /** Loading-overlay caption for the destination. */
  caption: string
  /** Accessible name, and the visible text beside the chevron. */
  label: string
  testId?: string
}) {
  return (
    <NavLink
      href={href}
      caption={caption}
      testId={testId}
      className="-ml-2 inline-flex h-11 w-fit items-center gap-0.5 rounded-lg pr-3 pl-1 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-swift hover:text-foreground active:text-foreground"
    >
      <ChevronLeft aria-hidden="true" className="size-5 shrink-0" />
      {label}
    </NavLink>
  )
}
