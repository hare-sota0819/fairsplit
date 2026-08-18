/**
 * Refiners: the stage that turns several parsers' independent readings of the
 * SAME sentence into one set of non-overlapping hits.
 *
 * Every parser in `parsers/` reads the sentence for its own thing and reports
 * what it honestly sees, spans and all. Two of them can therefore claim the
 * same characters — "split 3 ways" is an n-ways split expression to
 * `findSplit` AND (with a big enough count, "split 300 ways") a bare number to
 * `findAmounts`; a member name that is also a numeral would be a person hit
 * inside an amount span. Deciding between them is NOT each parser's job — a
 * parser that second-guesses its neighbours is a second grammar, which is this
 * branch's most expensive recurring mistake (docs/SOLVED.md [2026-08-13]).
 * It is this file's job, and it decides by ONE rule for every pair:
 *
 *   sort by (start ASC, length DESC, confidence DESC), then keep every hit
 *   that does not overlap one already kept.
 *
 * Longer-before-shorter at the same start is what makes "the longer/marked
 * span wins" fall out rather than being special-cased per pair, and it is why
 * "split 3 ways"'s 3 can never also be an amount: the split hit starts no
 * later and runs longer, so it is kept first and the amount inside it is
 * dropped.
 */

/** A half-open `[start, end)` slice of the input. */
export interface Span {
  start: number
  end: number
}

/**
 * What the refiner needs to know about a hit, whatever its type.
 *
 * `priority` breaks a tie only when two hits claim the EXACT same span with
 * the EXACT same confidence — it exists so the outcome is a property of the
 * hits rather than of which parser happened to run first, not as a way to
 * rank parsers against each other.
 */
export interface RefineKey extends Span {
  /** 0..1, as the producing parser reported it. */
  confidence: number
  /** Lower wins an otherwise exact tie. */
  priority: number
}

/**
 * `items` ordered the way the single-pass refiner consumes them. Exported so
 * a test can pin the ORDER independently of the dropping, and so the sort is
 * written down once.
 *
 * The final `index` tiebreak makes the order total: two hits identical in
 * span, confidence AND priority keep their input order, so `refineHits` is
 * deterministic for any input rather than relying on the engine's sort being
 * stable.
 */
export function orderHits<T>(items: readonly T[], key: (item: T) => RefineKey): T[] {
  return items
    .map((item, index) => ({ item, index, k: key(item) }))
    .sort(
      (a, b) =>
        a.k.start - b.k.start ||
        b.k.end - b.k.start - (a.k.end - a.k.start) ||
        b.k.confidence - a.k.confidence ||
        a.k.priority - b.k.priority ||
        a.index - b.index,
    )
    .map((e) => e.item)
}

/**
 * The winners: `items` in refine order, each kept only if its span is free of
 * every span kept before it. Empty spans (`end <= start`) are dropped — they
 * consume nothing, so they can neither win nor lose an overlap.
 */
export function refineHits<T>(items: readonly T[], key: (item: T) => RefineKey): T[] {
  const kept: Span[] = []
  const out: T[] = []
  for (const item of orderHits(items, key)) {
    const k = key(item)
    if (k.end <= k.start) continue
    if (kept.some((w) => k.start < w.end && k.end > w.start)) continue
    kept.push({ start: k.start, end: k.end })
    out.push(item)
  }
  return out
}

/**
 * `input` with every span replaced by a single space — the description
 * reconstruction rule in one place: what is left of the sentence is exactly
 * the text no accepted hit claimed.
 *
 * A space rather than nothing, so removing a span never glues its two
 * neighbours into a word that was never written; the caller collapses runs of
 * whitespace afterwards.
 */
export function removeSpans(input: string, spans: readonly Span[]): string {
  let rest = input
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    rest = rest.slice(0, s.start) + ' ' + rest.slice(s.end)
  }
  return rest
}
