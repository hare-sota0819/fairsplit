/**
 * MODIFY_PATTERNS — the GENERALIZING correction-frame and field vocabulary
 * for CONFIRM_MODIFY, extracted from spec §2.3's P2 gate and §2.4's split
 * keyword list (not from §3.4's attested sentences — those are fixture
 * shaped test rows for T3/T4 and live verbatim in `corpus.ts`'s
 * `MODIFY_CORPUS`).
 *
 * §2.3 P2: "the input ... carries an explicit correction frame (`말고`, `이
 * 아니라`/`이 아니고`, `바꿔`, `고쳐`, `수정`, `빼줘`+name, `제외`+name,
 * `포함`+name, en `change it to`, `make it`, `actually`, `remove`, `I
 * meant`)." §2.4: split keywords `반반`/`n빵`/`다같이`/`half`/`evenly`.
 *
 * `field: null` entries are generic "something about this card is wrong"
 * connectives — §2.3 never restricts them to one field; what follows the
 * connective (a number vs a name) decides the actual field, which is
 * classify()'s job (T3), not this data's. `field` is only set on a marker
 * when the WORD ITSELF is field-specific (split type, participant op, or
 * the explicit "금액"/amount noun) — see spec §2.3/§2.4's own attribution.
 *
 * Dedup note: several suffixed forms attested in §3.4 (바꿔줘, 고쳐줘,
 * 수정해줘, 오타났어, 제외해줘, 정정할게요, "다시 해줘") are dropped here
 * because they are a strict superset (by simple prefix containment, not
 * fuzzy/stem matching) of a shorter marker already listed — CONFIRM_MODIFY
 * is reached via substring/frame detection within a larger message (§2.3),
 * unlike CONFIRM_YES/NO's whole-input equality (§2.3 P1), so the shorter
 * form still fires on the longer surface form. The full surface forms
 * remain in `corpus.ts` verbatim regardless.
 *
 * Round 4: `아니라`/`아니고` (dropping §2.3's literal `이 아니라`/`이
 * 아니고`) close a particle gap — 이 follows a consonant-ending noun, 가
 * follows a vowel-ending one, and the bare connective covers both. `minus`/
 * `without`/`everyone but`/`just me and` and `sorry` were added from the
 * reviewer's cheap-instantiation table (attested in MODIFY_CORPUS,
 * collision-checked). `take Sam out` remains uncovered on purpose: `take
 * ... out` is a discontinuous frame (the name splits the two halves), not
 * a literal contiguous substring a single marker can represent under this
 * matcher's semantics — left for T3/T4, not hacked around here.
 */

import type { Freq, Locale, Tier } from './types'

export type ModifyField = 'amount' | 'payer' | 'split' | 'participants' | null

export interface ModifyPatternEntry {
  readonly pattern: string
  readonly field: ModifyField
  readonly op?: 'remove' | 'add' | 'only'
  readonly split?: 'half' | 'everyone'
  /**
   * T3 round-2 addition (reviewer C1): true for the participant-op markers
   * NOT literally named in spec §2.3's own correction-frame list (only
   * `빼줘`+name/`제외`+name/`포함`+name/`remove`+name are named there,
   * unconditional regardless of surrounding content). The rest (`빼고`,
   * `minus`, `without`, `everyone but`, `just me and`) are §2.4 fragment-
   * list territory instead — classify.ts requires the REAL fragment check
   * (nothing but the recognized spans survive) before trusting them, which
   * is what correctly falls `민수 빼고 다들 정산했어?` through to P3/P5
   * instead of misreading it as a participant removal.
   */
  readonly fragmentGated?: true
  readonly locale: Locale
  readonly tier: Tier
  readonly freq: Freq
}

export const MODIFY_PATTERNS = [
  // ===== correction connectives (§2.3 P2) — field resolved by what follows =====
  // ko main
  {
    pattern: '말고',
    field: null,
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  // `아니라`/`아니고` (not `이 아니라`/`이 아니고`): the leading particle is
  // 이 after a consonant-ending noun but 가 after a vowel-ending one (민수가
  // 아니고, not 민수이 아니고) — dropping the particle covers both, closing
  // a round-2 gap (`민수가 아니고 철수`, `아니 그게 아니라 4만원` were
  // unreachable under the particle-specific `이 아니라`/`이 아니고` forms).
  { pattern: '아니라', field: null, locale: 'ko', tier: 'main', freq: '상' },
  { pattern: '아니고', field: null, locale: 'ko', tier: 'main', freq: '상' },
  { pattern: '바꿔', field: null, locale: 'ko', tier: 'main', freq: '상' },
  { pattern: '고쳐', field: null, locale: 'ko', tier: 'main', freq: '상' },
  { pattern: '수정', field: null, locale: 'ko', tier: 'main', freq: '상' },
  { pattern: '다시', field: null, locale: 'ko', tier: 'main', freq: '상' },
  { pattern: '오타', field: null, locale: 'ko', tier: 'main', freq: '상' },
  { pattern: '아 맞다', field: null, locale: 'ko', tier: 'main', freq: '상' },
  { pattern: '앗', field: null, locale: 'ko', tier: 'main', freq: '상' },
  // ko 확장 후보
  { pattern: '잘못', field: null, locale: 'ko', tier: 'exp', freq: '중' },
  { pattern: '정정', field: null, locale: 'ko', tier: 'exp', freq: '중' },
  // `헐 아니` contains the NEGATE_TOKENS token `아니` as a substring — a
  // known, unaddressed collision risk (not one of the reviewer's six named
  // guard pairs; flagged in the task report rather than invented here).
  { pattern: '헐 아니', field: null, locale: 'ko', tier: 'exp', freq: '하' },

  // en main
  {
    pattern: 'change it to',
    field: null,
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  {
    pattern: 'change that to',
    field: null,
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  // Task 11 (fix round 1, sanctioned by ruling): the FIELD-NAMED forms. Their
  // field-less siblings above ("change it to", "make it") already worked, so
  // a user who named the field they meant got LESS than one who did not —
  // "change the amount to $50" fell through the whole ladder and booked a
  // SECOND expense while a card was open. `change the amount` also carries a
  // field, unlike the pronoun forms: it can only be the amount.
  {
    pattern: 'change the amount to',
    field: 'amount',
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  {
    pattern: 'change the amount',
    field: 'amount',
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  { pattern: 'make it', field: null, locale: 'en', tier: 'main', freq: '중' },
  { pattern: 'actually', field: null, locale: 'en', tier: 'main', freq: '중' },
  { pattern: 'I meant', field: null, locale: 'en', tier: 'main', freq: '중' },
  {
    pattern: 'scratch that',
    field: null,
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  { pattern: 'oops', field: null, locale: 'en', tier: 'main', freq: '중' },
  { pattern: 'wait no', field: null, locale: 'en', tier: 'main', freq: '하' },
  { pattern: 'sorry', field: null, locale: 'en', tier: 'main', freq: '중' },

  // ===== split field markers (§2.4 exact list + attested synonyms) =====
  {
    pattern: '반반',
    field: 'split',
    split: 'half',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: '반씩',
    field: 'split',
    split: 'half',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    pattern: 'n빵',
    field: 'split',
    split: 'everyone',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: '엔빵',
    field: 'split',
    split: 'everyone',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: '다같이',
    field: 'split',
    split: 'everyone',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: 'half',
    field: 'split',
    split: 'half',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: 'evenly',
    field: 'split',
    split: 'everyone',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: '50/50',
    field: 'split',
    split: 'half',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: 'go halves',
    field: 'split',
    split: 'half',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },

  // ===== participant-op markers (§2.3's `빼줘`+name/`제외`+name/`포함`+name/`remove`) =====
  // The bound name itself is `findMembers`' job, not lexicon data.
  {
    pattern: '빼줘',
    field: 'participants',
    op: 'remove',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: '빼고',
    field: 'participants',
    op: 'remove',
    fragmentGated: true,
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: '제외',
    field: 'participants',
    op: 'remove',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: '포함',
    field: 'participants',
    op: 'add',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  // 껴줘 ("count me/them in") — the everyday spoken form of 포함, and the
  // vocabulary the SAVED-expense edit parser (chat-parse/parsers/edit.ts)
  // already recognises. Task 11 (fix round 1, sanctioned by ruling): its
  // absence here meant the two layers disagreed about the same sentence —
  // "나도 껴줘" edited a SAVED expense but did nothing to the card open on
  // screen, which is the one thing the user is most obviously talking about.
  // Adding it deliberately flips classify.test.ts's pinned "민수도 껴줘 with a
  // card open" row (UNKNOWN -> CONFIRM_MODIFY), which is the point of the
  // ruling, not a side effect.
  {
    pattern: '껴줘',
    field: 'participants',
    op: 'add',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    pattern: 'remove',
    field: 'participants',
    op: 'remove',
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  {
    pattern: 'minus',
    field: 'participants',
    op: 'remove',
    fragmentGated: true,
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  {
    pattern: 'without',
    field: 'participants',
    op: 'remove',
    fragmentGated: true,
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  {
    pattern: 'everyone but',
    field: 'participants',
    op: 'remove',
    fragmentGated: true,
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  {
    pattern: 'just me and',
    field: 'participants',
    op: 'only',
    fragmentGated: true,
    locale: 'en',
    tier: 'main',
    freq: '중',
  },

  // ===== explicit amount field-noun (금액 = generic "amount", not a bound value) =====
  { pattern: '금액', field: 'amount', locale: 'ko', tier: 'exp', freq: '중' },
] as const satisfies readonly ModifyPatternEntry[]

/**
 * T3 addition — `take Sam out` (spec §3.4 en main, 중) is a DISCONTINUOUS
 * frame: the bound name splits "take" and "out", so it cannot be one
 * contiguous-substring `MODIFY_PATTERNS` marker (T2's own header comment
 * documents this exact limitation and leaves it "for T3/T4, not hacked
 * around here"). classify.ts checks prefix/suffix presence itself; the
 * words themselves still live here as data, not as literals in classify.ts.
 */
export interface ModifyDiscontinuousFrame {
  readonly prefix: string
  readonly suffix: string
  readonly field: 'participants'
  readonly op: 'remove' | 'add' | 'only'
  readonly locale: Locale
  readonly tier: Tier
  readonly freq: Freq
}

export const MODIFY_DISCONTINUOUS_FRAMES = [
  {
    prefix: 'take',
    suffix: 'out',
    field: 'participants',
    op: 'remove',
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
] as const satisfies readonly ModifyDiscontinuousFrame[]
