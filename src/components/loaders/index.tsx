import { MiniShuttle } from '../motion/rules'
import { LOADERS, LOADER_IDS, type LoaderId } from './registry'

export { ACTIVE_LOADERS, nextLoader } from './config'
export { LOADERS, LOADER_IDS } from './registry'
export type { LoaderId, LoaderDef } from './registry'

/**
 * The app's loading indicators.
 *
 * There are no spinners and no rotation anywhere: waiting is a ledger
 * writing itself (SPEC-LOADERS §A) for a route or a cold start, a hairline
 * shuttle where an action happened, and the commit button's own underline
 * for a save. See registry.tsx.
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
      {/* The ledger writing itself (registry.tsx) — monochrome ink; its
          voice is the caption. */}
      <Art onScrim={onScrim} />
      <span
        // Caption: 13.5px meta grey on paper (SPEC-LOADERS §A). On the
        // scrim it stays a shade heavier so it survives the dimmed page.
        className={`max-w-xs text-center text-balance ${
          onScrim
            ? 'text-base font-medium text-scrim-foreground'
            : 'text-[13.5px] text-[#8a8a8a]'
        }`}
      >
        {caption}
      </span>
    </div>
  )
}

/**
 * In-place wait, for buttons and cards (never full-screen).
 *
 * NOT A SPINNER — the grammar has none. A wait is a hairline whose ink
 * segment shuttles across a 56px track, stated where the action happened
 * (SPEC-LOADERS "인라인 배치"). The export keeps its old name so the call
 * sites that already say "show that this is working" do not have to change.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return <MiniShuttle className={className} />
}
