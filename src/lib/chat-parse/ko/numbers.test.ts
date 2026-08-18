import { describe, expect, test, it } from 'vitest'
import fc from 'fast-check'
import { numberToHangul, numberToHangulMixed, amountToHangul } from 'es-hangul'
import { tokenize } from '../engine/tokenizer'
import { readKoreanNumber, DECOY_WORDS } from './numbers'

describe('readKoreanNumber — fixed table', () => {
  test('오만원 at 오만 -> 50000n, leaves 원 unconsumed', () => {
    const tokens = tokenize('오만원')
    const hit = readKoreanNumber(tokens, 0)
    expect(hit?.value).toBe(50000n)
    expect(hit?.start).toBe(0)
    expect(hit?.end).toBe(2)
    expect('오만원'.slice(hit!.start, hit!.end)).toBe('오만')
  })

  test('만오천 -> 15000n (leading-일 omission)', () => {
    const tokens = tokenize('만오천')
    const hit = readKoreanNumber(tokens, 0)
    expect(hit?.value).toBe(15000n)
  })

  test('5만 5천 -> 55000n (mixed, spans space)', () => {
    const tokens = tokenize('5만 5천')
    const hit = readKoreanNumber(tokens, 0)
    expect(hit?.value).toBe(55000n)
    expect(hit?.tokenCount).toBe(5)
  })

  test('1만2천 -> 12000n (mixed, no space)', () => {
    const tokens = tokenize('1만2천')
    const hit = readKoreanNumber(tokens, 0)
    expect(hit?.value).toBe(12000n)
    expect(hit?.tokenCount).toBe(4)
  })

  test('삼백육십오 -> 365n (sino)', () => {
    const tokens = tokenize('삼백육십오')
    const hit = readKoreanNumber(tokens, 0)
    expect(hit?.value).toBe(365n)
  })

  test('아흔아홉 -> 99n (native)', () => {
    const tokens = tokenize('아흔아홉')
    const hit = readKoreanNumber(tokens, 0)
    expect(hit?.value).toBe(99n)
  })

  test('만두 3만원 — 만두 is a decoy (null), 3만 reads as 30000n', () => {
    const tokens = tokenize('만두 3만원')
    const decoyHit = readKoreanNumber(tokens, 0)
    expect(decoyHit).toBeNull()
    // tokens: 만두(0) space(1) 3(2) 만원(3)
    const numHit = readKoreanNumber(tokens, 2)
    expect(numHit?.value).toBe(30000n)
  })

  test('천천히 -> null (decoy)', () => {
    const tokens = tokenize('천천히')
    expect(readKoreanNumber(tokens, 0)).toBeNull()
  })

  test('오만하다 -> null (decoy, prefix of longer word)', () => {
    const tokens = tokenize('오만하다')
    expect(readKoreanNumber(tokens, 0)).toBeNull()
  })

  test('12345678901234567만 -> null (15-significant-digit guard)', () => {
    const tokens = tokenize('12345678901234567만')
    expect(readKoreanNumber(tokens, 0)).toBeNull()
  })
})

describe('readKoreanNumber — decoy words that fully parse as numerals (review fix)', () => {
  test('천사 -> null (whole reading is an exact decoy word)', () => {
    expect(readKoreanNumber(tokenize('천사'), 0)).toBeNull()
  })

  test('천사가 -> null', () => {
    expect(readKoreanNumber(tokenize('천사가'), 0)).toBeNull()
  })

  test('천사같이 -> null', () => {
    expect(readKoreanNumber(tokenize('천사같이'), 0)).toBeNull()
  })

  test('만일 -> null (exact decoy word, not 10001)', () => {
    expect(readKoreanNumber(tokenize('만일'), 0)).toBeNull()
  })

  test('만일에 -> null', () => {
    expect(readKoreanNumber(tokenize('만일에'), 0)).toBeNull()
  })

  test('오만한 -> null (attributive form of 오만하다, not 50000)', () => {
    expect(readKoreanNumber(tokenize('오만한'), 0)).toBeNull()
  })

  test('오만해 -> null (informal-speech form of 오만하다)', () => {
    expect(readKoreanNumber(tokenize('오만해'), 0)).toBeNull()
  })

  test('오만짜리 -> 50000n (quantifier continuation survives)', () => {
    expect(readKoreanNumber(tokenize('오만짜리'), 0)?.value).toBe(50000n)
  })

  test('오만원어치 -> 50000n (multi-char currency continuation survives)', () => {
    expect(readKoreanNumber(tokenize('오만원어치'), 0)?.value).toBe(50000n)
  })
})

describe('readKoreanNumber — trailing dangling digit vs. josa (review fix)', () => {
  test('오만이면 돼 -> value 50000n, span ends before 이 (josa, not digit 2)', () => {
    const text = '오만이면 돼'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(50000n)
    expect(hit?.end).toBe(2)
    expect(text.slice(hit!.start, hit!.end)).toBe('오만')
  })

  test('만이천 -> 12000n (이 is a scaled digit, not dangling — must keep working)', () => {
    expect(readKoreanNumber(tokenize('만이천'), 0)?.value).toBe(12000n)
  })

  test('삼백육십오원 -> 365n (trailing 오 kept: 원 is an accepted continuation)', () => {
    const text = '삼백육십오원'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(365n)
    expect(text.slice(hit!.start, hit!.end)).toBe('삼백육십오')
  })
})

describe('readKoreanNumber — arabic-led decoy and counter-word guards (review fix)', () => {
  test('3조각 -> null (조 extends into decoy word 조각, not "3조")', () => {
    expect(readKoreanNumber(tokenize('3조각'), 0)).toBeNull()
  })

  test('3만두 -> null (만 extends into decoy word 만두, not "3만")', () => {
    expect(readKoreanNumber(tokenize('3만두'), 0)).toBeNull()
  })

  test('3만 2명 -> 30000n, span ends at 만 (2명 is a counter, not folded in)', () => {
    const text = '3만 2명'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(30000n)
    expect(text.slice(hit!.start, hit!.end)).toBe('3만')
  })

  test('1만 2개 -> 10000n, span ends at 만', () => {
    const text = '1만 2개'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(10000n)
    expect(text.slice(hit!.start, hit!.end)).toBe('1만')
  })

  test('3만 5000원 -> 35000n (must keep working: 원 is an accepted continuation)', () => {
    const text = '3만 5000원'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(35000n)
    expect(text.slice(hit!.start, hit!.end)).toBe('3만 5000')
  })

  test('5천 5만 -> 5000n (out-of-order unit stops at the last valid segment)', () => {
    const text = '5천 5만'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(5000n)
    expect(text.slice(hit!.start, hit!.end)).toBe('5천')
  })
})

/** The 만/억/조 markers a rendering carries, in order. A renderer that emits
 * a different set from `numberToHangul`'s has produced a string denoting a
 * DIFFERENT number, so it is not a valid oracle — see the property below. */
function tierMarkers(rendered: string): string {
  return Array.from(rendered)
    .filter((ch) => ch === '만' || ch === '억' || ch === '조')
    .join('')
}

/** The surface form ruling B claims for the subject particle: a bare
 * trailing 이 sitting directly after a 만/억/조 unit ("일만이", "오만이").
 * Deliberately a predicate on the RENDERED STRING, not on arithmetic over n
 * — the ruling is about that surface form, whatever number produced it. */
function endsWithBareIAfterBigUnit(rendered: string): boolean {
  const chars = Array.from(rendered)
  const last = chars[chars.length - 1]
  const prev = chars[chars.length - 2]
  return last === '이' && (prev === '만' || prev === '억' || prev === '조')
}

describe('readKoreanNumber — property: round-trips against es-hangul renderers', () => {
  it('recovers the original bigint from every renderer', () => {
    fc.assert(
      fc.property(fc.bigInt(1n, 9_999_999_999n), (n) => {
        const reference = tierMarkers(numberToHangul(Number(n)))
        for (const render of [numberToHangul, numberToHangulMixed, amountToHangul]) {
          const rendered = String(render(Number(n)))
          // es-hangul's amountToHangul DROPS the 만 marker whenever the
          // 만-group has no ones digit: amountToHangul('9511100000') is
          // '구십오억천백십', which genuinely denotes 9500001110, not
          // 9511100000. Such a rendering is an upstream bug, not a reader
          // input we should reproduce — skip this renderer for this n
          // (measured: ~0.06% of values, amountToHangul only) rather than
          // assert our reader mis-reads a correct string.
          if (tierMarkers(rendered) !== reference) continue
          // Deliberate josa-over-numeral preference for the bare
          // 이-after-big-unit surface form: "일만이"/"오만이" are ruled
          // 10000/50000 (the subject particle), so this renderer's output
          // for such n no longer round-trips BY DESIGN, not by defect.
          // See docs/SOLVED.md round-5 note.
          if (endsWithBareIAfterBigUnit(rendered)) continue
          // A rendered form that happens to collide with a seed decoy word
          // (numberToHangul(1004) === '천사', numberToHangul(50000) === '오만')
          // is, by design, read as null — the decoy rule exists precisely
          // to reject an exact match with no rescuing continuation. Skip
          // those seeds instead of asserting a value the reader correctly
          // won't produce, so the property is exact, not lucky.
          fc.pre(!DECOY_WORDS.includes(rendered))
          const hit = readKoreanNumber(tokenize(rendered), 0)
          expect(hit?.value).toBe(n)
        }
      }),
    )
  })
})

describe('readKoreanNumber — non-KRW currencies and counters (review fix round 2)', () => {
  test('삼백육십오엔 -> 365n (엔 is a currency, trailing 오 must not be truncated)', () => {
    const text = '삼백육십오엔'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(365n)
    expect(text.slice(hit!.start, hit!.end)).toBe('삼백육십오')
  })

  test('십오엔 -> 15n (not 10n — the truncation bug)', () => {
    const text = '십오엔'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(15n)
    expect(text.slice(hit!.start, hit!.end)).toBe('십오')
  })

  test('오만엔 -> 50000n, span ends before 엔 (exact-decoy-match rescue)', () => {
    const text = '오만엔'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(50000n)
    expect(hit?.end).toBe(2)
  })

  test('3만 2000엔 -> 32000n (currency continuation folds the segment in)', () => {
    const text = '3만 2000엔'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(32000n)
  })

  test('삼십오달러 -> 35n (달러 currency, was truncated to 30 pre-fix)', () => {
    expect(readKoreanNumber(tokenize('삼십오달러'), 0)?.value).toBe(35n)
  })

  test('삼십오명 -> 35n (counter word confirms the trailing digit)', () => {
    expect(readKoreanNumber(tokenize('삼십오명'), 0)?.value).toBe(35n)
  })

  test('이십오퍼센트 -> 25n (counter word confirms the trailing digit)', () => {
    expect(readKoreanNumber(tokenize('이십오퍼센트'), 0)?.value).toBe(25n)
  })

  test('십오큐큐 -> null (unrecognized suffix rejects the whole read, never truncates)', () => {
    expect(readKoreanNumber(tokenize('십오큐큐'), 0)).toBeNull()
  })

  test('previous fix-round regressions stay green: 3만 2명 -> 30000n, 1만 2개 -> 10000n', () => {
    expect(readKoreanNumber(tokenize('3만 2명'), 0)?.value).toBe(30000n)
    expect(readKoreanNumber(tokenize('1만 2개'), 0)?.value).toBe(10000n)
  })
})

describe('readKoreanNumber — unenumerated 이-josa, currency-only decoy rescue, counter boundary (review fix round 3)', () => {
  test('삼만오천이랑 -> 35000n (이-initial josa outside any enumerated list)', () => {
    expect(readKoreanNumber(tokenize('삼만오천이랑'), 0)?.value).toBe(35000n)
  })

  test('오만이나 -> 50000n', () => {
    expect(readKoreanNumber(tokenize('오만이나'), 0)?.value).toBe(50000n)
  })

  test('오만이에요 -> 50000n', () => {
    expect(readKoreanNumber(tokenize('오만이에요'), 0)?.value).toBe(50000n)
  })

  test('오만이면 -> 50000n (regression: still rolls back with no enumerated list)', () => {
    expect(readKoreanNumber(tokenize('오만이면'), 0)?.value).toBe(50000n)
  })

  test('십오큐큐 -> null (regression: non-이 dangling digit still rejects)', () => {
    expect(readKoreanNumber(tokenize('십오큐큐'), 0)).toBeNull()
  })

  test('만이천 -> 12000n (regression: 이 followed by a unit is not dangling)', () => {
    expect(readKoreanNumber(tokenize('만이천'), 0)?.value).toBe(12000n)
  })

  test('천사장 -> null (counter does not rescue an exact decoy match)', () => {
    expect(readKoreanNumber(tokenize('천사장'), 0)).toBeNull()
  })

  test('천사병 -> null', () => {
    expect(readKoreanNumber(tokenize('천사병'), 0)).toBeNull()
  })

  test('만일분 -> null', () => {
    expect(readKoreanNumber(tokenize('만일분'), 0)).toBeNull()
  })

  test('천사원 -> 1004n (currency still rescues an exact decoy match)', () => {
    expect(readKoreanNumber(tokenize('천사원'), 0)?.value).toBe(1004n)
  })

  test('사장님이 -> null (counter match requires a real word boundary, not mid-word)', () => {
    expect(readKoreanNumber(tokenize('사장님이'), 0)).toBeNull()
  })

  test('일번지 -> null (mid-word counter match must not fire)', () => {
    expect(readKoreanNumber(tokenize('일번지'), 0)).toBeNull()
  })

  test('삼십오명 -> 35n (must keep working: counter at a real token-end boundary)', () => {
    expect(readKoreanNumber(tokenize('삼십오명'), 0)?.value).toBe(35n)
  })
})

describe('readKoreanNumber — particle boundary after a currency/counter word (review fix round 4)', () => {
  // Round 3's boundary test only accepted end-of-token or a leading 이, so
  // EVERY other Korean particle after 원/엔/달러/명/... either truncated the
  // value or nulled the whole read. Case/auxiliary particles are a closed
  // grammatical class, so they are enumerated properly here.
  const TRUNCATED: ReadonlyArray<readonly [string, bigint, string]> = [
    ['십이원을', 12n, '십이'],
    ['십이원씩', 12n, '십이'],
    ['십이달러를', 12n, '십이'],
    ['삼십이원을', 32n, '삼십이'],
    ['삼백육십이원을', 362n, '삼백육십이'],
    ['이십이원을', 22n, '이십이'],
    ['3만 5000원을 냈어', 35000n, '3만 5000'],
    ['3만 2000엔씩', 32000n, '3만 2000'],
  ]
  test.each(TRUNCATED)('%s -> %s (was silently truncated)', (text, value, span) => {
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(value)
    expect(text.slice(hit!.start, hit!.end)).toBe(span)
  })

  const FALSE_NULLS: ReadonlyArray<readonly [string, bigint]> = [
    ['삼십오원을', 35n],
    ['삼십오원씩', 35n],
    ['삼십오원에', 35n],
    ['삼십오원으로', 35n],
    ['삼십오원부터', 35n],
    ['삼십오원까지', 35n],
    ['삼십오원하고', 35n],
    ['삼백육십오원을', 365n],
    ['삼십오명은', 35n],
    ['삼십오명한테', 35n],
    ['삼십오달러씩', 35n],
    ['이십오퍼센트만', 25n],
    ['오만원을', 50000n],
    ['오만원은', 50000n],
    ['오만원씩', 50000n],
    ['오만원만', 50000n],
    ['오만원도', 50000n],
    ['오만원에', 50000n],
    ['오만원한테', 50000n],
    ['오만원짜리를', 50000n],
    ['오만원어치를', 50000n],
    ['천사원을', 1004n],
  ]
  test.each(FALSE_NULLS)('%s -> %s (was wrongly null)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  test('사장님이 -> null (님 is not a particle: mid-word counter match must stay rejected)', () => {
    expect(readKoreanNumber(tokenize('사장님이'), 0)).toBeNull()
  })

  test.each(['사장', '사장이', '사장을', '사장하고', '사장과', '사장님이'])(
    '%s -> null (digit-4 + counter 장 is the word 사장 — decoy lexicon, not a boundary rule)',
    (text) => {
      expect(readKoreanNumber(tokenize(text), 0)).toBeNull()
    },
  )

  test('이인분 -> 2n (structurally identical to 사장 — only the lexicon separates them)', () => {
    expect(readKoreanNumber(tokenize('이인분'), 0)?.value).toBe(2n)
  })

  test('일번지 -> null (지 is not a particle)', () => {
    expect(readKoreanNumber(tokenize('일번지'), 0)).toBeNull()
  })

  test('삼십오명 -> 35n (end-of-token boundary still works)', () => {
    expect(readKoreanNumber(tokenize('삼십오명'), 0)?.value).toBe(35n)
  })
})

describe('readKoreanNumber — cross-token currency/counter (review fix round 4)', () => {
  test('오만 원 -> 50000n, span still ends at 오만 (space-separated currency rescues the decoy)', () => {
    const text = '오만 원'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(50000n)
    expect(text.slice(hit!.start, hit!.end)).toBe('오만')
  })

  test('오만 원을 -> 50000n (a josa on the next-token currency must not break the rescue)', () => {
    const hit = readKoreanNumber(tokenize('오만 원을'), 0)
    expect(hit?.value).toBe(50000n)
  })

  test('오만 명 -> null (a counter across a space does not rescue a whole-word decoy)', () => {
    expect(readKoreanNumber(tokenize('오만 명'), 0)).toBeNull()
  })

  test('삼십오 명 -> 35n (dangling small number accepted before a space-separated counter)', () => {
    const text = '삼십오 명'
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(35n)
    expect(text.slice(hit!.start, hit!.end)).toBe('삼십오')
  })
})

describe('readKoreanNumber — end-of-token dangling 이 after a big unit (review fix round 5)', () => {
  // Controller ruling: at the END of a token, a bare trailing 이 directly
  // after a 만/억/조 unit is the subject particle, not the ones digit —
  // "오만이 넘었어" is 50000, and someone who means 10002 writes 10002 or
  // 만이천, essentially never 일만이. Both readings are wrong in SOME rare
  // case; this is the one that is wrong less often, and the miss shows up
  // as a smaller number on the always-shown confirm card, not a silent save.
  const ROLLS_BACK: ReadonlyArray<readonly [string, bigint, string]> = [
    ['만이', 10000n, '만'],
    ['일만이', 10000n, '일만'],
    ['오만이', 50000n, '오만'],
    ['삼만이', 30000n, '삼만'],
    ['오만이 넘어', 50000n, '오만'],
  ]
  test.each(ROLLS_BACK)('%s -> %s, span %s (trailing 이 is the josa)', (text, value, span) => {
    const hit = readKoreanNumber(tokenize(text), 0)
    expect(hit?.value).toBe(value)
    expect(text.slice(hit!.start, hit!.end)).toBe(span)
  })

  const KEEPS_DIGIT: ReadonlyArray<readonly [string, bigint]> = [
    ['십이', 12n],
    ['백이', 102n],
    ['이', 2n],
    // Small-unit-final, so the rule does NOT apply — pinned deliberately to
    // mark the edge of the ruling (it covers 만/억/조-tier finals only).
    ['만오천이', 15002n],
  ]
  test.each(KEEPS_DIGIT)('%s -> %s (small-unit final keeps 이 as the ones digit)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  test('만이천 -> 12000n (regression: 이 followed by a unit is not dangling)', () => {
    expect(readKoreanNumber(tokenize('만이천'), 0)?.value).toBe(12000n)
  })

  test('삼만오천이랑 -> 35000n (regression: in-token 이-rollback path unchanged)', () => {
    expect(readKoreanNumber(tokenize('삼만오천이랑'), 0)?.value).toBe(35000n)
  })

  test('오만이면 -> 50000n (regression: in-token 이-rollback path unchanged)', () => {
    expect(readKoreanNumber(tokenize('오만이면'), 0)?.value).toBe(50000n)
  })
})

describe('readKoreanNumber — <digit-syllable>+<counter>+<particle> decoys (Task 3 mandated carry-over)', () => {
  // Parked finding from the Task 2 review loop: a bare digit syllable
  // followed by a counter word and then a particle mis-reads as a number
  // (이번에 -> 2, 이분은 -> 2, 사병은 -> 4, 조이다 -> 1e12 span 조). Structurally
  // identical to the 사장-vs-이인분 pair above — only the mined decoy
  // lexicon (lexicon-decoys.ts) tells them apart.
  test.each(['이번에', '이분은', '사병은'])(
    '%s -> null at position 0 (digit+counter+particle is a decoy word, not a number)',
    (text) => {
      expect(readKoreanNumber(tokenize(text), 0)).toBeNull()
    },
  )

  test('조이다 -> null (조 must not be read as the 1e12 unit)', () => {
    expect(readKoreanNumber(tokenize('조이다'), 0)).toBeNull()
  })

  test('이인분 -> 2n (structurally identical shape, but not a decoy — stays a number)', () => {
    expect(readKoreanNumber(tokenize('이인분'), 0)?.value).toBe(2n)
  })
})

describe('readKoreanNumber — mined decoy false positives, arabic-led unit-syllable rescue (Task 3 review-fix round)', () => {
  // Critical 1: swapping the seed decoy list for the mined dictionary broke
  // a wide, test-invisible class of correct readArabicLed readings — ANY
  // mined decoy word prefixed with a scale-unit syllable (만/억/조/십/백/천)
  // killed the read with no rescue at all, including the whitespace
  // inconsistency "3만 개" -> 30000n but "3만개" -> null.
  const UNIT_COUNTER_TABLE: ReadonlyArray<readonly [string, bigint]> = [
    ['3만개', 30000n],
    ['5천개', 5000n],
    ['5천명', 5000n],
    ['3만분', 30000n],
    ['5천마리', 5000n],
    ['1만시간', 10000n],
    ['3만인분', 30000n],
    ['십분', 10n],
    ['천명', 1000n],
    ['백번', 100n],
    ['1천명', 1000n],
    ['3십분', 30n],
  ]
  test.each(UNIT_COUNTER_TABLE)('%s -> %s (unit+counter decoy rescues)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  test('3만개 === 3만 개 -> 30000n (whitespace must not change the answer)', () => {
    expect(readKoreanNumber(tokenize('3만개'), 0)?.value).toBe(30000n)
    expect(readKoreanNumber(tokenize('3만 개'), 0)?.value).toBe(30000n)
  })

  // Critical 2: isCurrencyFusion (a mining-script data-layer patch) covered
  // only 11 unit+원 words and missed the whole 천만-compound and 대-counter
  // classes. Fixed at the reader level instead (readArabicLed now reads a
  // full compound unit run via parseSino reuse, and rescues via currency OR
  // counter) — isCurrencyFusion was deleted from the mining script.
  const CHEONMAN_FAMILY: ReadonlyArray<readonly [string, bigint]> = [
    ['5천만원', 50_000_000n],
    ['2천만원', 20_000_000n],
    ['1천만원', 10_000_000n],
    ['7천만원', 70_000_000n],
  ]
  test.each(CHEONMAN_FAMILY)('%s -> %s (compound unit 천만 reads as one multiplier)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  test('1억 5천만원 -> 150000000n (two scaled segments, second is a compound unit)', () => {
    expect(readKoreanNumber(tokenize('1억 5천만원'), 0)?.value).toBe(150_000_000n)
  })

  const EOKDAE_FAMILY: ReadonlyArray<readonly [string, bigint]> = [
    ['억대', 100_000_000n],
    ['1억대', 100_000_000n],
    ['5억대', 500_000_000n],
  ]
  test.each(EOKDAE_FAMILY)('%s -> %s (억대, the counter 대, rescues both arabic- and hangul-led)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  // Bare (no leading digit) unit+currency/counter decoys, now rescued via
  // readHangulLed's endsAtUnitBoundary-gated counter rescue too.
  const BARE_UNIT_RESCUES: ReadonlyArray<readonly [string, bigint]> = [
    ['만원', 10_000n],
    ['천원', 1_000n],
    ['구원', 9n],
    ['천명', 1_000n],
    ['십분', 10n],
  ]
  test.each(BARE_UNIT_RESCUES)('%s -> %s (bare unit+currency/counter decoy rescues)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  // The 사장-class digit+counter decoys must stay null — a counter must
  // NEVER rescue a decoy whose prefix ends at a dangling DIGIT rather than
  // a unit (endsAtUnitBoundary), regardless of how permissive the unit-ending
  // rescue above got.
  test.each(['사장', '이장', '사병', '일병', '오분', '구분', '칠장', '천사장', '천사병'])(
    '%s -> null (digit-ending decoy prefix — counter rescue must not apply)',
    (text) => {
      expect(readKoreanNumber(tokenize(text), 0)).toBeNull()
    },
  )

  test('천사원 -> 1004n (regression: currency still rescues an exact decoy match)', () => {
    expect(readKoreanNumber(tokenize('천사원'), 0)?.value).toBe(1004n)
  })

  test('3만두 -> null, 3조각 -> null (regression: genuine unrelated extensions still reject)', () => {
    expect(readKoreanNumber(tokenize('3만두'), 0)).toBeNull()
    expect(readKoreanNumber(tokenize('3조각'), 0)).toBeNull()
  })
})

describe('readKoreanNumber — one grammar for arabic and sino coefficients (Task 3 review-fix round 2)', () => {
  // Critical A: readArabicLed used to multiply the leading digit by the
  // WHOLE parsed sino run in the next token instead of feeding it in as a
  // coefficient for just the next unit — "3만오천원" read as 3*15000=45000
  // instead of 3*10000+5000=35000. Fixed by retiring that separate
  // arithmetic path entirely and feeding every coefficient (arabic or
  // sino) through the SAME pending-section/tier grammar parseSino always
  // used — see docs/SOLVED.md round 8.
  const CRITICAL_A: ReadonlyArray<readonly [string, bigint]> = [
    ['3만오천원', 35000n],
    ['3만이천원', 32000n],
    ['10만오천원', 105000n],
    ['2억삼천만원', 230000000n],
    ['5천오백원', 5500n],
    ['3백오십원', 350n],
    ['3만사천오백원', 34500n],
  ]
  test.each(CRITICAL_A)('%s -> %s (arabic coefficient scales only the next unit, not the whole run)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  test('mixed, pure-hangul, and whitespace variants of the same amount agree: 3만오천원 === 삼만오천원 === "3만 오천원" -> 35000n', () => {
    expect(readKoreanNumber(tokenize('3만오천원'), 0)?.value).toBe(35000n)
    expect(readKoreanNumber(tokenize('삼만오천원'), 0)?.value).toBe(35000n)
    expect(readKoreanNumber(tokenize('3만 오천원'), 0)?.value).toBe(35000n)
  })

  // Critical B: the monotonic-decrease guard checked the FIRST unit
  // character of a chain but applied the whole (wrongly-computed) chain
  // value, so "3천5백만원" read as 5,003,000 instead of 35,000,000.
  const CRITICAL_B: ReadonlyArray<readonly [string, bigint]> = [
    ['3천5백만원', 35_000_000n],
    ['9억9천9백만원', 999_000_000n],
  ]
  test.each(CRITICAL_B)('%s -> %s (multiple small-unit tiers combine into ONE section before the big unit)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  // Finding 2 (still open after round 1): bare/suffix-less compound units
  // anchored by an arabic digit. Decoy scope ruling: an arabic-digit anchor
  // is unambiguous numeric intent, so decoy rejection (exact AND extension)
  // never applies to an arabic-anchored read — "천만" is a real mined decoy
  // word, but "5천만" must still read 50,000,000. Bare (no digit) "천만"
  // stays governed by the pure-hangul decoy rules (readHangulLed).
  const FINDING_2: ReadonlyArray<readonly [string, bigint]> = [
    ['5천만', 50_000_000n],
    ['1천만', 10_000_000n],
    ['2천만', 20_000_000n],
    ['1억5천만', 150_000_000n],
    ['5천만 원', 50_000_000n],
    ['5천만원', 50_000_000n],
    ['5천만을', 50_000_000n],
    ['5천만이랑', 50_000_000n],
    ['5천만이면', 50_000_000n],
    ['5천만개', 50_000_000n],
  ]
  test.each(FINDING_2)('%s -> %s (arabic anchor: decoy "천만" never rejects)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  test('"5천만원" === "5천만 원" === "5천만" -> 50000000n (whitespace does not change the answer)', () => {
    expect(readKoreanNumber(tokenize('5천만원'), 0)?.value).toBe(50_000_000n)
    expect(readKoreanNumber(tokenize('5천만 원'), 0)?.value).toBe(50_000_000n)
    expect(readKoreanNumber(tokenize('5천만'), 0)?.value).toBe(50_000_000n)
  })

  test('bare (no digit) 천만개/천만명 -> 10000000n via the existing pure-hangul unit-boundary counter rescue', () => {
    expect(readKoreanNumber(tokenize('천만개'), 0)?.value).toBe(10_000_000n)
    expect(readKoreanNumber(tokenize('천만명'), 0)?.value).toBe(10_000_000n)
  })

  test('bare (no digit) 천만에 -> null, bare 천만 -> null (decoy stands without an arabic anchor)', () => {
    expect(readKoreanNumber(tokenize('천만에'), 0)).toBeNull()
    expect(readKoreanNumber(tokenize('천만'), 0)).toBeNull()
  })

  test('5천 5만 -> 5000n (crossing a space to a NEW digit group does not fold into an untiered section)', () => {
    const hit = readKoreanNumber(tokenize('5천 5만'), 0)
    expect(hit?.value).toBe(5000n)
    expect('5천 5만'.slice(hit!.start, hit!.end)).toBe('5천')
  })

  test('span checks: 5천만원 and 1억 5천만원 leave the currency word unconsumed', () => {
    const a = readKoreanNumber(tokenize('5천만원'), 0)
    expect('5천만원'.slice(a!.start, a!.end)).toBe('5천만')
    const b = readKoreanNumber(tokenize('1억 5천만원'), 0)
    expect('1억 5천만원'.slice(b!.start, b!.end)).toBe('1억 5천만')
    expect(b!.tokenCount).toBe(5)
  })
})

describe('readKoreanNumber — crossedSpace guard is unit-aware, not literal-driven (Task 3 review-fix round 3)', () => {
  // Critical: round 2's crossedSpace guard blocked ANY space-crossed digit
  // while an untiered small section was pending, written from the single
  // failing literal (5천 5만) instead of the property the old per-segment
  // code actually enforced (each segment's unit strictly decreases from
  // the last). That blanket guard silently truncated spaced DESCENDING
  // amounts too — applyAtom's small-unit branch already enforces strict
  // decrease on its own, so those never needed a guard at all. The fix:
  // only block when the atom immediately AFTER the space-crossed digit is
  // a BIG unit while the section is still untiered (see docs/SOLVED.md
  // round 9).
  const SPACED_DESCENDING: ReadonlyArray<readonly [string, bigint]> = [
    ['5천 5백원', 5500n],
    ['5천 5백', 5500n],
    ['1천 5백원', 1500n],
    ['5백 5십원', 550n],
    ['3백 5십원', 350n],
    ['3천 2백 5십원', 3250n],
    ['3천 5백만원', 35_000_000n],
    ['1백 5십만원', 1_500_000n],
  ]
  test.each(SPACED_DESCENDING)('%s -> %s (spaced descending small units still combine)', (text, value) => {
    expect(readKoreanNumber(tokenize(text), 0)?.value).toBe(value)
  })

  test('5천 5만 -> 5000n (regression: the ascending case the guard exists for still stops)', () => {
    const hit = readKoreanNumber(tokenize('5천 5만'), 0)
    expect(hit?.value).toBe(5000n)
    expect('5천 5만'.slice(hit!.start, hit!.end)).toBe('5천')
  })

  test('3만 4천 5백원 -> 34500n, 12만 3천 4백원 -> 123400n (multi-segment spaced descending)', () => {
    expect(readKoreanNumber(tokenize('3만 4천 5백원'), 0)?.value).toBe(34500n)
    expect(readKoreanNumber(tokenize('12만 3천 4백원'), 0)?.value).toBe(123400n)
  })
})

describe('readKoreanNumber — 조 excluded from unit-boundary counter rescue (Task 3 review-fix round 3, Minor 1)', () => {
  // "구조" (rescue/structure) and "일조" (part of common word families) are
  // real mined decoy words whose prefix happens to end at 조 (BIG_UNIT,
  // 10^12) rather than 만/억/십/백/천 — endsAtUnitBoundary now treats 조 the
  // same as a dangling digit (never safe for counter rescue), matching
  // mine-korean-lexicons.mjs's own pre-existing exclusion of 조 from the
  // automatic decoy-prefix filter ("too noisy to mine automatically" — a
  // trillion-scale reading is essentially never intended here either).
  test.each(['구조대', '구조대가', '일조시'])('%s -> null (조-ending decoy prefix — counter rescue must not apply)', (text) => {
    expect(readKoreanNumber(tokenize(text), 0)).toBeNull()
  })
})
