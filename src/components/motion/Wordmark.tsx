import { cn } from '@/lib/utils'

/**
 * THE WORDMARK ODOMETER (SPEC-LOADERS §B) — splash / sign-in identity.
 *
 * Three 1em-tall overflow-hidden columns roll LOOKALIKE glyphs and land
 * left→right on S · e · m, then STOP. Nothing moves after the landing: the
 * mark is the resting state, not a loop.
 *
 * Glyph ladders, lock points and easing are copied from the reference:
 *   S: $ 5 § ∫ Š → S      locks at 32%
 *   e: € ℮ ə є 3 6 ℯ → e  locks at 56%
 *   m: ₥ м ɱ ∏ ᴍ ʈ ∩ w ɯ → m  locks at 80%
 * cubic-bezier(.2,.7,.3,1) over 4.4s, played ONCE per load and held.
 *
 * Reduced motion: the animation is switched off and each column already
 * renders parked on its landing glyph, so the wordmark is simply there.
 */

const COLUMNS: { glyphs: string[]; roll: string; land: number }[] = [
  { glyphs: ['$', '5', '§', '∫', 'Š', 'S'], roll: 'sem-word-1', land: 5 },
  {
    glyphs: ['€', '℮', 'ə', 'є', '3', '6', 'ℯ', 'e'],
    roll: 'sem-word-2',
    land: 7,
  },
  {
    glyphs: ['₥', 'м', 'ɱ', '∏', 'ᴍ', 'ʈ', '∩', 'w', 'ɯ', 'm'],
    roll: 'sem-word-3',
    land: 9,
  },
]

export function Wordmark({
  size = 56,
  className,
}: {
  /** Type size in px. The spec's splash size is 56. */
  size?: number
  className?: string
}) {
  return (
    <span className={cn('inline-flex', className)}>
      <span className="sr-only">Sem</span>
      <span
        aria-hidden="true"
        className="flex font-heading leading-none text-foreground"
        style={{ fontSize: `${size}px` }}
      >
        {COLUMNS.map((column) => (
          <span
            key={column.roll}
            className="overflow-hidden"
            style={{ height: '1em' }}
          >
            <span
              className={`flex flex-col items-center ${column.roll}`}
              style={{ transform: `translateY(-${column.land}em)` }}
            >
              {column.glyphs.map((glyph, index) => (
                <span
                  key={glyph}
                  style={{ height: '1em' }}
                  className={
                    // The landing "e" is the wordmark's italic e.
                    column.roll === 'sem-word-2' && index === column.land
                      ? 'italic'
                      : undefined
                  }
                >
                  {glyph}
                </span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </span>
  )
}
