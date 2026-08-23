/**
 * THE LEDGER WRITING ITSELF (SPEC-LOADERS §A) — the context-free loader.
 *
 * Statement rows appear top→down: each row is a grey label stub, a dotted
 * leader on a 7px pitch, and an ink amount stub. Rows fade and rise 5px into
 * place, staggered ~17% of the cycle, and then a DOUBLE RULE closes the
 * ledger — the same "done" gesture the commit button draws. The whole thing
 * fades and replays. No spinner, no arc, no rotation anywhere.
 *
 * TWENTY FIGURES, for the same reason as every set before it: one figure on
 * every navigation reads as a fixed graphic rather than as the app working.
 * The combinations are row count (3-5) x stub widths x cycle length
 * (2.8-3.4s), and `config.ts` still draws one at random per mount. The ids
 * are still g0…g19 and the exports are unchanged, so index.tsx, config.ts
 * and every consumer are untouched.
 *
 * COLOUR. The figure is monochrome currentColor, so it inherits
 * text-primary on paper and text-scrim-foreground on the overlay exactly
 * like the sets before it. The opacities are chosen so that on the light
 * page the rendered result IS the spec's palette: the amount stub is ink
 * #141414 at full strength, the label stub lands on #b8b8b8 and the leader
 * dots on #c8c8c8.
 *
 * Reduced motion: globals switches the row animations off, and the rows'
 * resting state is the finished statement — a complete, legible still.
 */

export type LoaderId = string

export interface LoaderDef {
  id: LoaderId
  Art: (props: { onScrim?: boolean }) => React.ReactElement
}

/** Row entrance classes, in order. Row 5 exists only on the tallest ledger. */
const ROW_ANIM = [
  'sem-ldg-r1',
  'sem-ldg-r2',
  'sem-ldg-r3',
  'sem-ldg-r4',
  'sem-ldg-r5',
]

/** Label stub widths, 30-52px (spec §A). */
const LABEL_W = [38, 50, 30, 44, 34, 52, 40, 32, 46, 36]
/** Amount stub widths, 22-30px (spec §A). */
const AMOUNT_W = [24, 30, 22, 26, 28, 23, 29, 25, 27, 30]

interface Recipe {
  rows: number
  cycle: string
  /** Index into LABEL_W / AMOUNT_W for this figure's first row. */
  offset: number
}

/**
 * Twenty recipes. Row count walks 3-4-5 so no two neighbours match, the
 * width offset walks the pools coprime-ish so no two figures repeat a
 * width run, and the cycle covers the spec's 2.8-3.4s band.
 */
const RECIPES: Recipe[] = Array.from({ length: 20 }, (_, index) => ({
  rows: 3 + (index % 3),
  cycle: `${(2.8 + (index % 7) * 0.1).toFixed(1)}s`,
  offset: (index * 3) % LABEL_W.length,
}))

function LedgerArt({ recipe, onScrim }: { recipe: Recipe; onScrim: boolean }) {
  const closing = recipe.rows === 5 ? 'sem-ldg-rr5' : 'sem-ldg-rr'
  return (
    <div
      aria-hidden="true"
      className={`flex w-42 flex-col gap-[13px] ${
        onScrim ? 'text-scrim-foreground' : 'text-primary'
      }`}
      style={{ ['--sem-ldg-cycle' as string]: recipe.cycle }}
    >
      {Array.from({ length: recipe.rows }, (_, row) => {
        const slot = (recipe.offset + row) % LABEL_W.length
        return (
          <div key={row} className={`flex items-center gap-2 ${ROW_ANIM[row]}`}>
            <span
              className="h-px bg-current opacity-30"
              style={{ width: `${LABEL_W[slot]}px` }}
            />
            <span className="sem-leader h-px flex-1 opacity-20" />
            <span
              className="h-px bg-current"
              style={{ width: `${AMOUNT_W[slot]}px` }}
            />
          </div>
        )
      })}
      {/* The double rule closes the ledger. */}
      <div className={`mt-px ${closing}`}>
        <div className="h-px bg-current" />
        <div className="mt-0.5 h-px bg-current" />
      </div>
    </div>
  )
}

export const LOADERS: Record<LoaderId, LoaderDef> = Object.fromEntries(
  RECIPES.map((recipe, index) => {
    const id = `g${index}`
    return [
      id,
      {
        id,
        Art: ({ onScrim = false }: { onScrim?: boolean }) => (
          <LedgerArt recipe={recipe} onScrim={onScrim} />
        ),
      },
    ]
  }),
)

export const LOADER_IDS = Object.keys(LOADERS)
