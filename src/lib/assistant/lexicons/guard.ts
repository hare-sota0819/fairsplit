/**
 * GUARD_PAIRS — spec §2.7's token-boundary law, transcribed verbatim, plus
 * six reviewer-named same-class pairs found while auditing the corpus for
 * further substring traps.
 *
 * Substring matching is banned for the confirm lexicons: `ㄴㅇㅈ` (노인정 =
 * NO) contains `ㅇㅈ` (인정 = YES); `unsure`/`not sure` contain `sure`; `no
 * problem` starts with `no`. A whole-token matcher (T3's `hasToken`) must
 * treat `outer` as a single unit and never let `inner` fire against it — this
 * table exists so that guarantee has a fixed, enumerable list of known traps
 * to regression-test against, not just "trust the boundary check."
 *
 * The reviewer's round-2/round-3 additions extend the same law past
 * CONFIRM_YES/NO into cross-family territory: `outer` here is often a
 * `corpus.ts` sentence (or a realistic fragment of one) and `inner` is a
 * token/marker that lives in a DIFFERENT family (CONFIRM_TOKENS,
 * NEGATE_TOKENS, HOLD_TOKENS, or NEITHER_TOKENS) — proving the whole-token
 * rule has to hold everywhere a shorter lexicon entry could hide inside a
 * longer attested string, not just within one family's own table.
 */

export interface GuardPair {
  /** The full attested string that contains the trap. */
  readonly outer: string
  /** The shorter lexicon token that must NOT match inside `outer`. */
  readonly inner: string
}

export const GUARD_PAIRS = [
  // 노인정 = NO contains 인정 = YES (spec §2.7, §3.2 ko NEGATIVE line for ㄴㅇㅈ)
  { outer: 'ㄴㅇㅈ', inner: 'ㅇㅈ' },
  // en: `unsure`/`not sure` both contain the CONFIRM_YES token `sure`
  { outer: 'unsure', inner: 'sure' },
  { outer: 'not sure', inner: 'sure' },
  // en: `no problem` (CONFIRM_YES) starts with the CONFIRM_NO_CANCEL token `no`
  { outer: 'no problem', inner: 'no' },

  // --- reviewer round-2 additions ---
  // ㄴㅇㅈ also contains the bare CONFIRM_TOKENS entry `ㅇ` (a single "yeah"
  // jamo), a second, narrower trap inside the same three-jamo string.
  { outer: 'ㄴㅇㅈ', inner: 'ㅇ' },
  // `민수 빼줘` (MODIFY_CORPUS) contains the NEGATE_TOKENS 확장 entry `빼`.
  { outer: '민수 빼줘', inner: '빼' },
  // `아니 그게 아니라` (MODIFY_CORPUS) contains the NEGATE_TOKENS entry `아니`.
  { outer: '아니 그게 아니라', inner: '아니' },
  // `scratch that, 50` (MODIFY_CORPUS) contains the NEGATE_TOKENS entry `scratch that`.
  { outer: 'scratch that, 50', inner: 'scratch that' },
  // `wait no, 50` (MODIFY_CORPUS) contains the HOLD_TOKENS entry `wait`.
  { outer: 'wait no, 50', inner: 'wait' },
  // `얼마예요` (found inside several QUERY_CORPUS rows) contains the CONFIRM_TOKENS entry `예`.
  { outer: '얼마예요', inner: '예' },

  // --- reviewer round-3 additions ---
  // `빼줘` is now itself a MODIFY_PATTERNS marker (not just a corpus
  // sentence) and still contains the NEGATE_TOKENS 확장 entry `빼`.
  { outer: '빼줘', inner: '빼' },
  // `헐 아니` (MODIFY_PATTERNS ko 확장) contains the NEGATE_TOKENS entry `아니`.
  { outer: '헐 아니', inner: '아니' },
  // `ㅎㅇ` (NEITHER_TOKENS decoy) contains the bare CONFIRM_TOKENS entry `ㅇ`.
  { outer: 'ㅎㅇ', inner: 'ㅇ' },
  // `ㅇㅎ` (NEITHER_TOKENS decoy) contains the bare CONFIRM_TOKENS entry `ㅇ`.
  { outer: 'ㅇㅎ', inner: 'ㅇ' },
  // `I'm not sure` (NEITHER_TOKENS) contains the CONFIRM_TOKENS entry `sure`.
  { outer: "I'm not sure", inner: 'sure' },
  // `헐 아니` also contains the NEITHER_TOKENS (noCard) entry `헐` — a second
  // trap in the same short string, alongside its `아니` trap above.
  { outer: '헐 아니', inner: '헐' },
  // `맞음` (CONFIRM_TOKENS ko 확장) contains the NEITHER_TOKENS (noCard) entry `음`.
  { outer: '맞음', inner: '음' },

  // --- T3 addition (optional nit from T2's review) ---
  // `아니라`/`아니고` (MODIFY_PATTERNS field:null connectives) both contain
  // the NEGATE_TOKENS entry `아니` — same class as the `헐 아니`/`아니 그게
  // 아니라` pairs above, named explicitly by T2's review as an optional nit.
  { outer: '아니라', inner: '아니' },
  { outer: '아니고', inner: '아니' },
] as const satisfies readonly GuardPair[]
