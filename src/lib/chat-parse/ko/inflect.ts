import { combineCharacter, disassembleCompleteCharacter } from 'es-hangul'

/**
 * Jamo-level inflection helpers — the GRAMMAR half of Korean verb/adjective
 * recognition. The lexicons (ko/lexicon-verbs.ts) hold STEMS only; every
 * inflected surface form is produced (or taken apart) here.
 *
 * This split is the branch's own lesson (docs/SOLVED.md [2026-08-13], the
 * readKoreanNumber series): endings are a small closed grammar, stems are an
 * open lexicon — enumerating their PRODUCT (냈어/냈다/냈고/냈는데/…) is how a
 * list ends up narrower than the domain it claims to cover.
 *
 * Every function here answers with candidates, never with a guess: an input
 * these rules cannot analyse yields `[]`/`null`, and the caller reports no
 * hit. A wrong analysis is strictly worse than none (docs/SOLVED.md, "unknown
 * → no hit").
 */

interface Jamo {
  choseong: string
  jungseong: string
  jongseong: string
}

function partsOf(ch: string | undefined): Jamo | null {
  if (ch === undefined) return null
  return disassembleCompleteCharacter(ch) ?? null
}

/** The final consonant of `ch`, or `''` when it has none / is not a syllable. */
export function jongseongOf(ch: string): string {
  return partsOf(ch)?.jongseong ?? ''
}

/** `ch` with `jong` as its final consonant; null when that is not a syllable. */
export function setJongseong(ch: string, jong: string): string | null {
  const parts = partsOf(ch)
  if (!parts) return null
  try {
    return combineCharacter(parts.choseong, parts.jungseong, jong)
  } catch {
    return null
  }
}

/** `ch` with its final consonant removed; null when it is not a syllable. */
export function clearJongseong(ch: string): string | null {
  return setJongseong(ch, '')
}

/**
 * `stem` + a fused single-consonant ending (ㄴ/ㄹ/ㅁ), the shape Korean uses
 * when the ending is a bare consonant rather than a syllable:
 * 고르+ㄴ → 고른, 하+ㄴ → 한, 쏘+ㄹ → 쏠, 내+ㅁ → 냄.
 *
 * ㄹ-final stems DROP their ㄹ first (만들+ㄴ → 만든), but only before ㄴ/ㄹ:
 * ㅁ after a ㄹ-final stem writes 만듦, not 만듬, and this function will not
 * produce a form it cannot spell — it returns null instead. A stem whose last
 * syllable carries any other batchim cannot take a fused ending at all (it
 * takes the syllabic 은/을 instead) and yields null too.
 */
export function fuseEnding(stem: string, jong: string): string | null {
  const last = stem.at(-1)
  if (last === undefined) return null
  const batchim = jongseongOf(last)
  if (batchim === jong && jong === 'ㄹ') return stem // 살 + ㄹ → 살
  if (batchim === 'ㄹ') {
    if (jong !== 'ㄴ' && jong !== 'ㄹ') return null
    const dropped = clearJongseong(last)
    if (dropped === null) return null
    const fused = setJongseong(dropped, jong)
    return fused === null ? null : stem.slice(0, -1) + fused
  }
  if (batchim !== '') return null
  const fused = setJongseong(last, jong)
  return fused === null ? null : stem.slice(0, -1) + fused
}

/**
 * The inverse of `fuseEnding`: stems that could have produced `surface` by
 * fusing `jong` onto their last syllable. Two candidates, because the fusion
 * is lossy — 만든 un-fuses to 만드 (a plain stem) OR 만들 (a ㄹ-final stem
 * whose ㄹ dropped), and only the lexicon can say which exists.
 */
export function unfuseEnding(surface: string, jong: string): string[] {
  const last = surface.at(-1)
  if (last === undefined || jongseongOf(last) !== jong) return []
  const base = clearJongseong(last)
  if (base === null) return []
  const head = surface.slice(0, -1)
  const plain = head + base
  const withRieul = setJongseong(base, 'ㄹ')
  return withRieul === null ? [plain] : [plain, head + withRieul]
}

/**
 * Contracted -아/-어 vowels mapped back to the stem vowel they contracted
 * FROM: 봐 ← 보+아, 줘 ← 주+어, 켜 ← 키+어, 돼 ← 되+어. (es-hangul reports
 * compound vowels as their two component jamo, hence the two-character keys.)
 *
 * Deliberately partial — only the contractions that are unambiguous. A vowel
 * absent from this table simply produces no extra candidate, which costs a
 * recognition (safe) rather than inventing a stem that does not exist.
 */
const UNCONTRACT: ReadonlyMap<string, string> = new Map([
  ['ㅗㅏ', 'ㅗ'], // ㅘ: 봐 → 보, 와 → 오
  ['ㅜㅓ', 'ㅜ'], // ㅝ: 줘 → 주
  ['ㅕ', 'ㅣ'], // 켜 → 키, 셔 → 시
  ['ㅗㅐ', 'ㅗㅣ'], // ㅙ → ㅚ: 돼 → 되
])

/** `word` with its last syllable's vowel un-contracted, when this table knows
 * how; `null` otherwise (including when the syllable carries a batchim). */
function uncontractLast(word: string): string | null {
  const last = word.at(-1)
  if (last === undefined) return null
  const parts = partsOf(last)
  if (!parts || parts.jongseong !== '') return null
  const jungseong = UNCONTRACT.get(parts.jungseong)
  if (jungseong === undefined) return null
  try {
    return word.slice(0, -1) + combineCharacter(parts.choseong, jungseong, '')
  } catch {
    return null
  }
}

/**
 * Candidate stems for a PAST form: 먹었 → 먹, 했 → 하, 냈 → 내, 샀 → 사,
 * 줬 → 주, 시켰 → 시키.
 *
 * Two shapes, because Korean writes the past marker either as its own
 * syllable (았/었/였, after a consonant-final stem) or fused into the stem's
 * own syllable as a ㅆ batchim (내+었 → 냈). 했 is listed separately only
 * because 하+였 → 했 collapses both the vowel and the stem's syllable.
 */
export function stripPast(word: string): string[] {
  const last = word.at(-1)
  if (last === undefined || word.length < 2) return []
  if (last === '았' || last === '었' || last === '였') return [word.slice(0, -1)]
  if (last === '했') return [`${word.slice(0, -1)}하`]
  if (jongseongOf(last) !== 'ㅆ') return []
  const base = clearJongseong(last)
  if (base === null) return []
  const contracted = word.slice(0, -1) + base
  const uncontracted = uncontractLast(contracted)
  return uncontracted === null ? [contracted] : [contracted, uncontracted]
}

/**
 * Candidate stems for an -아/-어 infinitive form (the half that -서/-도/-야
 * attach to): 먹어 → 먹, 추천해 → 추천하, 봐 → 보, 사 → 사.
 *
 * The identity candidate is real, not a fallback: a stem ending in ㅏ/ㅓ
 * absorbs the vowel entirely (사+아 → 사), so the infinitive form and the
 * stem are the same string.
 */
export function stripInfinitive(word: string): string[] {
  const last = word.at(-1)
  if (last === undefined) return []
  if (last === '해' && word.length >= 2) return [`${word.slice(0, -1)}하`]
  const candidates: string[] = []
  if ((last === '아' || last === '어' || last === '여') && word.length >= 2) {
    candidates.push(word.slice(0, -1))
  }
  if (jongseongOf(last) === '' && partsOf(last) !== null) {
    candidates.push(word)
    const uncontracted = uncontractLast(word)
    if (uncontracted !== null) candidates.push(uncontracted)
  }
  return candidates
}
