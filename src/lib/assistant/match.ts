/**
 * Small pure matchers (spec §5.1's `match.ts`) — the two matching disciplines
 * the ladder needs, kept apart on purpose:
 *
 * - `hasToken` — spec §2.3 P1 / §2.7's token-boundary law: WHOLE-INPUT
 *   equality against a lexicon token, never a substring. Used for
 *   CONFIRM_YES/CONFIRM_NO_CANCEL/HOLD/NEITHER, where `ㄴㅇㅈ` containing
 *   `ㅇㅈ` must never fire.
 * - `hasPhrase` — spec §2.3 P2 / the matcher contract documented in
 *   `lexicons/query.ts`'s header: a literal CONTIGUOUS SUBSTRING check, not a
 *   word-sequence-with-gaps check. Used for CONFIRM_MODIFY's correction
 *   frames and QUERY's per-intent markers, which are checked WITHIN a longer
 *   message rather than against the whole of it.
 *
 * Both normalize the lexicon side of the comparison with the same P0 pass
 * runtime input goes through, so a pre-normalization surface (e.g. '넹~~')
 * and a noisier runtime one ('넹~~~~~~') land on the same string.
 */

import { isWordChar } from './hangul-number'
import { normalize } from './normalize'

/** spec §2.3 P1 — whole-input equality against a lexicon token. */
export function hasToken(inputText: string, token: string): boolean {
  return inputText === normalize(token).text
}

/** spec §2.3 P2 / query.ts's matcher contract — contiguous substring. */
export function hasPhrase(haystack: string, pattern: string): boolean {
  return haystack.includes(normalize(pattern).text)
}

/**
 * Contiguous substring, but only where NOT glued to more of the same kind
 * of character on either side (collision #21: en `we` is a substring of
 * `owe`/`owes`/`square` and must not fire inside them). Reuses the same
 * script-agnostic word-char boundary rule as §2.7's token-boundary law
 * (`isWordChar`, the single owner in hangul-number.ts). Korean deliberately
 * does NOT use this: particles/endings glue directly onto a marker with no
 * boundary at all (얼마+지, 남았+어), so a boundary requirement there would
 * reject the normal case, not the trap.
 */
export function hasWordPhrase(haystack: string, pattern: string): boolean {
  const needle = normalize(pattern).text
  let from = 0
  while (true) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return false
    const before = haystack[at - 1]
    const after = haystack[at + needle.length]
    if (!isWordChar(before) && !isWordChar(after)) return true
    from = at + 1
  }
}

/**
 * Contiguous substring, but rejects a match glued to a word-char immediately
 * BEFORE it — a LEADING-only boundary, unlike `hasWordPhrase`'s both-sides
 * check. Korean particles/endings legitimately glue AFTER a marker (얼마+지,
 * 남았+어), which is why ko query matching doesn't use a trailing check —
 * but a marker glued to more content BEFORE it is still a real trap: `나`
 * (QUERY_MY_SPENDING's firstPerson marker) is the last syllable of `얼마나`
 * ("how much/many"), which has nothing to do with the first-person pronoun.
 * Used only where a ko marker is short enough (a single syllable) to risk
 * appearing as another word's tail.
 */
export function hasLeadingBoundaryPhrase(
  haystack: string,
  pattern: string,
): boolean {
  const needle = normalize(pattern).text
  let from = 0
  while (true) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return false
    if (!isWordChar(haystack[at - 1])) return true
    from = at + 1
  }
}
