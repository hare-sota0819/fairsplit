/**
 * DECOY_PHRASES — phrase-level (substring) markers for spec §2.6/§6's
 * ruled-always-UNKNOWN sentences: §6#6's D-7 "정산 진행 상태" questions (the
 * app has no per-member settled/unsettled state to answer them with), §6#7's
 * 모임통장/회비 (a shared bank account this app does not model), §6#8's
 * denomination/budget/multi-currency-total questions, and one thin-signal en
 * spending-vs-balance ambiguity (§3.7 en NEGATIVE).
 *
 * Unlike NEITHER_TOKENS (§2.3 P1 whole-input equality against a short
 * confirm-family token) or QUERY_MARKERS (per-intent AND-group legs), each
 * row here maps a literal contiguous substring (query.ts's matcher contract)
 * STRAIGHT to a specific `suggest` list — the exact spec-table value, not
 * the generic §4.8 ranking algorithm (there is nothing live to rank when the
 * question is about state the app doesn't track).
 *
 * classify.ts checks these FIRST in the query ladder (before any of the 5
 * QUERY_* AND-groups): several surface forms here would otherwise
 * false-positive into a real query intent — `다들 정산 얼마 남았어` carries
 * both a payFrame `정산` and an amountWord `얼마` and would misread as
 * QUERY_MY_BALANCE without this guard (spec §2.6's own worked example);
 * `이번 달 회비 총 얼마 걷혔어` carries both a groupMarker `총` and an
 * amountWord `얼마` and would misread as QUERY_GROUP_TOTAL.
 *
 * Every phrase below was collision-checked against every OTHER attested
 * §3.5-§3.11 row (main + 확장 + NEGATIVE) — see task-4-report.md for the
 * per-row audit.
 */

import type { Freq, Locale } from './types'

export type DecoySuggestIntent =
  | 'QUERY_MY_BALANCE'
  | 'QUERY_GROUP_TOTAL'
  | 'QUERY_MY_SPENDING'
  | 'QUERY_WALLET'

export interface DecoyPhraseEntry {
  readonly phrase: string
  readonly locale: Locale
  readonly suggest: readonly DecoySuggestIntent[]
  readonly freq: Freq
}

/**
 * Round-2 review (I1): §2.6's own "정산 얼마 남았어" worked example names
 * FIVE subject words that all route to D-7, not just `다들` (already
 * covered above by the broader `다들 정산` phrase, which also covers `다들
 * 정산 완료했어?`, a DIFFERENT sentence shape with no 남았 at all). These
 * four are scoped NARROWLY to the "정산...남았" frame specifically (see
 * `isD7SettleProgressQuestion` in classify.ts) rather than as standalone
 * phrases, because `우리`/`아직`/`누가` are also legitimate signals
 * elsewhere (`우리`=GROUP_TOTAL's groupMarker in `우리 총 얼마 썼어?`;
 * `아직`=part of PAIRWISE's `안 냈`/`안 보냈` rows) — only their
 * co-occurrence with `정산`+`남았` is the D-7 trap, not the bare words.
 */
export const D7_SETTLE_PROGRESS_SUBJECTS = [
  '모두',
  '우리',
  '누가',
  '아직',
] as const

const BALANCE_OR_TOTAL = ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'] as const
const TOTAL_OR_WALLET = ['QUERY_GROUP_TOTAL', 'QUERY_WALLET'] as const
const WALLET_OR_TOTAL = ['QUERY_WALLET', 'QUERY_GROUP_TOTAL'] as const

export const DECOY_PHRASES = [
  // ===== §6#6 D-7 정산 진행 상태 — no per-member settled state to answer =====
  // covers `다들 정산 얼마 남았어` and `다들 정산 완료했어?`
  { phrase: '다들 정산', locale: 'ko', suggest: BALANCE_OR_TOTAL, freq: '하' },
  // covers `누가 아직 안 냈어?`
  { phrase: '누가 아직', locale: 'ko', suggest: BALANCE_OR_TOTAL, freq: '상' },
  // covers `돈 빨리 안 보내는 사람 누구야` and `아직 정산 안 한 사람 누구야`
  {
    phrase: '사람 누구야',
    locale: 'ko',
    suggest: BALANCE_OR_TOTAL,
    freq: '상',
  },
  // covers `정산 안 낸 사람 있어?`
  { phrase: '안 낸 사람', locale: 'ko', suggest: BALANCE_OR_TOTAL, freq: '중' },
  // M5 (round-2 review): `진행` is a deliberately BROAD single-word marker
  // (only `정산 어떻게 진행되고 있어?` is attested with it, but any "in
  // progress" phrasing shares the same "no per-member settled state to
  // answer" reasoning — a false-positive here still lands on a helpful
  // GUIDED suggestion, never a wrong hard answer, so the breadth is a
  // deliberate trade, not an oversight).
  { phrase: '진행', locale: 'ko', suggest: BALANCE_OR_TOTAL, freq: '상' },
  // covers `정산 언제 끝나`
  { phrase: '언제 끝나', locale: 'ko', suggest: BALANCE_OR_TOTAL, freq: '중' },
  // covers `정산 다 됐나`
  { phrase: '다 됐나', locale: 'ko', suggest: BALANCE_OR_TOTAL, freq: '중' },

  // ===== §6#7 모임통장/회비 — a shared bank account this app does not model =====
  { phrase: '모임통장', locale: 'ko', suggest: TOTAL_OR_WALLET, freq: '하' },
  // M5 (round-2 review): `회비` (membership dues) is likewise a deliberately
  // broad bare-noun marker — same "worst case is a helpful redirect, not a
  // wrong answer" trade as `진행` above; the app has no dues/shared-account
  // model at all (§6#7), so any sentence mentioning it is out of scope by
  // construction, not just the one attested row.
  { phrase: '회비', locale: 'ko', suggest: ['QUERY_GROUP_TOTAL'], freq: '하' },

  // ===== §6#8 denomination / budget / multi-currency-total questions =====
  // covers `클럽 갈 때 현금 얼마 들고가야 됨`
  { phrase: '들고가야', locale: 'ko', suggest: ['QUERY_WALLET'], freq: '중' },
  // covers `잔돈 말고 지폐로 얼마 남았어`
  { phrase: '지폐', locale: 'ko', suggest: ['QUERY_WALLET'], freq: '하' },
  // covers `다 모으면 얼마인지 계산해봐야겠어`
  { phrase: '다 모으면', locale: 'ko', suggest: WALLET_OR_TOTAL, freq: '하' },

  // ===== §3.7 en NEGATIVE — thin-signal spending/balance ambiguity =====
  {
    phrase: 'pay for enough',
    locale: 'en',
    suggest: ['QUERY_MY_SPENDING', 'QUERY_MY_BALANCE'],
    freq: '하',
  },
] as const satisfies readonly DecoyPhraseEntry[]
