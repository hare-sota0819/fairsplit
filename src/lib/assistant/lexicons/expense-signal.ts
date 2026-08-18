/**
 * EXPENSE_SIGNAL data — spec §2.3 P5's second OR-branch: "a non-empty
 * description together with a pay-verb hit."
 *
 * Round 2 (reviewer's Seam): `chat-parse` now exports `hasPayVerb` (from
 * `people.ts`) and `hasSplitKeyword` (from `index.ts`) — the SAME
 * recognition `parse()`/`resolvePayer` already use, not a second, drifting
 * copy of that vocabulary. `classify.ts`'s P5 gate calls those directly.
 * `PAY_VERB_WORDS` and `SPLIT_FUNDING_WORDS` (the old mirrored word lists)
 * are deleted; a bare `cash`/`현금` funding signal is read off `parse()`'s
 * own `funding: 'NEW_CASH_WALLET'` result field instead of re-matched here.
 *
 * What's left is the ONE piece `hasPayVerb` cannot provide by itself:
 * `hasPayVerb` is deliberately loose for `계산`/`결제` (a false hit inside a
 * NOUN like `계산서`/`계산기` is harmless for `resolvePayer`'s purpose — it
 * just falls back to the actor). At the P5 ladder gate it is NOT harmless:
 * treating `계산서 받았어`/`계산기 어디 있어?` as pay-verb hits would wrongly
 * route two §3.1 NEGATIVE rows to EXPENSE_ENTRY instead of UNKNOWN. spec's
 * own §3.1 prose names the fix directly: "the parser backlog's known
 * 계산서/계산기 false-positive PAY_VERB is closed here by the
 * verbalizing-suffix rule (계산|결제 + 했|함|해|하|한|할), which is a DATA
 * table, not a regex disjunct." This file is that table — the tightening
 * layered ON TOP of `hasPayVerb`, not a replacement for it.
 */

import type { Freq, Locale, Tier } from './types'

export interface ExpenseSignalWord {
  readonly word: string
  readonly locale: Locale
  readonly tier: Tier
  readonly freq: Freq
}

/**
 * Pay-verb STEMS that are also common noun prefixes (계산서/계산기,
 * 결제서) — only a genuine hit when immediately followed by a verbalizing
 * suffix (spec §3.1's ruling).
 */
export const PAY_VERB_STEMS = [
  { word: '계산', locale: 'ko', tier: 'main', freq: '상' },
  { word: '결제', locale: 'ko', tier: 'main', freq: '상' },
] as const satisfies readonly ExpenseSignalWord[]

export const VERBALIZING_SUFFIXES = [
  '했',
  '함',
  '해',
  '하',
  '한',
  '할',
] as const
