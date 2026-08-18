'use client'

import { useEffect, useRef } from 'react'
import { SemEngine, type SemState } from '@/lib/sem/engine'

/**
 * Sem's animated ink-dot mark (docs/BRAND.md §3–4).
 *
 * Two stacked TRANSPARENT canvases over the page ground — no CSS filter,
 * no blend mode (both broke on iOS Safari, which painted the old opaque
 * goo ground as a solid white/black square, see engine.ts drawGoo):
 * - ink layer: the dot cluster as thresholded metaballs, computed in the
 *   engine, so overlapping dots still merge into gooey ink.
 * - crisp layer: the wireframe and Sem's single accent dot.
 *
 * `live=false` (or prefers-reduced-motion) renders one static settled
 * glyph frame and never starts the animation loop.
 */
export function SemMark({
  state,
  members = 3,
  size = 160,
  live = true,
  accentOn = true,
  flowDots,
  inverted,
  interactive = false,
  onPoke,
  className,
}: {
  state: SemState
  members?: number
  size?: number
  live?: boolean
  accentOn?: boolean
  flowDots?: number
  /**
   * Force light-on-dark (true) or dark-on-light (false) rendering
   * regardless of the app theme — for grounds that don't follow it,
   * like the navigation scrim. Undefined = follow the theme.
   */
  inverted?: boolean
  /**
   * Pointer play (owner's 2026-08-14 request): hovering pulls nearby dots
   * gently toward the cursor (engine.setPointer), and a tap/click startles
   * them (engine.poke). Off by default — only surfaces meant to be touched
   * (the empty-chat greeting) opt in.
   */
  interactive?: boolean
  /** Fires on tap/click when `interactive` — the host can answer with a
   *  line of copy (the greeting screen's playful replies). */
  onPoke?: () => void
  className?: string
}) {
  const inkRef = useRef<HTMLCanvasElement>(null)
  const accentRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<SemEngine | null>(null)

  const resolvedFlow = flowDots ?? (size >= 120 ? 14 : size >= 40 ? 6 : 0)
  const dotScale = size < 64 ? 1.7 : size < 160 ? 1.25 : 1

  useEffect(() => {
    const ink = inkRef.current
    const accent = accentRef.current
    if (!ink || !accent) return
    // Full device ratio (iPhone = 3): the mark is ink on paper and must be
    // as sharp as the type next to it (owner, 2026-08-15: "화질").
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    for (const c of [ink, accent]) {
      c.width = size * dpr
      c.height = size * dpr
    }
    const root = document.documentElement
    const accentColor =
      getComputedStyle(root).getPropertyValue('--sem-accent').trim() ||
      '#d6482a'
    // Matches the app's theme resolution (globals.css THEME RESOLUTION):
    // explicit choice on <html> wins, else the OS preference.
    const theme = root.getAttribute('data-theme')
    const isDark =
      inverted ??
      (theme === 'dark' ||
        (theme !== 'light' &&
          (root.classList.contains('dark') ||
            window.matchMedia('(prefers-color-scheme: dark)').matches)))
    const engine = new SemEngine(
      {
        members,
        flowDots: resolvedFlow,
        ink: isDark ? '#f2f0eb' : '#1a1917',
        accent: accentColor,
        accentOn,
        dotScale,
      },
      // A fresh seed per mount: the twitches, glances and shape picks
      // must differ between visits (a fixed seed replayed the exact same
      // sequence every load — owner: "터치하면 매번 같은 도형").
      Math.floor(Math.random() * 0x7fffffff),
    )
    engineRef.current = engine
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (!live || reduceMotion) {
      engine.drawStatic(ink, accent, dpr)
      return
    }
    engine.setState(state)
    engine.start(ink, accent, dpr)
    return () => {
      engine.stop()
      engineRef.current = null
    }
    // Rebuild only on structural changes; state flows via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, size, live, accentOn, resolvedFlow, dotScale, inverted])

  useEffect(() => {
    engineRef.current?.setState(state)
  }, [state])

  const canvasStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: size,
    height: size,
  }

  // Screen px → engine unit space: inverse of project()'s
  // `half + x * unit` mapping (unit = half * 0.62), ignoring perspective.
  const toUnit = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return { x: 0, y: 0 }
    const half = rect.width / 2
    return {
      x: (event.clientX - rect.left - half) / (half * 0.62),
      y: (event.clientY - rect.top - half) / (half * 0.62),
    }
  }

  return (
    <div
      aria-hidden
      className={className}
      style={{ position: 'relative', width: size, height: size }}
      ref={wrapRef}
      onPointerMove={
        interactive
          ? (event) => engineRef.current?.setPointer(toUnit(event))
          : undefined
      }
      onPointerLeave={
        interactive ? () => engineRef.current?.setPointer(null) : undefined
      }
      onPointerDown={
        interactive
          ? (event) => {
              const p = toUnit(event)
              engineRef.current?.poke(p.x, p.y)
              onPoke?.()
            }
          : undefined
      }
    >
      <canvas ref={inkRef} style={canvasStyle} />
      <canvas ref={accentRef} style={canvasStyle} />
    </div>
  )
}
