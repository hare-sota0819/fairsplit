import { LOADERS, LOADER_IDS, type LoaderId } from './registry'

export { ACTIVE_LOADERS, nextLoader } from './config'
export { LOADERS, LOADER_IDS } from './registry'
export type { LoaderId, LoaderDef } from './registry'

/**
 * The app's loading indicators.
 *
 * Phase 4B deleted the six illustrated animations (airliner, coins,
 * banknotes, baggage carousel, passport stamp, receipt) and the
 * `/dev/loaders` gallery. What replaced them is a set drawn from the SAME
 * traditional motifs as the background patterns — five frames of one visual
 * idea rather than a cast of characters. See registry.tsx and
 * docs/DESIGN_SPEC.md §5.8.
 */

/**
 * Full-screen route fallback: one motif animating, plus a caption.
 *
 * `id` is explicit wherever the caller can pick — the navigation overlay
 * rotates through the set so a trip shows all of them. With no `id` this
 * renders the first, which keeps server-rendered fallbacks deterministic.
 *
 * `data-testid="route-loading"` is load-bearing for the e2e suite and does
 * not change.
 */
export function RouteLoader({
  caption,
  label,
  id,
  onScrim = false,
}: {
  caption: string
  /** Accessible name when the visible line is a tip rather than a status. */
  label?: string
  id?: LoaderId
  /**
   * Sitting on the dark scrim rather than on the page. The scrim dims
   * whatever theme is underneath it, so the indicator has to stop following
   * the theme and commit to light-on-dark.
   */
  onScrim?: boolean
}) {
  const { Art } = LOADERS[id ?? LOADER_IDS[0]] ?? LOADERS[LOADER_IDS[0]]
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="route-loading"
      // w-full + a max width on the caption: without them the caption is
      // sized by its own text inside a centred column and a long line is
      // clipped at both edges rather than wrapping.
      className={`flex w-full flex-1 flex-col items-center justify-center gap-5 px-8 py-10 ${
        onScrim ? 'text-scrim-foreground' : 'text-primary'
      }`}
    >
      {/* The ring + dots family (registry.tsx). Sem's body lives only in
          chat (docs/BRAND.md v2 §4e), so a route loader is monochrome ink
          — its voice is the caption. */}
      <Art onScrim={onScrim} />
      <span
        className={`max-w-xs text-center text-balance ${
          onScrim
            ? 'text-base font-medium text-scrim-foreground'
            : 'text-sm text-muted-foreground'
        }`}
      >
        {caption}
      </span>
    </div>
  )
}

/** In-place spinner for buttons and cards (never full-screen). */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`fs-spin size-4 ${className}`}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
