/**
 * NEGATE_TOKENS — spec §3.3 CONFIRM_NO_CANCEL, transcribed verbatim.
 *
 * Same P1 whole-token matching rule as CONFIRM_TOKENS (spec §2.3, §2.7).
 * `잠깐`/`잠깐만`/en `wait`/`hold on`/`hold up` are deliberately NOT in this
 * table — spec §2.6 rules them "보류" (hold), never a cancel, so they must
 * not become classification-ambiguous with this family. They are UNKNOWN →
 * GUIDED `{hold:true}` test rows for classify() (T3/T4), not lexicon data.
 */

import type { Freq, Locale, Tier } from './types'

export interface NegateTokenEntry {
  readonly token: string
  readonly locale: Locale
  readonly tier: Tier
  readonly freq: Freq
}

export const NEGATE_TOKENS = [
  // ko main — C-3 (spec §3.3 ko, 28 rows)
  { token: '아니', locale: 'ko', tier: 'main', freq: '상' },
  { token: '아니야', locale: 'ko', tier: 'main', freq: '상' },
  { token: '아냐', locale: 'ko', tier: 'main', freq: '상' },
  { token: '아뇨', locale: 'ko', tier: 'main', freq: '상' },
  { token: '아니요', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㄴㄴ', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㄴㄴㄴ', locale: 'ko', tier: 'main', freq: '중' },
  { token: 'ㄴㅇㅈ', locale: 'ko', tier: 'main', freq: '중' },
  { token: '놉', locale: 'ko', tier: 'main', freq: '상' },
  { token: '싫어', locale: 'ko', tier: 'main', freq: '상' },
  { token: '안돼', locale: 'ko', tier: 'main', freq: '상' },
  { token: '안 돼', locale: 'ko', tier: 'main', freq: '상' },
  { token: '하지마', locale: 'ko', tier: 'main', freq: '상' },
  { token: '하지 마', locale: 'ko', tier: 'main', freq: '상' },
  { token: '취소', locale: 'ko', tier: 'main', freq: '상' },
  { token: '취소요', locale: 'ko', tier: 'main', freq: '상' },
  { token: '취소해', locale: 'ko', tier: 'main', freq: '상' },
  { token: '취소해줘', locale: 'ko', tier: 'main', freq: '상' },
  { token: '지워', locale: 'ko', tier: 'main', freq: '상' },
  { token: '지워줘', locale: 'ko', tier: 'main', freq: '상' },
  { token: '삭제', locale: 'ko', tier: 'main', freq: '상' },
  { token: '삭제해줘', locale: 'ko', tier: 'main', freq: '상' },
  { token: '없던 걸로', locale: 'ko', tier: 'main', freq: '상' },
  { token: '없던걸로', locale: 'ko', tier: 'main', freq: '상' },
  { token: '없던 일로', locale: 'ko', tier: 'main', freq: '상' },
  { token: '없던걸로 해줘', locale: 'ko', tier: 'main', freq: '상' },
  { token: '그만', locale: 'ko', tier: 'main', freq: '상' },
  { token: '그만해', locale: 'ko', tier: 'main', freq: '상' },

  // ko 확장 후보 (spec §3.3 ko 확장, 5 rows)
  { token: '노', locale: 'ko', tier: 'exp', freq: '중' },
  { token: 'nope', locale: 'ko', tier: 'exp', freq: '하' },
  { token: '스톱', locale: 'ko', tier: 'exp', freq: '중' },
  { token: '아냐아냐', locale: 'ko', tier: 'exp', freq: '중' },
  { token: '빼', locale: 'ko', tier: 'exp', freq: '중' },

  // en main (spec §3.3 en, 14 rows — no en 확장 table for this intent)
  { token: 'n', locale: 'en', tier: 'main', freq: '중' },
  { token: 'no', locale: 'en', tier: 'main', freq: '상' },
  { token: 'nope', locale: 'en', tier: 'main', freq: '상' },
  { token: 'nah', locale: 'en', tier: 'main', freq: '상' },
  { token: 'naw', locale: 'en', tier: 'main', freq: '상' },
  { token: 'hard pass', locale: 'en', tier: 'main', freq: '중' },
  { token: 'no can do', locale: 'en', tier: 'main', freq: '하' },
  { token: 'cancel', locale: 'en', tier: 'main', freq: '상' },
  { token: 'cancel that', locale: 'en', tier: 'main', freq: '상' },
  { token: 'nvm', locale: 'en', tier: 'main', freq: '상' },
  { token: 'nevermind', locale: 'en', tier: 'main', freq: '상' },
  { token: 'scratch that', locale: 'en', tier: 'main', freq: '중' },
  { token: 'not that', locale: 'en', tier: 'main', freq: '하' },
  { token: 'not that one', locale: 'en', tier: 'main', freq: '하' },
] as const satisfies readonly NegateTokenEntry[]
