'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * The backdrop: the atmosphere behind the landing and auth screens.
 *
 * Reimplemented from PITCH_TEARDOWN.md `## Canvas & background` — the
 * measured finding there is that pitch.com has ZERO `<canvas>`/WebGL
 * anywhere; every atmospheric effect is plain DOM (flat bands, one radial
 * gradient, two backdrop blurs). This component follows that recipe: no
 * canvas, no render loop, just layered CSS radial/conic gradients built
 * from the app's own palette (`--primary`, `--primary-soft`), drifting
 * slowly via transform/opacity keyframes (`.backdrop-bloom-*`,
 * `.backdrop-wash` in globals.css — `--dur-slow` × a large multiplier, per
 * the plan's own constraint).
 *
 * This REPLACES the earlier warm Bauhaus SVG collage (quarter-discs, rings,
 * checkers on a 4x8 grid) that a prior round built from a different
 * reference sheet. That reference is gone; the new one measures Pitch, and
 * Pitch's own atmosphere is soft colour, not shapes.
 *
 * --art-strength IS THE DIAL, and it still defaults to 0 (globals.css
 * `:root`). It only ever gets set to 1 here, on the routes below, via an
 * inline custom-property override scoped to this component's own root — a
 * screen that never renders <Backdrop> at all (the `!show` early return)
 * still inherits the 0 default, so even a future bug that mounted this
 * component somewhere else could not light it up on a content screen by
 * accident. The early return is the primary defence; the dial is the
 * documented, gate-able one.
 *
 * WHY IT ONLY APPEARS WHERE THERE IS NOTHING TO READ: the collage era
 * learned this the hard way — behind every screen, the result was text
 * sitting on top of decoration, and the owner called it unreadable. Same
 * rule survives the reimplementation: the art renders on the landing, the
 * auth screens and nowhere else. The decision is made HERE from the path,
 * not by a CSS class on the screen, because this is a sibling of the header
 * at the document root (see docs/SOLVED.md 2026-08-04 on stacking contexts).
 *
 * OFFSCREEN / HIDDEN-TAB PAUSE: an IntersectionObserver watches this
 * component's own root (belt-and-suspenders — a `position: fixed` element
 * sized to the viewport is always "intersecting" while the tab itself is on
 * screen, but this also covers any future non-fixed reuse) and the Page
 * Visibility API catches a backgrounded tab, which the observer alone
 * cannot. Either signal sets `data-paused`, which globals.css turns into
 * `animation-play-state: paused` on the drifting layers — no CPU/GPU spent
 * animating gradients nobody can see.
 *
 * `prefers-reduced-motion` is handled entirely in globals.css: the drifting
 * layers are named in the existing reduced-motion block and stop dead,
 * leaving the gradients themselves in place (an atmosphere, still visible,
 * just still).
 */

/** Screens with no list and no form — the only places the atmosphere belongs. */
const ART_ROUTES = ['/', '/signin', '/signup', '/reset-password']

export function Backdrop() {
  const pathname = usePathname()
  const show = ART_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const [offscreen, setOffscreen] = useState(false)
  const [tabHidden, setTabHidden] = useState(false)

  useEffect(() => {
    if (!show) {
      return undefined
    }
    const el = rootRef.current
    if (!el) {
      return undefined
    }
    const io = new IntersectionObserver(
      ([entry]) => setOffscreen(!entry.isIntersecting),
      { threshold: 0 },
    )
    io.observe(el)
    const onVisibility = () => setTabHidden(document.hidden)
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [show])

  if (!show) {
    return null
  }

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-paused={offscreen || tabHidden ? '' : undefined}
      className="backdrop-root"
      style={{ '--art-strength': 1 } as React.CSSProperties}
    >
      <div className="backdrop-bloom backdrop-bloom-a" />
      <div className="backdrop-bloom backdrop-bloom-b" />
      <div className="backdrop-wash" />
    </div>
  )
}
