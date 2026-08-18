/**
 * P0 — pure preprocessing (spec §2.3 P0, §5.2).
 *
 * NFC-normalizes, strips emoji, collapses any run of 3+ identical characters
 * down to exactly 2 (spec: "collapse repeated punctuation/물결표/자모 runs" —
 * 넹~~~~~~ -> 넹~~, ㅋㅋㅋㅋㅋ -> ㅋㅋ, ??? -> ??), and trims. Both the
 * collapsed text and a whitespace-removed "shadow" are returned — F-1:
 * Korean chat routinely omits spaces (나얼마내면돼), so matchers try both.
 *
 * Deliberately does NOT fold a run down to a single character. CONFIRM_TOKENS
 * and NEGATE_TOKENS list 'ㅇ'/'ㅇㅇ'/'ㅇㅇㅇ' and 'ㄴㄴ'/'ㄴㄴㄴ' as DISTINCT
 * rows (a different run length is a different lexicon entry, same intent) —
 * folding a run down to length 1 would erase that distinction, and per the
 * brief's invariant, must never turn 'ㄴㄴ' into 'ㄴ'. Capping at 2 instead of
 * 1 also leaves 'ㄴㅇㅈ' (three DIFFERENT jamo, no repeated run at all)
 * completely untouched — nothing to collapse there in the first place.
 *
 * This is also why normalization is safe to apply to lexicon token surfaces
 * themselves (at classify.ts's module load) as well as to runtime input:
 * capping-at-2 is idempotent (normalize(normalize(x).text) === normalize(x)),
 * since a post-collapse string never has a run of 3+ characters left to
 * collapse again — so a pre-normalization surface like '넹~~' (2 tildes,
 * already the canonical form) is untouched, while a noisier runtime input
 * like '넹~~~~~~' collapses down to meet it.
 */

export interface Normalized {
  readonly text: string
  readonly shadow: string
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu
// Excludes 0-9: a repeated-digit run is a real number ('40000' must never
// collapse to '400') — collapsing is only ever meant for decorative
// repetition (jamo/punctuation/tilde), never a quantity.
const RUN_RE = /([^0-9])\1{2,}/gu
const WHITESPACE_RE = /\s+/g

export function normalize(input: string): Normalized {
  const text = input
    .normalize('NFC')
    .replace(EMOJI_RE, '')
    .replace(RUN_RE, '$1$1')
    .trim()
  const shadow = text.replace(WHITESPACE_RE, '')
  return { text, shadow }
}
