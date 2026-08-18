import { useId } from 'react'

/**
 * Loading indicators, reimplemented in the new language: a gradient ring
 * sweep (an SVG stroke faded through `currentColor`, so it inherits
 * `text-primary` / `text-scrim-foreground` exactly like the old set) plus a
 * small cluster of staggered dots. One family — PITCH_TEARDOWN.md ## Canvas
 * & background names the technique (layered gradients, no canvas); the ring
 * + dots shape is this app's own instance of it, not a measured pitch.com
 * component (the reference has no loading state at all).
 *
 * TWENTY of them, same reason as before: the same figure on the same tab
 * every time reads as a fixed graphic rather than the app working. One is
 * drawn at random per navigation (see config.ts). Each combination of dot
 * layout x ring arc is unique across all 20 (5 layouts x 4 arcs = 20, and
 * `i % 5` / `i % 4` cover every pair exactly once).
 *
 * Every one freezes into a complete, legible still under
 * `prefers-reduced-motion`: the ring's dash resolves to a full solid circle
 * (globals.css reduced-motion block, `.loader-ring`) and the dots — which
 * carry no static opacity of their own outside the keyframe — simply settle
 * at their default opacity of 1.
 */

export type LoaderId = string

export interface LoaderDef {
  id: LoaderId
  Art: (props: { onScrim?: boolean }) => React.ReactElement
}

/** Stagger classes — a cluster of dots takes its turn rather than pulsing as one. */
const STEP = ['', 'loader-step-2', 'loader-step-3', 'loader-step-4']

/** Five dot arrangements on the same 48x48 box the ring lives on. */
const DOT_LAYOUTS: { cx: number; cy: number; r: number }[][] = [
  // row
  [
    { cx: 14, cy: 24, r: 3.5 },
    { cx: 24, cy: 24, r: 3.5 },
    { cx: 34, cy: 24, r: 3.5 },
  ],
  // diamond
  [
    { cx: 24, cy: 11, r: 3.5 },
    { cx: 37, cy: 24, r: 3.5 },
    { cx: 24, cy: 37, r: 3.5 },
    { cx: 11, cy: 24, r: 3.5 },
  ],
  // 2x2 grid
  [
    { cx: 17, cy: 17, r: 3 },
    { cx: 31, cy: 17, r: 3 },
    { cx: 17, cy: 31, r: 3 },
    { cx: 31, cy: 31, r: 3 },
  ],
  // single pulse, centred
  [{ cx: 24, cy: 24, r: 5.5 }],
  // pair
  [
    { cx: 18, cy: 24, r: 4.5 },
    { cx: 30, cy: 24, r: 4.5 },
  ],
]

/** Four ring arcs: dash length + sweep direction. */
const RING_ARCS: { dash: string; reverse: boolean }[] = [
  { dash: '86 42', reverse: false },
  { dash: '58 70', reverse: true },
  { dash: '112 16', reverse: false },
  { dash: '40 88', reverse: true },
]

const RING_R = 18

function LoaderArt({
  dots,
  arc,
  gradientReversed,
  onScrim,
}: {
  dots: { cx: number; cy: number; r: number }[]
  arc: { dash: string; reverse: boolean }
  gradientReversed: boolean
  onScrim: boolean
}) {
  const gradId = useId()
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      className={`size-14 ${onScrim ? 'text-scrim-foreground' : 'text-primary'}`}
    >
      <defs>
        <linearGradient
          id={gradId}
          x1={gradientReversed ? '1' : '0'}
          y1="0"
          x2={gradientReversed ? '0' : '1'}
          y2="1"
        >
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <circle
        className={`loader-ring ${arc.reverse ? 'loader-sweep-rev' : 'loader-sweep'}`}
        style={{ transformOrigin: '24px 24px' }}
        cx="24"
        cy="24"
        r={RING_R}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={arc.dash}
      />
      {dots.map((d, i) => (
        <circle
          key={`${d.cx}-${d.cy}`}
          className={`loader-dot ${STEP[i % STEP.length]}`}
          cx={d.cx}
          cy={d.cy}
          r={d.r}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

export const LOADERS: Record<LoaderId, LoaderDef> = Object.fromEntries(
  Array.from({ length: 20 }, (_, index) => {
    const id = `g${index}`
    const dots = DOT_LAYOUTS[index % DOT_LAYOUTS.length]
    const arc = RING_ARCS[index % RING_ARCS.length]
    const gradientReversed = index % 2 === 1
    return [
      id,
      {
        id,
        Art: ({ onScrim = false }: { onScrim?: boolean }) => (
          <LoaderArt
            dots={dots}
            arc={arc}
            gradientReversed={gradientReversed}
            onScrim={onScrim}
          />
        ),
      },
    ]
  }),
)

export const LOADER_IDS = Object.keys(LOADERS)
