import { describe, expect, it } from 'vitest'
import {
  readAmountFragment,
  readHangulNumber,
  scanAmountCandidates,
} from './hangul-number'

describe('readHangulNumber', () => {
  it('reads a bare arabic digit run', () => {
    expect(readHangulNumber('120000', 0)).toEqual({ value: 120000n, end: 6 })
  })

  it('reads a single hangul digit before 만', () => {
    expect(readHangulNumber('오만원', 0)).toEqual({ value: 50000n, end: 2 })
  })

  it('reads 십 as an implicit-1 multiplier', () => {
    expect(readHangulNumber('십만원', 0)).toEqual({ value: 100000n, end: 2 })
  })

  it('reads an arabic digit before 만', () => {
    expect(readHangulNumber('3만원', 0)).toEqual({ value: 30000n, end: 2 })
  })

  it('reads a bare 만 as implicit-1 (10000)', () => {
    expect(readHangulNumber('만원', 0)).toEqual({ value: 10000n, end: 1 })
  })

  it('combines 만 and 천 sections: 3만5천', () => {
    expect(readHangulNumber('3만5천원', 0)).toEqual({ value: 35000n, end: 4 })
  })

  it('combines a trailing 백 with no digit of its own: 5천백원', () => {
    expect(readHangulNumber('5천백원', 0)).toEqual({ value: 5100n, end: 3 })
  })

  it('combines a multi-unit hangul tail: 3만천오백원', () => {
    expect(readHangulNumber('3만천오백원', 0)).toEqual({
      value: 31500n,
      end: 5,
    })
  })

  it('combines a multi-unit hangul tail: 5천오백원', () => {
    expect(readHangulNumber('5천오백원', 0)).toEqual({ value: 5500n, end: 4 })
  })

  it('folds an unconsumed trailing 만 into a 천-only match: 5천만원', () => {
    expect(readHangulNumber('5천만원', 0)).toEqual({ value: 50000000n, end: 3 })
  })

  it('folds an unconsumed trailing 천: 3만천원', () => {
    expect(readHangulNumber('3만천원', 0)).toEqual({ value: 31000n, end: 3 })
  })

  it('does not lose precision on a decimal 만 coefficient: 0.07만원', () => {
    expect(readHangulNumber('0.07만원', 0)).toEqual({ value: 700n, end: 5 })
  })

  it('stops before a second 천 of the same rank (천천히) and rejects via end boundary', () => {
    // "천천히" — the first 천 alone would read as 1000, but its end is glued to
    // the second 천 (a word char, not a recognized closed suffix), so the
    // whole reading is invalid.
    expect(readHangulNumber('천천히', 0)).toBeNull()
  })

  it('rejects a numeral start glued to a preceding Hangul letter (오랜만에)', () => {
    // The 만 in 오랜만에 is preceded by 랜, a word char — not a valid start.
    expect(readHangulNumber('오랜만에', 2)).toBeNull()
    // The leading 오 is part of 오랜, not a standalone digit: its end (index 1)
    // is glued to 랜, a word char that isn't a recognized closed suffix.
    expect(readHangulNumber('오랜만에', 0)).toBeNull()
  })

  it('rejects a numeral end glued to a following Hangul letter (만나자, 만두)', () => {
    expect(readHangulNumber('만나자', 0)).toBeNull()
    expect(readHangulNumber('만두', 0)).toBeNull()
  })

  it('accepts a numeral end glued to 원 specifically', () => {
    expect(readHangulNumber('만원', 0)).toEqual({ value: 10000n, end: 1 })
  })

  it('accepts a numeral end at whitespace with no currency word', () => {
    expect(readHangulNumber('5만 천천히', 0)).toEqual({ value: 50000n, end: 2 })
  })

  it('returns null when nothing at from is numeral vocabulary', () => {
    expect(readHangulNumber('편의점', 0)).toBeNull()
  })

  it('returns null at end of string', () => {
    expect(readHangulNumber('', 0)).toBeNull()
  })

  it('reads 억 as a higher section closer than 만', () => {
    expect(readHangulNumber('1억2천만원', 0)).toEqual({
      value: 120000000n,
      end: 5,
    })
  })

  // --- I5: boundary law is /[\p{L}\p{N}]/u (people.ts's isWordChar), not
  // Hangul-only — this closes the "glued to Latin" hole a Hangul-only check
  // would miss.
  it('rejects a numeral start glued to a preceding Latin letter (abc3만원)', () => {
    expect(readHangulNumber('abc3만원', 3)).toBeNull()
    // and the 만 itself, glued to the preceding digit, is also not a valid start
    expect(readHangulNumber('abc3만원', 4)).toBeNull()
  })

  // --- M6: a small CLOSED suffix allow-list (씩/정도/쯤/짜리/가량) beyond 원.
  it('accepts a numeral end glued to a closed-suffix word: 3만씩', () => {
    expect(readHangulNumber('3만씩', 0)).toEqual({ value: 30000n, end: 2 })
  })

  it('accepts a numeral end glued to a closed-suffix word: 5천짜리', () => {
    expect(readHangulNumber('5천짜리', 0)).toEqual({ value: 5000n, end: 2 })
  })

  it('accepts 정도/쯤/가량 as closed suffixes', () => {
    expect(readHangulNumber('3만정도', 0)).toEqual({ value: 30000n, end: 2 })
    expect(readHangulNumber('3만쯤', 0)).toEqual({ value: 30000n, end: 2 })
    expect(readHangulNumber('3만가량', 0)).toEqual({ value: 30000n, end: 2 })
  })

  it('still rejects decoys that are not on the closed-suffix list', () => {
    // "만족" (satisfaction) starts with 만 but 족 is not a closed suffix.
    expect(readHangulNumber('만족스러워', 0)).toBeNull()
  })

  // --- C2: whitespace bridges only (a) a pending coefficient into its unit,
  // or (b) a just-closed section into a following digit — never a
  // just-closed section into a bare unit (that would wrongly pull "천천히"
  // into "5만 천천히 줄게").
  it('bridges whitespace between a coefficient and its unit: 5 만원', () => {
    expect(readHangulNumber('5 만원', 0)).toEqual({ value: 50000n, end: 3 })
  })

  it('bridges whitespace between a closed section and the next section: 3만 5천원', () => {
    expect(readHangulNumber('3만 5천원', 0)).toEqual({ value: 35000n, end: 5 })
  })

  it('does not bridge a closed section into a bare unit: 5만 천천히', () => {
    expect(readHangulNumber('5만 천천히', 0)).toEqual({ value: 50000n, end: 2 })
  })

  it('does not bridge a pending coefficient into a following digit run', () => {
    // "5 6" has no unit anywhere — bridging would silently glue two separate
    // numbers together, which is worse than stopping at the first.
    expect(readHangulNumber('5 6', 0)).toEqual({ value: 5n, end: 1 })
  })

  // --- C2 round 2: bridging into a counter/particle that turns out not to
  // lead anywhere must back off to the last legitimately-closed section
  // instead of voiding the whole reading. "amount + counter" (5명/4박/3차/
  // 1인당) is an extremely common expense shape.
  describe('backs off to the last closed section instead of voiding the reading', () => {
    it('3만 5명 (amount + person-counter)', () => {
      expect(readHangulNumber('3만 5명', 0)).toEqual({ value: 30000n, end: 2 })
    })

    it('15만 4박 5일 (amount + night-counter)', () => {
      expect(readHangulNumber('15만 4박 5일', 0)).toEqual({
        value: 150000n,
        end: 3,
      })
    })

    it('5만 3차 (amount + round-counter)', () => {
      expect(readHangulNumber('5만 3차', 0)).toEqual({ value: 50000n, end: 2 })
    })

    it('3만 1인당 (amount + per-person marker)', () => {
      expect(readHangulNumber('3만 1인당', 0)).toEqual({
        value: 30000n,
        end: 2,
      })
    })

    it('3만이야 (amount + copula, glued with no space)', () => {
      // The walker eats "이" as a Sino-Korean digit (2), then dies on "야" —
      // CLOSED_END_SUFFIX can't list every possible verb ending, so this
      // must be handled by backing off to the checkpoint right after "만".
      expect(readHangulNumber('3만이야', 0)).toEqual({ value: 30000n, end: 2 })
    })

    it('still rejects decoys with no earlier checkpoint to back off to', () => {
      // For these, the failing position IS the last (only) closed section —
      // there is nothing strictly earlier to back off to.
      expect(readHangulNumber('만나자', 0)).toBeNull()
      expect(readHangulNumber('만두', 0)).toBeNull()
      expect(readHangulNumber('천천히', 0)).toBeNull()
      expect(readHangulNumber('오랜만에', 0)).toBeNull()
    })

    it('does not regress the C2 guard: 5만 천천히 stays 50000, not backed off further', () => {
      expect(readHangulNumber('5만 천천히', 0)).toEqual({
        value: 50000n,
        end: 2,
      })
    })

    it('a bare digit bridged into a doomed "만" still nulls (no checkpoint precedes the failure)', () => {
      // "5 만나자": the whitespace bridges "5" into "만" (case a), producing a
      // section that closes at exactly the same position where "나" then
      // fails the boundary — same position, so nothing to back off to.
      expect(readHangulNumber('5 만나자', 0)).toBeNull()
    })
  })

  // --- Round 4: probing the round-3 back-off surfaced two more wrong-number
  // hole classes, both closed by requiring a checkpoint's OWN span
  // (input.slice(from, checkpoint.end)) to contain a real digit before it
  // can be trusted as a back-off/fallback target — a bare implied-1 unit
  // with nothing in front of it (만/천/억 alone) never qualifies.
  describe('a checkpoint with no digit behind it is never trusted (round 4)', () => {
    it('rejects a bare-unit back-off with no coefficient: 천만에요/천만다행', () => {
      // 천만 alone reads as ten million, but the fallback checkpoints for it
      // ("천만" and "천") both lack a leading digit — neither is a
      // trustworthy stand-in for the idiom "not at all"/"fortunately".
      expect(readHangulNumber('천만에요', 0)).toBeNull()
      expect(readHangulNumber('천만다행', 0)).toBeNull()
    })

    it('rejects a bare-unit back-off across two BIG_UNITs: 억만장자', () => {
      expect(readHangulNumber('억만장자', 0)).toBeNull()
    })

    it('rejects a bare-unit back-off into a dangling Hangul digit: 백사장', () => {
      // "백" alone (no digit) closes, then "사" (digit 4) never finds a
      // unit before "장" — neither the dangling digit nor its bare-unit
      // checkpoint is trustworthy.
      expect(readHangulNumber('백사장', 0)).toBeNull()
    })

    it('rejects a trailing bare Sino-Korean digit with more text after it: 만이야/천이야', () => {
      // Without a leading digit on 만/천, the checkpoint they'd back off to
      // has nothing to distinguish it from money, so the whole thing nulls
      // — contrast with "3만이야" above, whose checkpoint ("3만") DOES carry
      // a digit and keeps working.
      expect(readHangulNumber('만이야', 0)).toBeNull()
      expect(readHangulNumber('천이야', 0)).toBeNull()
    })

    it('rejects a trailing bare Sino-Korean digit at end of string: 만일/만사/천사/백일/삼만이', () => {
      // At true end-of-string there is no further sentence text to weigh
      // against dropping the digit, and the whole string might be one
      // intentional numeral (see 이십오/삼십사 below) — so round 5 refuses
      // outright instead of round 4's "fall back to the checkpoint" trade
      // (which itself resolved to 10000/10000/1000/100/30000, still wrong
      // for a string that might have meant the full compound). Null beats
      // any of these silently-wrong values, per "never a confidently wrong
      // number".
      expect(readHangulNumber('만일', 0)).toBeNull()
      expect(readHangulNumber('만사', 0)).toBeNull()
      expect(readHangulNumber('천사', 0)).toBeNull()
      expect(readHangulNumber('백일', 0)).toBeNull()
      expect(readHangulNumber('삼만이', 0)).toBeNull()
      expect(readHangulNumber('이만이', 0)).toBeNull()
    })

    it('accepted trade (round 5, reversing round 4): 십일 is null, not 10', () => {
      // Round 4 accepted 십일 → 10 (dropping the linguistically real 일 = 1)
      // as a cheaper cost than the 만일/만사/천사/백일/삼만이 false
      // positives. Round 5 reverses this: the same end-of-string truncation
      // that silently drops digits off 이십오/삼십사 also silently drops
      // the 일 here — the spec's "never a confidently wrong number"
      // outranks salvaging a shorter, still-imprecise read.
      expect(readHangulNumber('십일', 0)).toBeNull()
    })

    it('refuses to misread a legitimate numeral by truncating its last digit: 이십오/삼십사', () => {
      // 이십오 = 25 and 삼십사 = 34 are complete, legitimate Sino-Korean
      // numerals — but with nothing following, the walker cannot tell them
      // apart from a decoy word whose last syllable coincidentally reads as
      // a digit (만일, 백일, ...). Rather than silently report 20/30
      // (dropping the 오/사), it refuses. Chat almost always writes numbers
      // like this in Arabic digits ("25"/"34"), so this loses little real
      // coverage.
      expect(readHangulNumber('이십오', 0)).toBeNull()
      expect(readHangulNumber('삼십사', 0)).toBeNull()
    })

    it('a dangling Sino-Korean digit with MORE text after it must not shadow a real amount', () => {
      // The critical end-to-end case: "만일" must not book 10001 (the old
      // bug) OR 10000 (the naive "always keep the checkpoint" fix) when
      // real money follows later in the sentence — it must fall all the
      // way through to null so extractAmount's scan continues to "3만원".
      expect(readHangulNumber('만일 늦으면 3만원', 0)).toBeNull()
    })

    it('keeps a trailing digit that IS followed by its own unit: 만이천원/천이백원/백이십원', () => {
      expect(readHangulNumber('만이천원', 0)).toEqual({ value: 12000n, end: 3 })
      expect(readHangulNumber('천이백원', 0)).toEqual({ value: 1200n, end: 3 })
      expect(readHangulNumber('백이십원', 0)).toEqual({ value: 120n, end: 3 })
    })

    it('re-confirms round 2/3 are unaffected: counter/copula back-offs still work', () => {
      expect(readHangulNumber('3만 5명', 0)).toEqual({ value: 30000n, end: 2 })
      expect(readHangulNumber('15만 4박 5일', 0)).toEqual({
        value: 150000n,
        end: 3,
      })
      expect(readHangulNumber('5만 3차', 0)).toEqual({ value: 50000n, end: 2 })
      expect(readHangulNumber('3만 1인당', 0)).toEqual({
        value: 30000n,
        end: 2,
      })
      expect(readHangulNumber('3만이야', 0)).toEqual({ value: 30000n, end: 2 })
    })

    it('re-confirms the C2 guard and the bridge-into-doomed-만 guard are unaffected', () => {
      expect(readHangulNumber('5만 천천히', 0)).toEqual({
        value: 50000n,
        end: 2,
      })
      expect(readHangulNumber('5 만나자', 0)).toBeNull()
    })
  })

  // --- Round 5: the round-4 EOS branch returned the checkpoint ungated
  // (letting 이십오/삼십사/십일 through with a silently truncated value),
  // and a separate pre-existing family — a bare implied-1 unit with no
  // digit and nothing closing it (헐 억, bare 만/천/억/십/백) — succeeded via
  // the plain "boundary passes trivially" path with no gate at all. One
  // predicate closes both: a reading must contain a DIGIT_CHAR, unless it
  // is closed by 원 or a CLOSED_END_SUFFIX word.
  describe('a reading needs a digit or a closing 원/suffix — no free passes (round 5)', () => {
    it('a bare implied-1 unit with nothing around it is not money: 만/천/억/십/백', () => {
      // The old regex required 만\s*원 for the implicit-1 case — never a
      // bare 만 alone. "헐 억" is not ₩100,000,000, and "아 만" is not
      // ₩10,000.
      expect(readHangulNumber('만', 0)).toBeNull()
      expect(readHangulNumber('천', 0)).toBeNull()
      expect(readHangulNumber('억', 0)).toBeNull()
      expect(readHangulNumber('십', 0)).toBeNull()
      expect(readHangulNumber('백', 0)).toBeNull()
    })

    it('a lone unit inside an exclamation is not money: 헐 억/아 만', () => {
      expect(readHangulNumber('헐 억', 2)).toBeNull()
      expect(readHangulNumber('아 만', 2)).toBeNull()
    })

    it('survives when closed by 원, even with zero digits anywhere: 만원/십만원/천원/천만원', () => {
      expect(readHangulNumber('만원', 0)).toEqual({ value: 10000n, end: 1 })
      expect(readHangulNumber('십만원', 0)).toEqual({ value: 100000n, end: 2 })
      expect(readHangulNumber('천원', 0)).toEqual({ value: 1000n, end: 1 })
      expect(readHangulNumber('천만원', 0)).toEqual({
        value: 10000000n,
        end: 2,
      })
    })

    it('survives when a real digit appears anywhere, with no 원 needed: 십오만/백이십/만이천원', () => {
      expect(readHangulNumber('십오만', 0)).toEqual({ value: 150000n, end: 3 })
      expect(readHangulNumber('백이십', 0)).toEqual({ value: 120n, end: 3 })
      expect(readHangulNumber('만이천원', 0)).toEqual({ value: 12000n, end: 3 })
    })
  })

  // --- Round 6: the digit-gated backoff loop (round 4) scanned ALL earlier
  // checkpoints, not just the most recent — for a multi-section compound
  // like "3만5천" followed by a non-suffix word, the most-recent checkpoint
  // ("3만5천" = 35000, the real value) coincides with the failing position
  // and is excluded, and the loop used to fall through to an EARLIER,
  // SHORTER checkpoint ("3만" = 30000, which does have a digit) — silently
  // truncating a fully legitimate longer reading instead of refusing.
  // Consulting only the single most recent checkpoint converts every one of
  // these to a safe `null`.
  describe('the backoff never falls through past the most recent checkpoint (round 6)', () => {
    it('does not truncate a multi-section 만+천 compound: 3만5천에', () => {
      // True value is 35000 ("3만5천"); the old backoff silently reported
      // 30000 ("3만") instead of refusing.
      expect(readHangulNumber('3만5천에', 0)).toBeNull()
    })

    it('does not truncate a multi-section 천+만 compound: 5천만에/3천만에', () => {
      // True values are 50,000,000 and 30,000,000; the old backoff fell
      // back to "5천"=5000 and "3천"=3000 — off by a factor of 10,000.
      expect(readHangulNumber('5천만에', 0)).toBeNull()
      expect(readHangulNumber('3천만에', 0)).toBeNull()
    })

    it('does not truncate a three-section 억+천+만 compound: 1억5천만에', () => {
      // True value is 150,000,000; the old backoff fell back to
      // "1억5천"=100005000, itself already wrong before even reaching the
      // final 만 section.
      expect(readHangulNumber('1억5천만에', 0)).toBeNull()
    })

    it('does not truncate a multi-section 천+백 compound: 5천백에', () => {
      // True value is 5100; the old backoff fell back to "5천"=5000.
      expect(readHangulNumber('5천백에', 0)).toBeNull()
    })

    it('does not truncate a multi-section compound before a non-suffix decoy word: 2천만다행', () => {
      // True value is 20,000,000; the old backoff fell back to "2천"=2000.
      expect(readHangulNumber('2천만다행', 0)).toBeNull()
    })

    it('does not truncate further multi-section + decoy shapes: 6천5백서요/2만7천네요', () => {
      expect(readHangulNumber('6천5백서요', 0)).toBeNull()
      expect(readHangulNumber('2만7천네요', 0)).toBeNull()
    })

    it('re-confirms every prior round is unaffected: keeps, guards, and single-checkpoint backoffs', () => {
      expect(readHangulNumber('3만이야', 0)).toEqual({ value: 30000n, end: 2 })
      expect(readHangulNumber('3만 5명', 0)).toEqual({ value: 30000n, end: 2 })
      expect(readHangulNumber('15만 4박 5일', 0)).toEqual({
        value: 150000n,
        end: 3,
      })
      expect(readHangulNumber('5만 천천히', 0)).toEqual({
        value: 50000n,
        end: 2,
      })
      expect(readHangulNumber('5 만나자', 0)).toBeNull()
      expect(readHangulNumber('천만에요', 0)).toBeNull()
      expect(readHangulNumber('천만다행', 0)).toBeNull()
      expect(readHangulNumber('억만장자', 0)).toBeNull()
    })

    it('does not reopen the decoys a relaxed cp.end <= naturalEnd would (never relax the strict <)', () => {
      // These decoys' only/most-recent checkpoint coincides EXACTLY with
      // the failing position (nothing extends past it) — the strict `<`
      // is what excludes it; relaxing to `<=` would wrongly accept it.
      expect(readHangulNumber('오만가지', 0)).toBeNull()
      expect(readHangulNumber('오만상', 0)).toBeNull()
      expect(readHangulNumber('3만나자', 0)).toBeNull()
    })
  })
})

describe('readAmountFragment', () => {
  it('reads a hangul compound fragment', () => {
    expect(readAmountFragment('4만원', 'KRW')).toEqual({
      amount: '40000',
      currency: 'KRW',
    })
  })

  it('reads a bare arabic fragment with no currency signal, using defaultCurrency', () => {
    expect(readAmountFragment('40000', 'KRW')).toEqual({
      amount: '40000',
      currency: 'KRW',
    })
    expect(readAmountFragment('50', 'USD')).toEqual({
      amount: '50',
      currency: 'USD',
    })
  })

  it('reads a symbol-prefixed fragment regardless of defaultCurrency', () => {
    expect(readAmountFragment('$45.60', 'KRW')).toEqual({
      amount: '45.60',
      currency: 'USD',
    })
  })

  it('reads a hangul-numeral multiplier the old regex could not', () => {
    expect(readAmountFragment('오만원', 'KRW')).toEqual({
      amount: '50000',
      currency: 'KRW',
    })
  })

  it('returns null for non-amount text', () => {
    expect(readAmountFragment('편의점', 'KRW')).toBeNull()
  })

  // --- C1: a lone Sino-Korean digit with no unit is not money, and must not
  // shadow a real amount elsewhere in the fragment.
  it('does not treat a lone Sino-Korean digit as money', () => {
    expect(readAmountFragment('치킨 사 먹었어', 'KRW')).toBeNull()
  })

  it('does not let a lone digit shadow a real amount later in the fragment', () => {
    expect(readAmountFragment('오 그래 3만원', 'KRW')).toEqual({
      amount: '30000',
      currency: 'KRW',
    })
  })

  it('does not let a lone digit particle shadow a suffixed amount', () => {
    expect(readAmountFragment('나 이 12000원 냈어', 'KRW')).toEqual({
      amount: '12000',
      currency: 'KRW',
    })
  })

  // --- I3: scanning variant — find every candidate, take the LAST surviving
  // one, after dropping whatever a correction connector marks as rejected.
  it('takes the corrected value out of a Korean 말고 frame', () => {
    expect(readAmountFragment('3만원 말고 4만원', 'KRW')).toEqual({
      amount: '40000',
      currency: 'KRW',
    })
  })

  it('takes the corrected value out of a Korean 이 아니라 frame', () => {
    expect(readAmountFragment('3만원이 아니라 4만원', 'KRW')).toEqual({
      amount: '40000',
      currency: 'KRW',
    })
  })

  it('tolerates a leading interjection before 아니라', () => {
    expect(readAmountFragment('아니 그게 아니라 4만원', 'KRW')).toEqual({
      amount: '40000',
      currency: 'KRW',
    })
  })

  it('tolerates a trailing Korean change-frame after the number', () => {
    expect(readAmountFragment('4만원으로 바꿔줘', 'KRW')).toEqual({
      amount: '40000',
      currency: 'KRW',
    })
  })

  it('tolerates a leading English correction frame', () => {
    expect(readAmountFragment('no I meant 50', 'USD')).toEqual({
      amount: '50',
      currency: 'USD',
    })
    expect(readAmountFragment('change it to 50', 'USD')).toEqual({
      amount: '50',
      currency: 'USD',
    })
  })

  it('keeps the value before an English "not", not the rejected one after it', () => {
    expect(readAmountFragment('actually 50 not 45', 'USD')).toEqual({
      amount: '50',
      currency: 'USD',
    })
  })

  // --- Final-review C1 (CRITICAL, money-affecting): a failed Hangul
  // compound's bare-digit fallback used to re-enter INSIDE the failed
  // reading char-by-char — "3만5천으로" nulls correctly via
  // `readHangulNumber`'s last-checkpoint rule, but the scan afterward found
  // a bare "3" (glued to the following 만) and, separately, a bare "5"
  // (glued to the preceding 만 / following 천) — "last hit wins" then
  // reported 5, i.e. ₩5, for a sentence that meant ₩35,000 (or nothing).
  // `scanAmountCandidates` now skips the WHOLE glued numeral run (digits +
  // Hangul digit/unit chars) in one jump once a compound reading there has
  // failed, instead of falling to the bare-digit regex on a sub-piece of it.
  describe('C1: a failed Hangul compound never leaks a bare-digit sub-piece', () => {
    it('3만5천으로 -> null, not 5', () => {
      expect(readAmountFragment('3만5천으로', 'KRW')).toBeNull()
    })

    it('3만5천에 바꿔줘 -> null, not 5', () => {
      expect(readAmountFragment('3만5천에 바꿔줘', 'KRW')).toBeNull()
    })

    it('5천으로 -> null, not 5', () => {
      expect(readAmountFragment('5천으로', 'KRW')).toBeNull()
    })

    it('금액 3만5천에 바꿔줘 -> null, not 5', () => {
      expect(readAmountFragment('금액 3만5천에 바꿔줘', 'KRW')).toBeNull()
    })

    it('still keeps a compound closed by 원: 3만5천원으로 -> 35000', () => {
      expect(readAmountFragment('3만5천원으로', 'KRW')).toEqual({
        amount: '35000',
        currency: 'KRW',
      })
    })

    it('still keeps a pure Arabic digit run glued to trailing Korean text: 35000으로 -> 35000', () => {
      expect(readAmountFragment('35000으로', 'KRW')).toEqual({
        amount: '35000',
        currency: 'KRW',
      })
    })
  })
})

// ===================================================================
// T3 fix round 1 (I2): a currency word confirms a numeral, not just 원
// ===================================================================

/**
 * The round-5 rule "a reading needs a digit or a closing 원/CLOSED_END_SUFFIX
 * word" was right about needing a confirming marker and wrong about WHICH
 * markers confirm: `원` was doing the work because it is a CURRENCY, not
 * because it is that particular currency. So `4천엔으로 바꿔줘` — the
 * idiomatic way to say this on a Japan trip — read as no amount at all.
 *
 * The confirming set is now the property "is a Korean currency word" over
 * `CURRENCY_TOKEN` (the module's own owning table), and the folded marker
 * decides the candidate's currency instead of the old hardcoded KRW.
 */
describe('a Hangul compound closed by any currency word (T3 fix round 1)', () => {
  it('4천엔 -> 4000 JPY, span folded past the currency word', () => {
    expect(scanAmountCandidates('4천엔')).toEqual([
      { amount: '4000', currency: 'JPY', start: 0, end: 3 },
    ])
  })

  it.each([
    ['4천엔으로', '4000', 'JPY'],
    ['3만5천엔으로', '35000', 'JPY'],
    ['4천달러로', '4000', 'USD'],
    ['4천유로로', '4000', 'EUR'],
    ['오만엔으로', '50000', 'JPY'],
  ])('%s -> %s %s', (input, amount, currency) => {
    expect(readAmountFragment(input, null)).toEqual({ amount, currency })
  })

  it('원 still wins its own pass, whitespace skip and all: 3만원으로 / 3만 원', () => {
    expect(readAmountFragment('3만원으로', null)).toEqual({
      amount: '30000',
      currency: 'KRW',
    })
    expect(scanAmountCandidates('3만 원')).toEqual([
      { amount: '30000', currency: 'KRW', start: 0, end: 4 },
    ])
  })

  it('a compound closed by a QUANTITY marker or by nothing keeps the KRW default: 3만씩 / 4만', () => {
    expect(readAmountFragment('3만씩', null)).toEqual({
      amount: '30000',
      currency: 'KRW',
    })
    expect(readAmountFragment('4만', null)).toEqual({
      amount: '40000',
      currency: 'KRW',
    })
  })

  // The currency pass requires ADJACENCY, unlike CLOSED_END_SUFFIX's
  // whitespace-skipping pass. 엔 is one syllable and starts ordinary words, so
  // a gap must NOT fold — otherwise every 엔지니어 in the language becomes yen.
  it('does not fold across whitespace into an ordinary 엔-initial word', () => {
    expect(scanAmountCandidates('3만 엔지니어에게 줬어')).toEqual([
      { amount: '30000', currency: 'KRW', start: 0, end: 2 },
    ])
  })

  // The round-5 decoy guards the 원-only rule was written for are untouched:
  // none of these is closed by a currency word either, so none gains a free
  // pass from widening the set.
  it('the round-5 decoys stay rejected: 만/천/억/십/백, 헐 억, 만나자, 천천히, 오랜만에', () => {
    for (const decoy of ['만', '천', '억', '십', '백', '만나자', '만두', '천천히', '오랜만에']) {
      expect(readHangulNumber(decoy, 0)).toBeNull()
    }
    expect(readHangulNumber('헐 억', 2)).toBeNull()
    expect(scanAmountCandidates('오만가지')).toEqual([])
    expect(scanAmountCandidates('5천만에')).toEqual([])
  })
})
