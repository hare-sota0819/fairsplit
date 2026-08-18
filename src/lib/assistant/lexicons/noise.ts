/**
 * NOISE data — spec §5.1's `lexicon/noise.ts`: "strip lists: emoji, 물결표,
 * laughter runs, punctuation runs." `normalize.ts`'s emoji/run-collapse
 * regexes stay where they are (they're structural, not vocabulary), but the
 * punctuation CHARACTERS `classify.ts`'s §2.4 fragment check treats as
 * "leftover particles/punctuation, not content" are DATA, not a literal
 * character class typed inline.
 */

/**
 * Characters `classify.ts`'s fragment-remainder check discards after
 * stripping amount/member/split/funding spans — whitespace and the common
 * trailing punctuation a bare fragment ('40000?', '반반!') may still carry.
 * Deliberately does NOT include `?` at the top level of P0/P1 (spec §3.11:
 * bare `?`/`??` are meaningful on their own) — this list is scoped to the
 * narrower "is what's left just noise" check inside an already-open card's
 * fragment, not a general-purpose strip.
 */
export const FRAGMENT_NOISE_CHARS = [' ', ',', '.', '/', '~', '!', '?'] as const

/** Trailing punctuation stripped before P1's whole-token equality check (spec review M8) — never `?` (§3.11 keeps it meaningful). */
export const P1_TRAILING_STRIP_CHARS = ['!', '.'] as const

/**
 * Words the §2.4 fragment check treats as recognized noise even though
 * they're not themselves an independently-triggering MODIFY_PATTERNS
 * marker. `split` is the one case the corpus needs: MODIFY_PATTERNS'S own
 * split-field entry for the `split evenly` row is just `evenly` (the
 * shortest distinguishing substring, per modify.ts's own dedup convention)
 * — `split` alone is deliberately NOT a standalone marker (too generic to
 * trigger the split field on its own), but it must still count as "already
 * accounted for" so `split evenly`'s leading word doesn't look like
 * survived content. chat-parse's own EVERYONE regex recognizes bare
 * `\bsplit\b` for the identical reason (`hasSplitKeyword('split')` is
 * true) — this is the same fact, restated as fragment-check data because a
 * boolean predicate can't hand back a span to strip.
 */
/**
 * `으로` (ko) — DECISIONS.md 2026-08-10 erratum (f addendum): a bare amount
 * reply carrying the "change it TO ___" particle (`3만원으로`, the single
 * most natural reply to the assistant's own `얼마로 바꿀까요?` follow-up
 * question) used to fail `isFragment` on this word alone and fall through to
 * EXPENSE_ENTRY, superseding the open card with a junk draft literally
 * described "으로". `으로` carries no field/value information of its own —
 * `readAmountFragment` already closes the amount reading at `원`, so this
 * particle is always leftover, never content — so it is safe to always
 * treat as accounted-for noise the same way `split` is above.
 */
export const FRAGMENT_FILLER_WORDS = [
  { word: 'split', locale: 'en' },
  { word: '으로', locale: 'ko' },
] as const

/**
 * Trailing (suffix-only) words the §2.4 fragment check strips from the very
 * END of the remainder, to a FIXPOINT, AFTER `FRAGMENT_NOISE_CHARS` —
 * DECISIONS.md 2026-08-10 erratum (f), closing round. Unlike
 * `FRAGMENT_FILLER_WORDS` above (a substring strip, safe ANYWHERE in the
 * string), these are only safe to strip when they are the LAST thing left:
 * `요` — a single common Hangul politeness-ending syllable — is a substring
 * of many unrelated words (필요/중요/요금/…), so stripping it as
 * `FRAGMENT_FILLER_WORDS`-style substring noise anywhere would be a real
 * corruption risk (the same risk the `을/를` safe-miss ruling refused to
 * take). Stripping it only when it is the TAIL of an otherwise-empty
 * remainder carries none of that risk — a false trailing match can only
 * ever consume characters that were already the last un-accounted-for
 * scrap, never eat into real content sitting earlier in the message.
 *
 * Longest-first order is required, not cosmetic: `해주세요` itself ends in
 * `요`, so checking bare `요` FIRST would strip it down to `해주세` and
 * stop there (one syllable short of matching any other listed word) — the
 * fixpoint loop would terminate on a non-empty residue even though the
 * whole tail was accounted-for politeness/request phrasing. Checking
 * `해주세요` before `해줘` before bare `요` always consumes the longest
 * match available at each step.
 *
 * `로` — T3 fix round 1 (I1). `으로` was already covered by
 * `FRAGMENT_FILLER_WORDS` above, but Korean drops the 으 after a VOWEL-final
 * noun: `3만원으로` (consonant-final 원) versus `50달러로`, `50유로로`. Every
 * currency word the tests happened to exercise ended in a consonant, so the
 * vowel-final half of the paradigm had never run — and a reply naming 달러 or
 * 유로 left a lone `로` in the remainder, failed the fragment check, and
 * superseded the open card with a junk draft literally described "로".
 *
 * TRAILING-only, not a `FRAGMENT_FILLER_WORDS` substring strip: `로` is one of
 * the commonest syllables in the language (로마, 따로, 새로), and stripping it
 * anywhere would eat into real content. As the tail of an otherwise-empty
 * remainder it can only ever consume a scrap that was already unaccounted for.
 */
export const FRAGMENT_TRAILING_WORDS = [
  { word: '해주세요', locale: 'ko' },
  { word: '해줘', locale: 'ko' },
  { word: '요', locale: 'ko' },
  { word: '로', locale: 'ko' },
] as const
