import { disassembleCompleteCharacter, hasBatchim } from 'es-hangul'
import { JOSA } from './lexicon-josa'

/**
 * JOSA entries whose allomorph alternates on the stem's final batchim —
 * everything else in the mined inventory attaches regardless (도/만/의/에/
 * 보다/까지/…). Two shapes of alternation:
 *  - Suppletive pairs with no string relationship (이/가, 은/는, 을/를,
 *    과/와) plus the agglutinative "이-/으-prefix" pairs mined into JOSA
 *    (이랑/랑, 이나/나, 이라도/라도) — batchim takes the LEFT member of each
 *    pair, no batchim takes the RIGHT.
 *  - The 로-family (로/으로, 로서/으로서, 로써/으로써), which alternates on
 *    the SAME axis but with an extra exception: a ㄹ-final batchim takes
 *    the bare (no-으) form too, not the 으-form — handled by `RO_FAMILY`
 *    below rather than folding into the two sets above.
 */
const BATCHIM_PAIRS: ReadonlyArray<readonly [batchimForm: string, noBatchimForm: string]> = [
  ['이', '가'],
  ['은', '는'],
  ['을', '를'],
  ['과', '와'],
  ['이랑', '랑'],
  ['이나', '나'],
  ['이라도', '라도'],
]
const BATCHIM_REQUIRED = new Set(BATCHIM_PAIRS.map(([b]) => b))
const NO_BATCHIM_REQUIRED = new Set(BATCHIM_PAIRS.map(([, n]) => n))

/** [으-form, bare-form] — both alternate on batchim, with a ㄹ exception on the bare form. */
const RO_FAMILY: ReadonlyArray<readonly [euForm: string, bareForm: string]> = [
  ['으로', '로'],
  ['으로서', '로서'],
  ['으로써', '로써'],
]
const RO_EU_FORM = new Set(RO_FAMILY.map(([eu]) => eu))
const RO_BARE_FORM = new Set(RO_FAMILY.map(([, bare]) => bare))

/**
 * Whether `josa` is a morphologically legal allomorph attaching to a stem
 * whose LAST character is `stemLastChar`. Exported so `parsers/people.ts`
 * can run the same agreement check in PREFIX mode (validating a josa that
 * sits in the middle of a token, e.g. "민수랑같이") without duplicating the
 * batchim rules — `detachJosa` below only answers the SUFFIX-mode question
 * ("does this whole word legally end in a josa").
 */
export function josaAgreesWithStem(stemLastChar: string, josa: string): boolean {
  const batchim = hasBatchim(stemLastChar)
  if (BATCHIM_REQUIRED.has(josa)) return batchim
  if (NO_BATCHIM_REQUIRED.has(josa)) return !batchim
  if (RO_EU_FORM.has(josa)) {
    if (!batchim) return false
    return disassembleCompleteCharacter(stemLastChar)?.jongseong !== 'ㄹ'
  }
  if (RO_BARE_FORM.has(josa)) {
    if (!batchim) return true
    return disassembleCompleteCharacter(stemLastChar)?.jongseong === 'ㄹ'
  }
  return true
}

/**
 * Splits `word` into stem + josa when the tail is a known josa AND the
 * allomorph agrees with the stem's final batchim. Tries JOSA longest-first
 * (its own sort order) so "이랑" is preferred over "랑" etc. Returns null
 * when no suffix of `word` is both a known josa and morphologically legal
 * for the resulting stem — this only answers "is this split legal," not "is
 * the result a real name" (see josaAgreesWithStem's doc for the
 * disambiguation split of responsibility). Callers are expected to pass a
 * hangul word (that's the only case `hasBatchim`/batchim agreement is
 * meaningful for); a non-hangul stem char makes `hasBatchim` return false,
 * which only ever matches the no-batchim branch of each pair — no runtime
 * guard against non-hangul input, since a wrong split there is harmless
 * (findPeople's own hangul-token gating is what actually keeps this
 * hangul-only in practice).
 */
export function detachJosa(word: string): { stem: string; josa: string } | null {
  for (const josa of JOSA) {
    if (word.length <= josa.length) continue
    if (!word.endsWith(josa)) continue
    const stem = word.slice(0, word.length - josa.length)
    const stemLastChar = stem[stem.length - 1]
    if (!josaAgreesWithStem(stemLastChar, josa)) continue
    return { stem, josa }
  }
  return null
}
