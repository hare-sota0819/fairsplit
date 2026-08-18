'use client'

import Link from 'next/link'
import { useLinkStatus } from 'next/link'
import { useMemo } from 'react'
import { LoadingOverlay } from './LoadingOverlay'
import { nextLoader } from './loaders'

/**
 * Full-screen loading for in-app navigations (Part 5/6).
 *
 * Deliberately NOT `loading.tsx`: a route-level loading boundary makes its
 * segment eligible for Client Router Cache reuse, and in this app that
 * served pre-mutation data after saving an exchange record. Driving the
 * overlay from the pressed link's own pending state gives the same feel
 * with none of the staleness — and it only appears when the navigation is
 * actually slow enough to notice, because a resolved navigation unmounts it.
 *
 * WHICH motif appears comes from the rotation in
 * `src/components/loaders/config.ts` — a different one each navigation, so a
 * trip shows the whole set. Picking here is safe because this subtree only
 * ever renders in the browser, after hydration, once a link is pending; the
 * caption is the only other per-link part.
 */
function Overlay({ caption }: { caption: string }) {
  const { pending } = useLinkStatus()
  // Keyed on `pending`, NOT drawn once on mount. A tab link mounts a single
  // time and lives as long as the bar does, so a figure picked at mount was
  // that tab's figure forever — twenty of them and you would only ever see
  // four. This redraws every time a navigation begins.
  // `pending` is the POINT of this dependency, not an accident: it is what
  // draws a new figure when a navigation starts. Without it the memo never
  // recomputes and the figure is fixed for the element's whole life.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const id = useMemo(() => nextLoader(), [pending])
  if (!pending) {
    return null
  }
  return <LoadingOverlay caption={caption} id={id} />
}

/**
 * A link that takes over the screen with the loading animation. Every in-app
 * navigation that renders from the database goes through this, so the set is
 * seen everywhere rather than only on the tabs and the feed.
 */
export function NavLink({
  href,
  caption,
  className,
  children,
  testId,
  onClick,
  ariaLabel,
  ariaCurrent,
  overlay = true,
}: {
  href: string
  caption: string
  className?: string
  children: React.ReactNode
  testId?: string
  /** For links that must save something first (e.g. parking a draft). */
  onClick?: () => void
  /** Accessible name, for rows whose visible text alone doesn't say where the link goes. */
  ariaLabel?: string
  /** e.g. "page", for a row that marks the current selection in a list of links. */
  ariaCurrent?: React.AriaAttributes['aria-current']
  /**
   * Set false to move between screens WITHOUT taking the screen over.
   *
   * The bottom tabs use this. Switching tab is not "going somewhere else",
   * it is looking at the same trip a different way, and a full-screen
   * takeover between two views of one thing reads as a page load in a way
   * no native app does. With the overlay off, React keeps the current screen
   * on until the next one is ready and the tabs give their own pressed
   * feedback — see `PendingTab`.
   */
  overlay?: boolean
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      data-testid={testId}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
    >
      {children}
      {overlay ? <Overlay caption={caption} /> : null}
    </Link>
  )
}

/**
 * Renders its children only while the enclosing link is pending.
 *
 * Must be a DESCENDANT of the `<Link>`: `useLinkStatus` reads the pending
 * state of the link above it. This is how a tab can look pressed the instant
 * it is tapped, without anything covering the screen.
 */
export function LinkPending({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()
  return pending ? <>{children}</> : null
}
