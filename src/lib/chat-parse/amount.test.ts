import { describe, expect, it } from 'vitest'
import { extractAmount } from './amount'

describe('extractAmount', () => {
  it('parses 만/천 compounds', () => {
    expect(extractAmount('김치찌개 3만원 내가', 'KRW')).toMatchObject({
      amount: '30000',
      currency: 'KRW',
    })
    expect(extractAmount('노래방 3만5천원', 'KRW')?.amount).toBe('35000')
    expect(extractAmount('커피 5천원', 'KRW')?.amount).toBe('5000')
    expect(extractAmount('만원만 냈어', 'KRW')?.amount).toBe('10000')
  })
  it('parses suffixed and comma amounts', () => {
    expect(extractAmount('택시 8,500원', 'KRW')?.amount).toBe('8500')
    expect(extractAmount('점심 12000원', 'KRW')?.amount).toBe('12000')
  })
  it('parses symbol/word currencies', () => {
    expect(extractAmount('taxi ¥2400', 'KRW')).toMatchObject({
      amount: '2400',
      currency: 'JPY',
    })
    expect(extractAmount('lunch $45.60', 'KRW')).toMatchObject({
      amount: '45.60',
      currency: 'USD',
    })
    expect(extractAmount('버스 1200엔', 'KRW')?.currency).toBe('JPY')
  })
  it('accepts a bare number only when it plausibly is money', () => {
    expect(extractAmount('숙소 120000', 'KRW')?.amount).toBe('120000')
    expect(extractAmount('숙소 1,200', 'KRW')?.amount).toBe('1200')
    // "커피 2" — a count, not money. Ask instead of guessing.
    expect(extractAmount('커피 2', 'KRW')).toBeNull()
  })
  it('reports the consumed span', () => {
    const hit = extractAmount('택시 8,500원 유나가 냄', 'KRW')!
    expect('택시 8,500원 유나가 냄'.slice(hit.start, hit.end)).toBe('8,500원')
  })
  it('returns null when there is no amount', () => {
    expect(extractAmount('편의점', 'KRW')).toBeNull()
  })
  it('reads a hangul-numeral multiplier for 만 instead of guessing wrong', () => {
    // "오만원" = 5만원 (50000), "십만원" = 10만원 (100000) — the character
    // walker reads the numeral directly instead of guessing an implicit 1.
    expect(extractAmount('오만원', 'KRW')?.amount).toBe('50000')
    expect(extractAmount('십만원', 'KRW')?.amount).toBe('100000')
    // "3만5천5백원" = 35500 — the reader accumulates every unit, so nothing
    // is dropped.
    expect(extractAmount('3만5천5백원', 'KRW')?.amount).toBe('35500')
  })
  it('does not lose precision on decimal 만 compounds', () => {
    // Number('0.07') * 10000 can land on 700.0000000000001 in float math;
    // money must come out as an exact integer string.
    expect(extractAmount('0.07만원', 'KRW')?.amount).toBe('700')
  })
  it('scans past a non-money 만/천 decoy to find the real amount', () => {
    expect(extractAmount('만두 3만원 내가', 'KRW')?.amount).toBe('30000')
    expect(extractAmount('오랜만에 회식 5만원', 'KRW')?.amount).toBe('50000')
  })
  it('reads a trailing 만 section instead of under-reporting by 10,000x', () => {
    // "5천만원" = 50,000,000 — the reader closes the 천-section and then
    // scales the whole thing by 만, instead of stopping at "5천" (=5000).
    expect(extractAmount('5천만원', 'KRW')?.amount).toBe('50000000')
  })
  it('does not reject a good amount over an unrelated trailing 백/십 char', () => {
    // "십분" (10 minutes) and "백종원식당" (a restaurant name) are not part of
    // the "3만원" amount — the trailing-unit guard must require a digit
    // directly before 백/십 to reject, not just the bare character.
    expect(extractAmount('3만원 십분 후에 만나', 'KRW')?.amount).toBe('30000')
    expect(extractAmount('3만원 백종원식당', 'KRW')?.amount).toBe('30000')
  })
  it('reads a 천/백 compound with no leading digit on the trailing unit', () => {
    // "5천백원" = 5,100 — the reader accumulates 백 into the same section as
    // 천 instead of dropping it. A digit is not required before 백/원 here
    // ("천원"/"백원" with no leading digit is standard Korean).
    expect(extractAmount('5천백원', 'KRW')?.amount).toBe('5100')
  })
  it('does not reject a complete 원-terminated amount over an unrelated 만 later in the sentence', () => {
    // "만나자" ("let's meet") starts with 만, extremely common in chat — but
    // "5천원" already consumed 원 and is a complete match, so the unrelated
    // 만 later in the sentence must not cancel it.
    expect(extractAmount('커피 5천원 만나자', 'KRW')?.amount).toBe('5000')
  })
  it('reads a trailing 천 the same way as 백/십', () => {
    // "3만천원" = 31,000 ("3만" + "천원") — the reader continues past the 만
    // section into the 천 that follows instead of stopping at 30000.
    expect(extractAmount('3만천원', 'KRW')?.amount).toBe('31000')
  })
  it('reads a multi-unit hangul tail, not just a bare 천원 tail', () => {
    // "3만천오백원" = 31,500 and "5천오백원" = 5,500 — the reader accumulates
    // every unit through to 원 instead of stopping short of the hangul tail.
    expect(extractAmount('3만천오백원', 'KRW')?.amount).toBe('31500')
    expect(extractAmount('5천오백원', 'KRW')?.amount).toBe('5500')
  })
  it('still accepts an amount followed by a 천-initial word that is not a unit', () => {
    // "천천히" ("slowly") starts with 천 but is not followed by 원, so it must
    // not cancel the valid "5만" before it.
    expect(extractAmount('5만 천천히 줄게', 'KRW')?.amount).toBe('50000')
  })
  it('does not treat a lone Sino-Korean digit with no unit as money', () => {
    // "사" (4) in "치킨 사 먹었어" ("I bought chicken") has no place-value
    // unit attached — reading it as money would shadow real amounts with
    // false positives every time a sentence happens to contain 일-구 as an
    // ordinary syllable.
    expect(extractAmount('치킨 사 먹었어', 'KRW')).toBeNull()
  })
  it('does not let a lone Sino-Korean digit shadow a real amount later in the sentence', () => {
    // "오" (5) alone in "오 그래" has no unit and must not pre-empt the real
    // "3만원" — it would otherwise report 5, hiding 30000.
    expect(extractAmount('오 그래 3만원', 'KRW')?.amount).toBe('30000')
    expect(extractAmount('나 이 12000원 냈어', 'KRW')?.amount).toBe('12000')
  })
  it('bridges whitespace between a coefficient and its unit', () => {
    // "5 만원" is still 5*10000 = 50000, not "5" (rejected, no unit) then a
    // bare "만원" (=10000).
    expect(extractAmount('5 만원', 'KRW')?.amount).toBe('50000')
  })
  it('bridges whitespace between a closed 만-section and the next 천-section', () => {
    // "3만 5천원" is 30000+5000 = 35000, not just "3만" (=30000) with "5천원"
    // silently dropped.
    expect(extractAmount('3만 5천원', 'KRW')?.amount).toBe('35000')
  })
  it('accepts a numeral glued to a closed suffix beyond 원: 씩/짜리', () => {
    expect(extractAmount('회비 3만씩 걷자', 'KRW')?.amount).toBe('30000')
    expect(extractAmount('5천짜리 선물', 'KRW')?.amount).toBe('5000')
  })
  // --- C2 round 2: amount + counter is an extremely common expense shape
  // ("3만 5명", "15만 4박 5일") — bridging into the counter and then failing
  // must back off to the amount instead of losing it entirely.
  it('backs off to the amount instead of voiding it over a trailing person-counter', () => {
    expect(extractAmount('3만 5명', 'KRW')?.amount).toBe('30000')
  })
  it('backs off to the amount instead of voiding it over a trailing night-counter', () => {
    expect(extractAmount('15만 4박 5일', 'KRW')?.amount).toBe('150000')
  })
  it('backs off to the amount instead of voiding it over a trailing round-counter', () => {
    expect(extractAmount('회식 5만 3차', 'KRW')?.amount).toBe('50000')
  })
  it('backs off to the amount instead of voiding it over a trailing per-person marker', () => {
    expect(extractAmount('3만 1인당', 'KRW')?.amount).toBe('30000')
  })
  it('backs off to the amount over a glued copula ending (3만이야)', () => {
    expect(extractAmount('3만이야', 'KRW')?.amount).toBe('30000')
  })
  it('the backed-off span still strips cleanly, leaving the counter as description text', () => {
    const input = '3만 5명 모임'
    const hit = extractAmount(input, 'KRW')!
    expect(hit.amount).toBe('30000')
    expect(input.slice(hit.start, hit.end)).toBe('3만')
    expect(input.slice(hit.end)).toBe(' 5명 모임')
  })
  // --- Round 5: a reading needs a real digit, or a closing 원/suffix — a
  // bare implied-1 unit (억/만/천 alone) is never money on its own, and a
  // trailing Sino-Korean digit with nothing after it (천사/백일) is never
  // silently truncated into a shorter "valid" number.
  it('does not treat a bare implied-1 unit with nothing around it as money', () => {
    expect(extractAmount('헐 억', 'KRW')).toBeNull()
    expect(extractAmount('아 만 진짜', 'KRW')).toBeNull()
  })
  it('does not misread a trailing Sino-Korean digit at end of string as money', () => {
    // "천사" ("angel") is not 1000, and "백일" (a baby's 100-day
    // celebration) is not 100 — both end the sentence right after the
    // decoy syllable, with no other amount anywhere to find instead.
    expect(extractAmount('점심 천사', 'KRW')).toBeNull()
  })
  // --- Final-review C1 companion assertion: `readAmountFragment`'s scan
  // (hangul-number.ts, used inside an OPEN card's CONFIRM_MODIFY reply) had
  // the "3만5천으로" -> 5 bug; this asserts the SEPARATE no-card path
  // (`extractAmount`, used by `parse()`/`classify()`'s P5 gate) never had
  // it in the first place — its rule-4 bare-number regex requires 3+ digits
  // (`\d{3,}`), so a leaked single digit like "3" or "5" was never eligible
  // here to begin with. No production code changed for this file; this
  // pins the "no-card" half of the C1 regression sweep.
  it('never leaks a bare single digit out of a failed hangul compound (C1, no-card path)', () => {
    expect(extractAmount('3만5천으로', 'KRW')).toBeNull()
    expect(extractAmount('3만5천에 바꿔줘', 'KRW')).toBeNull()
    expect(extractAmount('5천으로', 'KRW')).toBeNull()
    expect(extractAmount('금액 3만5천에 바꿔줘', 'KRW')).toBeNull()
  })
})

/**
 * Review round 1, Critical 3: leftmost-wins was a silent wrong-save path.
 * A bare number earlier in the sentence (a chat-room name, an order id, a
 * per-person count) must never outrank the amount the sentence actually
 * marks as money — the multi-amount guard counts MARKED mentions only, so it
 * would see one amount and never ask.
 */
describe('extractAmount prefers a marked amount over an earlier bare number', () => {
  it.each([
    ['카톡 1234 그리고 5만원', '50000'],
    ['1인당 12000 총 36000원', '36000'],
    ['영수증 20250813 3만원', '30000'],
  ])('%s -> %s', (input, amount) => {
    expect(extractAmount(input, 'KRW')?.amount).toBe(amount)
  })
  it('still returns a bare amount when that is all the sentence has', () => {
    expect(extractAmount('점심 12000 민수랑 나', 'KRW')?.amount).toBe('12000')
  })
})
