/**
 * QUERY_MARKERS — the GENERALIZING per-intent marker vocabulary from spec
 * §2.5's query sub-order, not §3.5-§3.9's attested sentences (those are
 * fixture-shaped test rows for T3/T4 and live verbatim in `corpus.ts`'s
 * `QUERY_CORPUS`).
 *
 * §2.5 defines five intents as AND-groups (most specific first), each an
 * ordered pair of marker roles that must BOTH be present:
 *   1. Wallet:      a wallet noun (현금/지갑/환전/외화/잔액/경비/currency name, cash/wallet)
 *                    AND a remaining-word (남았/남음/남은/있어/있지/있는지/잔액, left/balance)
 *   2. Pairwise:     a bound member name AND a dative particle (한테/에게/랑/이랑)
 *                    OR an owe-frame (주면/줘야/받을, owe/square/settle)
 *   3. My spending:  a first-person marker (내가/나/제가, I/my)
 *                    AND a paid verb (낸/냈/쓴/썼/결제한, spent/paid/put in/spend/spending)
 *   4. Group total:  a group marker (우리/총/다같이/여행/전체/trip, we/our/the trip/group)
 *                    AND an amount word (얼마/경비/지출, how much/total)
 *   5. My balance:   얼마 AND a pay/send frame (내면/내야/보내면/보내야/정산/몫/인당,
 *                    owe/my balance/who do I pay/damage/venmo/zelle/in the red/need to pay)
 *
 * `order` is the §2.5 sub-order priority (1 = checked first); classify.ts
 * (T3) reads it instead of hardcoding the ladder, keeping the ordering data
 * too. `role` groups markers within one intent so T3 can require "at least
 * one marker from each role present" (the AND) rather than any single hit.
 * Pairwise carries no bound-name role: `findMembers` resolves that, not
 * this lexicon (spec §5.1 — no PII/entity data in lexicons).
 *
 * These markers were audited against every QUERY_CORPUS row for
 * "reachability" — can the current data's AND-groups actually recognize
 * each attested sentence. Matching is a literal CONTIGUOUS SUBSTRING check,
 * not a word-sequence-with-gaps check — round 3 got this wrong for
 * `settle with` (not a substring of the attested `settle up with Sam`/
 * `settle up with Alex`, a regression fixed in round 4 by using bare
 * `settle`/`square` instead). See
 * `.superpowers/sdd/2026-08-10-assistant-brain/task-2-report.md` for the
 * full closure-check history and the current residual-unreachable count.
 */

import type { Freq, Locale, Tier } from './types'

export type QueryIntent =
  | 'QUERY_MY_BALANCE'
  | 'QUERY_PAIRWISE'
  | 'QUERY_GROUP_TOTAL'
  | 'QUERY_MY_SPENDING'
  | 'QUERY_WALLET'

export type QueryView =
  'amount' | 'who' | 'total' | 'transfers' | 'paid' | 'consumed' | 'ahead'

export type QueryMarkerRole =
  | 'walletNoun'
  | 'walletCurrencyName'
  | 'walletRemaining'
  | 'pairwiseParticle'
  | 'pairwiseOweFrame'
  /**
   * T4 addition — §2.6's "안 낸 사람"/"안 보낸 사람"/"did Sam pay me back"
   * ruling: a negated-completion or paid-back-status question about a NAMED
   * member is PAIRWISE too, by a different mechanism than a dative particle
   * or owe-frame. classify.ts's PAIRWISE gate ORs every QUERY_PAIRWISE role
   * together regardless of name (no AND-group here), so this role needs no
   * special-cased read logic — only the marker data itself is new.
   */
  | 'pairwiseNegatedFrame'
  | 'firstPerson'
  | 'paidVerb'
  /** T4 addition — narrows QUERY_MY_SPENDING's view to 'ahead' (더 낸 거야). */
  | 'aheadFrame'
  /** T4 addition — narrows QUERY_MY_SPENDING's view to 'consumed' (항목별로 냈지). */
  | 'consumedFrame'
  | 'groupMarker'
  | 'amountWord'
  /**
   * T4 addition — spec §2.6/progress.md's round-4 finding: "who owes X" is a
   * structurally different question ("who owes whom") from "how much" (the
   * groupMarker+amountWord AND), so it is checked as its own OR-alternative
   * rather than folded into either existing role — see classify.ts's
   * GROUP_TOTAL step.
   */
  | 'transfersFrame'
  | 'balancePayFrame'
  /**
   * T4 addition — "who do I pay"/"누구한테 보내면 됨?" ask WHO, not HOW
   * MUCH; no 얼마/how-much marker is present in these at all, so they need
   * their own OR-alternative (like `transfersFrame`) rather than being
   * squeezed into the amountWord AND-group — see classify.ts's MY_BALANCE
   * step.
   */
  | 'whoFrame'

export interface QueryMarkerEntry {
  readonly marker: string
  readonly intent: QueryIntent
  /** §2.5 sub-order priority: 1 = checked first. */
  readonly order: 1 | 2 | 3 | 4 | 5
  readonly role: QueryMarkerRole
  /** Only set on `walletCurrencyName` rows. */
  readonly currencyCode?: string
  readonly locale: Locale
  readonly tier: Tier
  readonly freq: Freq
}

export const QUERY_MARKERS = [
  // ===== 1. QUERY_WALLET =====
  // ko wallet nouns
  {
    marker: '현금',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletNoun',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '지갑',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletNoun',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '환전',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletNoun',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '외화',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletNoun',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '잔액',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletNoun',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  // round-4 addition — `남은 여행 경비 얼마야` has a remaining-word (남은)
  // but no other walletNoun; `경비` (expense/cost) fills that role.
  {
    marker: '경비',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletNoun',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  // ko currency names (a "wallet noun" per §2.5's own "a currency name from B-5" clause)
  {
    marker: '엔화',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletCurrencyName',
    currencyCode: 'JPY',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '달러',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletCurrencyName',
    currencyCode: 'USD',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '바트',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletCurrencyName',
    currencyCode: 'THB',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  // ko remaining-words
  {
    marker: '남았',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletRemaining',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '남음',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletRemaining',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '있어',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletRemaining',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '남은',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletRemaining',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '있지',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletRemaining',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '있는지',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletRemaining',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  // round-4 addition — `잔액` (balance) also plays walletRemaining, not
  // just walletNoun: `내 현금 잔액 얼마야` already has `현금` (walletNoun);
  // this closes the walletRemaining gap for it. Not a duplicate row —
  // same marker, different role, exactly the "얼마"/"owe" reuse pattern
  // already documented for other roles.
  {
    marker: '잔액',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletRemaining',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  // en wallet nouns
  {
    marker: 'cash',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletNoun',
    locale: 'en',
    tier: 'main',
    freq: '하',
  },
  {
    marker: 'wallet',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletNoun',
    locale: 'en',
    tier: 'main',
    freq: '하',
  },
  // en remaining-words
  {
    marker: 'left',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletRemaining',
    locale: 'en',
    tier: 'main',
    freq: '하',
  },
  {
    marker: 'balance',
    intent: 'QUERY_WALLET',
    order: 1,
    role: 'walletRemaining',
    locale: 'en',
    tier: 'main',
    freq: '하',
  },

  // ===== 2. QUERY_PAIRWISE (requires a bound member name, resolved elsewhere) =====
  // ko dative/companion particles
  {
    marker: '한테',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseParticle',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '에게',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseParticle',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '랑',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseParticle',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '이랑',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseParticle',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  // ko owe-frames
  {
    marker: '주면',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseOweFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '줘야',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseOweFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '받을',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseOweFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  // en owe-frames (en has no dative particle — the preposition is inside the frame itself)
  {
    marker: 'owe',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseOweFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  // `square` (not `square with`): matching is a literal contiguous
  // substring check, not a word-sequence-with-gaps check (round 3 got this
  // wrong for `settle with`/`settle up with` — see below). Bare `square`
  // covers `am I square with Sam`, `is Sam square with me`, `am I square
  // with Alex`, AND the 확장 no-name rows `are we square`/`we're square`.
  // Collision-checked: appears nowhere else in the lexicons.
  {
    marker: 'square',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseOweFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  // `settle` (not `settle up with`/`settle with`): round 3's `settle with`
  // was a REGRESSION — it is not a contiguous substring of `settle up with
  // Sam`/`settle up with Alex` (both attested, 상, main-tier), so that fix
  // silently broke two previously-reachable main rows. Matching here is a
  // literal contiguous substring check; bare `settle` is the shortest
  // string that is a substring of every attested `settle...with` variant.
  // Collision-checked: appears nowhere else in the lexicons.
  {
    marker: 'settle',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseOweFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  // T4 additions — §2.6's own ruling: "안 낸 사람"/"안 보낸 사람" ⁄ "did
  // Sam pay me back" name a NAMED member's negated-completion/paid-back
  // status, which the app CAN answer via the pairwise balance even though
  // the phrasing carries no dative particle or owe-frame. Collision-checked
  // against 안 냈/안 보냈 GROUP_TOTAL/MY_BALANCE-shaped decoys ("누가 아직
  // 안 냈어?" has no bound name, so PAIRWISE's `hits.length > 0` gate
  // already excludes it regardless of this marker).
  {
    marker: '안 냈',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseNegatedFrame',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '안 보냈',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseNegatedFrame',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'pay me back',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseNegatedFrame',
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  {
    marker: 'paid me back',
    intent: 'QUERY_PAIRWISE',
    order: 2,
    role: 'pairwiseNegatedFrame',
    locale: 'en',
    tier: 'main',
    freq: '중',
  },

  // ===== 3. QUERY_MY_SPENDING =====
  // ko first-person markers
  {
    marker: '내가',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'firstPerson',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  // `나` is a substring of HOLD_TOKENS' `나중에` (나 ⊂ 나중에) — unlike
  // CONFIRM/NEGATE/HOLD's own internal traps, this is NOT resolved by
  // whole-input equality (§2.3 P1 doesn't apply to QUERY's P3 substring
  // matching). It survives only because MY_SPENDING is an AND-group: a
  // bare `나중에` has no `paidVerb` marker alongside it, so the AND never
  // completes. This is a structural safety net, not the same guarantee
  // GUARD_PAIRS documents for the whole-token families — flagging it here
  // rather than adding it to GUARD_PAIRS, which is specifically about
  // whole-token matches.
  {
    marker: '나',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'firstPerson',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '제가',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'firstPerson',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  // ko paid/spent verbs
  {
    marker: '낸',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '냈',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '쓴',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '결제한',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '썼',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  // en first-person markers
  {
    marker: 'I',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'firstPerson',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  // T4 addition — the attested corpus has BOTH cases of this exact row
  // (`how much have I spent`/`how much have i spent`, `how much did I put
  // in`/`how much did i put in`, both 상/중 main) — a separate lowercase
  // DATA row, not a code-level case fold (T3's own I6 ruling folds case
  // ONLY at P1's whole-input equality, specifically to keep P3's I/we
  // pronoun distinction alive; a lowercase `i` marker here is scoped to
  // this ONE token, not a blanket fold that would blur `we`).
  {
    marker: 'i',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'firstPerson',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'my',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'firstPerson',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  // en paid/spent verbs
  {
    marker: 'spent',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'paid',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'put in',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  {
    marker: 'spend',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'spending',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'en',
    tier: 'main',
    freq: '하',
  },
  // T4 additions — closure-check cheap wins (확장 rows attested, marker
  // absent): `지출`/`부담` as further paid/spent nouns. `지출` is already an
  // amountWord marker under QUERY_GROUP_TOTAL — same word, different
  // intent+role pairing, the same reuse pattern already documented for
  // `얼마`/`잔액`. Both require `firstPerson` too (an AND-group leg), so
  // GROUP_TOTAL rows that also say `지출` (`총 지출 얼마야`, no firstPerson)
  // are unaffected.
  {
    marker: '지출',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  {
    marker: '부담',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'paidVerb',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  // T4 additions — narrows the view slot (spec §5.2's `view: 'ahead' |
  // 'consumed' | 'paid'`) once the firstPerson+paidVerb AND has already
  // fired. Round-2 review (I4): the bare `더` marker is a substring of
  // `더치페이` ("splitting the bill Dutch-style") — `나 더치페이로 얼마
  // 냈어` would have misread as `view:'ahead'` instead of `'paid'`. Narrowed
  // to `더 낸`/`더 냈` (WITH the space): both attested rows (`내가 얼마 더
  // 낸 거야`, `내 몫보다 내가 더 낸 거 얼마야`) still contain `더 낸`
  // verbatim, while `더치페이` has no space after `더` so neither variant
  // matches inside it.
  {
    marker: '더 낸',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'aheadFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '더 냈',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'aheadFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '항목별',
    intent: 'QUERY_MY_SPENDING',
    order: 3,
    role: 'consumedFrame',
    locale: 'ko',
    tier: 'main',
    freq: '하',
  },

  // ===== 4. QUERY_GROUP_TOTAL =====
  // ko group markers
  {
    marker: '우리',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '총',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '다같이',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '여행',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '전체',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  // ko amount word
  {
    marker: '얼마',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'amountWord',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  // round-4 additions — 총경비/지출 rows ask about cost without saying 얼마
  {
    marker: '경비',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'amountWord',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '지출',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'amountWord',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  // en group markers
  // `we` is a substring of HOLD_TOKENS' `we'll figure it out later` (we ⊂
  // we'll) — same style/safety as the `나`⊂`나중에` note above: not
  // resolved by whole-input equality, safe only because GROUP_TOTAL is an
  // AND-group requiring an `amountWord` too, which `we'll figure it out
  // later` does not have.
  {
    marker: 'we',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'our',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'the trip',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  {
    marker: 'group',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'en',
    tier: 'main',
    freq: '하',
  },
  // `trip` alone (not just `the trip`): `how much has this trip cost`
  // (QUERY_CORPUS) says "this trip", not "the trip".
  {
    marker: 'trip',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'en',
    tier: 'main',
    freq: '중',
  },
  // en amount word — without this, en QUERY_GROUP_TOTAL's AND-group
  // (groupMarker + amountWord) has no en amountWord entries at all and
  // could never fire for English (the reachability bug this round's
  // closure check exists to catch).
  {
    marker: 'how much',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'amountWord',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'total',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'amountWord',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  // T3 addition — "what's the total" (QUERY_CORPUS en main, 상) has NO
  // groupMarker at all (no we/our/trip/group); T2's own round-4 residual
  // notes name this exact gap ("en `what's the total` (amountWord present,
  // no groupMarker)"). The definite article + bare "total" (as opposed to
  // "MY total") is itself the group-vs-mine signal in natural English, so
  // "the total" doubles as its own groupMarker leg — collision-checked, the
  // only other en amountWord row containing "total" as a substring is
  // "total for the group" ("total for the" then "group", not "the total").
  {
    marker: 'the total',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  // T4 additions — closure-check cheap wins (§3.7 rows attested, no
  // explicit 우리/총/다같이/여행/전체 subject but the word ITSELF names a
  // running total/record, which is the same "implicit group scope" signal
  // `우리`/`총` encode explicitly): `내역` (지출 내역 보여줘, MAIN row),
  // `합계`/`다 합쳐서` (확장). `합계` doubles as its own amountWord too —
  // the same dual-role reuse already documented for `얼마`/`잔액`/`지출`,
  // since it alone (no separate 얼마) carries both legs of the AND.
  {
    marker: '내역',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '합계',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  {
    marker: '합계',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'amountWord',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  {
    marker: '다 합쳐서',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'groupMarker',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  // T4 addition — spec §3.5/§3.7/§3.10 NEGATIVE + round-4's own attribution
  // note: "who owes who"/"who owes who money"/"who owes what" ask a
  // structurally different question ("whom does each person owe") than
  // "how much" — see the `transfersFrame` role doc comment above. Bare
  // `who owes` (not `who owes who`) is the shortest contiguous substring
  // shared by all three attested surface forms (matcher contract: literal
  // substring, not word-sequence-with-gaps). Collision-checked: `owe`
  // (PAIRWISE's own oweFrame marker) does not itself collide because
  // PAIRWISE requires a bound member name, which none of these three carry.
  {
    marker: 'who owes',
    intent: 'QUERY_GROUP_TOTAL',
    order: 4,
    role: 'transfersFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },

  // ===== 5. QUERY_MY_BALANCE =====
  // ko amount word (shared with group_total's role by design — same word, different intent+role pairing)
  {
    marker: '얼마',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'amountWord',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  // ko pay/send frames
  {
    marker: '내면',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '내야',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '보내면',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '보내야',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '정산',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '몫',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '인당',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  // en balance phrases (owe is shared with pairwise's oweFrame role by design)
  {
    marker: 'owe',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'my balance',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'who do I pay',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  // Round-4 additions — covers the "en idioms" bucket (damage/venmo/
  // zelle/in the red) previously deliberately-unreachable, all attested
  // in QUERY_CORPUS and collision-checked against every other family.
  {
    marker: 'damage',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'venmo',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'zelle',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'en',
    tier: 'exp',
    freq: '하',
  },
  {
    marker: 'in the red',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'en',
    tier: 'exp',
    freq: '하',
  },
  {
    marker: 'need to pay',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  // T4 additions — closure-check cheap wins (main/확장 rows attested,
  // marker absent): `내는` (a present-tense inflection of 내다 sitting
  // alongside 내면/내야 — `나 각 얼마씩 내는 거야`, MAIN row), `드리면`
  // (a polite-register `내면`/`보내면`), and `청구` (a billed-amount
  // noun). `내는` is also a substring of `보내는` (`돈 빨리 안 보내는
  // 사람 누구야`), but that row is intercepted by `DECOY_PHRASES`' `사람
  // 누구야` marker before this AND-group step is ever reached.
  {
    marker: '내는',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'main',
    freq: '중',
  },
  {
    marker: '드리면',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  {
    marker: '청구',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'balancePayFrame',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  // T4 additions — the `{view:'who'}` rows (spec §2.6/progress.md's own
  // category-1 finding): these ask WHO to pay, carrying no 얼마/how-much
  // word at all, so they need their own `whoFrame` OR-alternative rather
  // than another amountWord/payFrame AND-group leg — see classify.ts's
  // MY_BALANCE step. `누구한테` covers `누구한테 보내면 됨?`/`정산 누구한테
  // 해?`/`나 누구한테 돈 줘야 하지`; `누구 계좌` (a distinct substring, not
  // `누구한테`) covers `이거 누구 계좌로 보내요?`. Collision-checked against
  // the D-7 decoy rows (`누가 아직 안 냈어?`, `...사람 누구야`) — neither
  // contains `누구한테`/`누구 계좌`, and those decoys are intercepted before
  // this step regardless (see `DECOY_PHRASES`).
  {
    marker: '누구한테',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'whoFrame',
    locale: 'ko',
    tier: 'main',
    freq: '상',
  },
  {
    marker: '누구 계좌',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'whoFrame',
    locale: 'ko',
    tier: 'exp',
    freq: '하',
  },
  // en `who do I` is the shared contiguous prefix of `who do I pay`/`who do
  // I owe`/`who do I need to pay`/`who do I venmo`/`who do I zelle`; `who
  // should I` covers the one row with a different pronoun (`who should I
  // venmo`); bare `zelle who` (reversed word order) covers the 확장 row of
  // the same name. Collision-checked: none of these appear inside a bound-
  // name PAIRWISE row (no member name present) or a GROUP_TOTAL
  // `transfersFrame` row (`who owes`, a different verb).
  {
    marker: 'who do I',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'whoFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'who should I',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'whoFrame',
    locale: 'en',
    tier: 'main',
    freq: '상',
  },
  {
    marker: 'zelle who',
    intent: 'QUERY_MY_BALANCE',
    order: 5,
    role: 'whoFrame',
    locale: 'en',
    tier: 'exp',
    freq: '하',
  },
] as const satisfies readonly QueryMarkerEntry[]
