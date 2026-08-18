/**
 * NEITHER_TOKENS — the "neither yes nor no" decoy family spec §5.1 names
 * alongside YES/NO/HOLD. Every row here is an appendix-G trap (§3.2/§3.3
 * NEGATIVE) or a §3.11 UNKNOWN→GUIDED atom: a token that LOOKS like it
 * might confirm/cancel/help but must classify as UNKNOWN with a guided
 * `suggest` list instead, so classify.ts (T3) never has to hardcode this
 * set as literals.
 *
 * `context` matters because several tokens (글쎄, 몰라, ㅋㅋ, ㅎㅎ, ㅠㅠ,
 * `not sure`) are attested TWICE with different routing depending on
 * whether a confirm card is open: with a card open they read as an
 * ambiguous yes/no (§3.2/§3.3 NEGATIVE, `suggest: [CONFIRM_YES,
 * CONFIRM_NO_CANCEL]`); with no card open they read as a non-answer
 * (§3.11, `suggest: [HELP]` or, for bare `?`/`??`, the three-way guided
 * list). Both rows are kept — this is not a duplicate, it is
 * context-dependent routing, the same shape as a lexicon fact.
 */

import type { Freq, Locale } from './types'

export type SuggestIntent =
  | 'CONFIRM_YES'
  | 'CONFIRM_NO_CANCEL'
  | 'HELP'
  | 'QUERY_MY_BALANCE'
  | 'QUERY_GROUP_TOTAL'

export interface NeitherTokenEntry {
  readonly token: string
  readonly locale: Locale
  /** Whether this routing applies only when a confirm card is open. */
  readonly context: 'cardOpen' | 'noCard'
  readonly suggest: readonly SuggestIntent[]
  readonly freq: Freq
}

const CONFIRM_SUGGEST = ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'] as const
const HELP_SUGGEST = ['HELP'] as const
const HELP_OR_QUERY_SUGGEST = [
  'HELP',
  'QUERY_MY_BALANCE',
  'QUERY_GROUP_TOTAL',
] as const

export const NEITHER_TOKENS = [
  // ===== card-open context — §3.2/§3.3 NEGATIVE (appendix G-1 traps) =====
  {
    token: 'ㄷㄷ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㅁㄹ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '하',
  },
  {
    token: 'ㅗㅜㅑ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '중',
  },
  {
    token: 'ㄱㅊ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㄴㄷ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '중',
  },
  {
    token: 'ㅎㅇ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '하',
  },
  {
    token: 'ㄱㅅ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㅅㄱ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㅈㅅ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㅊㅋ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㄲㅂ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '중',
  },
  {
    token: 'ㅂㅂ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '중',
  },
  {
    token: 'ㅇㅎ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '중',
  },
  {
    token: 'ㅋㅋ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㅎㅎ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㅠㅠ',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: '글쎄',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: '몰라',
    locale: 'ko',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },
  {
    token: 'not sure',
    locale: 'en',
    context: 'cardOpen',
    suggest: CONFIRM_SUGGEST,
    freq: '상',
  },

  // ===== no-card context — §3.11 UNKNOWN → GUIDED =====
  {
    token: '글쎄',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: '음',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: '흠',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: '몰라',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: '아마',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: '아마도',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㅋㅋ',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㅎㅎ',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: 'ㅠㅠ',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: '엥',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: '헐',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: '뭐래',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '중',
  },
  {
    token: '?',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_OR_QUERY_SUGGEST,
    freq: '상',
  },
  {
    token: '??',
    locale: 'ko',
    context: 'noCard',
    suggest: HELP_OR_QUERY_SUGGEST,
    freq: '상',
  },
  // en `?` is directly attested (§3.11 en table). en `??` is NOT directly
  // attested there (only the ko table has it) — added by symmetry per
  // reviewer instruction, freq marked lower to record that provenance
  // honestly.
  {
    token: '?',
    locale: 'en',
    context: 'noCard',
    suggest: HELP_OR_QUERY_SUGGEST,
    freq: '상',
  },
  {
    token: '??',
    locale: 'en',
    context: 'noCard',
    suggest: HELP_OR_QUERY_SUGGEST,
    freq: '하',
  },
  {
    token: 'not sure',
    locale: 'en',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: "I'm not sure",
    locale: 'en',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '상',
  },
  {
    token: '👍',
    locale: 'en',
    context: 'noCard',
    suggest: HELP_SUGGEST,
    freq: '하',
  },
] as const satisfies readonly NeitherTokenEntry[]
