/**
 * CONFIRM_TOKENS — spec §3.2 CONFIRM_YES, transcribed verbatim.
 *
 * P1 (spec §2.3) matches these whole-token against the normalized input: the
 * ENTIRE message must equal one of these strings (repetition-collapsed),
 * never a substring hit (§2.7's token-boundary law). A card must be open
 * (`ctx.openCard !== null`) for this family to apply at all (§2.2).
 */

import type { Freq, Locale, Tier } from './types'

export interface ConfirmTokenEntry {
  readonly token: string
  readonly locale: Locale
  readonly tier: Tier
  readonly freq: Freq
}

export const CONFIRM_TOKENS = [
  // ko main — C-1 초성체 + C-2 긍정, plus F-4 chat-noise variants (spec §3.2 ko, 35 rows)
  { token: 'ㅇㅇ', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㅇ', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㅇㅇㅇ', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㅇㅋ', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㄱㄱ', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㄱㄱㄱ', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㅇㅈ', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㅇㅈㅇㅈ', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㅁㅈ', locale: 'ko', tier: 'main', freq: '상' },
  { token: '응', locale: 'ko', tier: 'main', freq: '상' },
  { token: '어', locale: 'ko', tier: 'main', freq: '상' },
  { token: '넹', locale: 'ko', tier: 'main', freq: '상' },
  { token: '넵', locale: 'ko', tier: 'main', freq: '상' },
  { token: '넵넵', locale: 'ko', tier: 'main', freq: '상' },
  { token: '네', locale: 'ko', tier: 'main', freq: '상' },
  { token: '예', locale: 'ko', tier: 'main', freq: '상' },
  { token: '그래', locale: 'ko', tier: 'main', freq: '상' },
  { token: '그래그래', locale: 'ko', tier: 'main', freq: '상' },
  { token: '좋아', locale: 'ko', tier: 'main', freq: '상' },
  { token: '좋아요', locale: 'ko', tier: 'main', freq: '상' },
  { token: '오케이', locale: 'ko', tier: 'main', freq: '상' },
  { token: '오키', locale: 'ko', tier: 'main', freq: '상' },
  { token: '오키도키', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ok', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'OK', locale: 'ko', tier: 'main', freq: '상' },
  { token: '콜', locale: 'ko', tier: 'main', freq: '상' },
  { token: '고고', locale: 'ko', tier: 'main', freq: '상' },
  { token: '가즈아', locale: 'ko', tier: 'main', freq: '상' },
  { token: '맞아', locale: 'ko', tier: 'main', freq: '상' },
  { token: '맞아맞아', locale: 'ko', tier: 'main', freq: '상' },
  { token: '그렇지', locale: 'ko', tier: 'main', freq: '상' },
  { token: '인정', locale: 'ko', tier: 'main', freq: '상' },
  { token: '굿', locale: 'ko', tier: 'main', freq: '상' },
  { token: '넹~~', locale: 'ko', tier: 'main', freq: '상' },
  { token: 'ㅇㅋ ㄱㄱ', locale: 'ko', tier: 'main', freq: '상' },

  // ko 확장 후보 — 미검증 또는 G-1 주의 대상 (spec §3.2 ko 확장, 11 rows)
  { token: '엉', locale: 'ko', tier: 'exp', freq: '중' },
  { token: '옙', locale: 'ko', tier: 'exp', freq: '중' },
  { token: '그러자', locale: 'ko', tier: 'exp', freq: '중' },
  { token: '조아', locale: 'ko', tier: 'exp', freq: '중' },
  { token: '오케', locale: 'ko', tier: 'exp', freq: '중' },
  { token: '응응', locale: 'ko', tier: 'exp', freq: '중' },
  { token: 'ㅇㅋㅇㅋ', locale: 'ko', tier: 'exp', freq: '중' },
  { token: '맞음', locale: 'ko', tier: 'exp', freq: '중' },
  { token: '굳', locale: 'ko', tier: 'exp', freq: '중' },
  { token: 'ㄹㅇ', locale: 'ko', tier: 'exp', freq: '하' },
  { token: 'ㅇㄱㄹㅇ', locale: 'ko', tier: 'exp', freq: '하' },

  // en main (spec §3.2 en, 22 rows)
  { token: 'y', locale: 'en', tier: 'main', freq: '중' },
  { token: 'yep', locale: 'en', tier: 'main', freq: '상' },
  { token: 'yup', locale: 'en', tier: 'main', freq: '상' },
  { token: 'yeah', locale: 'en', tier: 'main', freq: '상' },
  { token: 'yea', locale: 'en', tier: 'main', freq: '상' },
  { token: 'sure', locale: 'en', tier: 'main', freq: '상' },
  { token: 'k', locale: 'en', tier: 'main', freq: '중' },
  { token: 'kk', locale: 'en', tier: 'main', freq: '상' },
  { token: 'ok', locale: 'en', tier: 'main', freq: '상' },
  { token: 'okay', locale: 'en', tier: 'main', freq: '상' },
  { token: 'sounds good', locale: 'en', tier: 'main', freq: '상' },
  { token: 'sounds good to me', locale: 'en', tier: 'main', freq: '상' },
  { token: 'go ahead', locale: 'en', tier: 'main', freq: '중' },
  { token: 'go for it', locale: 'en', tier: 'main', freq: '중' },
  { token: 'do it', locale: 'en', tier: 'main', freq: '중' },
  { token: 'for sure', locale: 'en', tier: 'main', freq: '중' },
  { token: 'bet', locale: 'en', tier: 'main', freq: '중' },
  { token: 'np', locale: 'en', tier: 'main', freq: '상' },
  { token: 'no problem', locale: 'en', tier: 'main', freq: '상' },
  { token: 'roger that', locale: 'en', tier: 'main', freq: '하' },
  { token: 'affirmative', locale: 'en', tier: 'main', freq: '하' },
  { token: 'word', locale: 'en', tier: 'main', freq: '하' },
  // Task 11 (fix round 1, sanctioned): the plain word was missing. `yes` is
  // the single most obvious way to confirm anything in English, and every
  // clipped form of it (y/yep/yup/yeah/yea) was already here — the corpus
  // caught the gap only because it was written from what a USER would type
  // rather than from what the lexicon already held.
  { token: 'yes', locale: 'en', tier: 'main', freq: '상' },
  { token: 'yes please', locale: 'en', tier: 'main', freq: '상' },
  // `confirm` and `save it` are unambiguous imperatives ON A CARD, which is
  // the only context P1 runs in: there is nothing else in this app to confirm
  // or save. DELIBERATELY EXCLUDED, and this is the reasoning:
  //  - `correct` — an adjective ("that's correct" = yes) AND a verb
  //    ("correct it" = the opposite, a modify). The two readings point in
  //    opposite directions and the token alone cannot tell them apart.
  //  - `right` — same shape ("right" = yes / "right, no" = a correction), and
  //    it is also the most common English discourse filler.
  { token: 'confirm', locale: 'en', tier: 'main', freq: '중' },
  { token: 'save it', locale: 'en', tier: 'main', freq: '중' },

  // en 확장 후보 (spec §3.2 en 확장, 4 rows)
  { token: 'yeah do it', locale: 'en', tier: 'exp', freq: '하' },
  { token: 'yessir', locale: 'en', tier: 'exp', freq: '하' },
  { token: 'fs', locale: 'en', tier: 'exp', freq: '하' },
  { token: 'oke', locale: 'en', tier: 'exp', freq: '하' },
] as const satisfies readonly ConfirmTokenEntry[]
