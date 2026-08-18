import { describe, expect, it } from 'vitest'
import { tokenize } from '../engine/tokenizer'
import { findAmounts } from './amount'

function amounts(input: string, defaultCurrency = 'KRW') {
  return findAmounts(tokenize(input), input, defaultCurrency).map((h) => ({
    ...h.value,
    span: input.slice(h.start, h.end),
  }))
}

function first(input: string, defaultCurrency = 'KRW') {
  return amounts(input, defaultCurrency)[0] ?? null
}

describe('findAmounts — currency binding (ko)', () => {
  it.each([
    ['3만원', '30000', 'KRW'],
    ['8,500원', '8500', 'KRW'],
    ['1200엔', '1200', 'JPY'],
    ['12 달러', '12', 'USD'],
    ['30불', '30', 'USD'],
    ['12유로', '12', 'EUR'],
    ['₩8000', '8000', 'KRW'],
    ['¥2400', '2400', 'JPY'],
    ['€12', '12', 'EUR'],
    ['£20', '20', 'GBP'],
  ])('%s -> %s %s', (input, amount, currency) => {
    expect(first(input)).toMatchObject({ amount, currency, marked: true })
  })

  it('reads a hangul-only numeral with its unit', () => {
    expect(first('오만원')).toMatchObject({ amount: '50000', currency: 'KRW' })
    expect(first('십만원')).toMatchObject({ amount: '100000', currency: 'KRW' })
    expect(first('만원')).toMatchObject({ amount: '10000', currency: 'KRW' })
  })

  it('a Korean place-value compound is money on its own, with no currency word', () => {
    // Korean numerals imply a Korean-currency reading — the group's default
    // does not override them (people.ts's maskAmounts depends on this).
    expect(first('3만 5명', 'USD')).toMatchObject({
      amount: '30000',
      currency: 'KRW',
      marked: true,
      span: '3만',
    })
  })

  it('a decimal coefficient in front of a unit keeps exact integer money', () => {
    // Number('0.07') * 10000 lands on 700.0000000000001 in float math.
    expect(first('0.07만원')).toMatchObject({ amount: '700', currency: 'KRW' })
    expect(first('1.5억')).toMatchObject({ amount: '150000000' })
  })
})

describe('findAmounts — currency binding (en)', () => {
  it.each([
    ['fifty bucks', '50', 'USD'],
    ['a buck', '1', 'USD'],
    ['10 dollars', '10', 'USD'],
    ['20 quid', '20', 'GBP'],
    ['15 euros', '15', 'EUR'],
    ['500 yen', '500', 'JPY'],
    ['3000 won', '3000', 'KRW'],
    ['USD3.14', '3.14', 'USD'],
    ['3.14 USD', '3.14', 'USD'],
    ['$45.60', '45.60', 'USD'],
  ])('%s -> %s %s', (input, amount, currency) => {
    expect(first(input)).toMatchObject({ amount, currency, marked: true })
  })

  it('a slang unit binds its own currency regardless of the group default', () => {
    expect(first('fifty bucks', 'KRW')).toMatchObject({ amount: '50', currency: 'USD' })
    expect(first('20 quid', 'KRW')).toMatchObject({ amount: '20', currency: 'GBP' })
  })

  it('"a buck" composes with the en reader leaving its unit word unconsumed', () => {
    // readEnglishNumber returns value 1 spanning only "a"; the unit word is
    // this parser's to bind — the hit must still cover the whole phrase.
    expect(first('a buck')).toMatchObject({ amount: '1', currency: 'USD', span: 'a buck' })
    expect(first('a dollar')).toMatchObject({ amount: '1', currency: 'USD', span: 'a dollar' })
  })

  it('grand names no currency of its own: USD default stays USD, any other default wins', () => {
    // "a grand" is 1000 of whatever currency the group settles in — the two
    // branches the plan requires asserting.
    expect(first('a grand', 'USD')).toMatchObject({ amount: '1000', currency: 'USD', marked: true })
    expect(first('a grand', 'KRW')).toMatchObject({ amount: '1000', currency: 'KRW', marked: true })
    expect(first('5 grand', 'USD')).toMatchObject({ amount: '5000', currency: 'USD' })
    expect(first('5 grand', 'JPY')).toMatchObject({ amount: '5000', currency: 'JPY' })
  })
})

describe('findAmounts — bare numbers', () => {
  it('takes the group default currency', () => {
    expect(first('점심 12000 민수랑', 'KRW')).toMatchObject({
      amount: '12000',
      currency: 'KRW',
      marked: false,
    })
    expect(first('lunch 12000 with Minsu', 'USD')).toMatchObject({
      amount: '12000',
      currency: 'USD',
      marked: false,
    })
  })

  it('needs to look like money, not a count', () => {
    expect(amounts('커피 2')).toEqual([])
    expect(first('숙소 1,200')).toMatchObject({ amount: '1200' })
    expect(first('숙소 120000')).toMatchObject({ amount: '120000' })
  })
})

describe('findAmounts — decoys and refusals', () => {
  it.each(['만두 3개', '계산기', '편의점', '치킨 사 먹었어', '헐 억', '아 만 진짜', '점심 천사'])(
    '%s carries no amount',
    (input) => {
      expect(amounts(input)).toEqual([])
    },
  )

  it('a numeral glued to ordinary text is not confidently an amount', () => {
    // "3만5천으로 바꿔줘" is talking ABOUT a number, and the reader's span
    // ends glued to 으로 — never booked, the UI asks instead.
    expect(amounts('3만5천으로')).toEqual([])
    expect(amounts('5천으로')).toEqual([])
    expect(amounts('금액 3만5천에 바꿔줘')).toEqual([])
  })

  it('a lone Sino-Korean digit never shadows the real amount later on', () => {
    expect(first('오 그래 3만원')).toMatchObject({ amount: '30000' })
    expect(first('나 이 12000원 냈어')).toMatchObject({ amount: '12000' })
  })

  it('a decoy word after a closed amount does not void it', () => {
    // The reader walks forward into 천천히 and rejects the whole read; the
    // already-closed "5만" before it must survive that.
    expect(first('5만 천천히 줄게')).toMatchObject({ amount: '50000', span: '5만' })
  })
})

describe('findAmounts — Korean multi-segment composition (Task 3 carry-over)', () => {
  it('spells the same amount three ways to the same value', () => {
    // Mandated equality: a hangul-led read must walk across the space the
    // same way an arabic-led one does.
    for (const input of ['3만 오천원', '삼만 오천원', '삼만오천원', '3만 5천원', '3만5천원']) {
      expect(first(input)).toMatchObject({ amount: '35000', currency: 'KRW' })
    }
  })

  it('composes only strictly-decreasing segments', () => {
    // "5천 5만" is not one number — the reader stops at 5천 and so does the
    // composition (the same strictly-decreasing property, between reads).
    expect(first('5천 5만')).toMatchObject({ amount: '5000' })
    // A counter is not another money segment.
    expect(amounts('3만 5명')).toHaveLength(1)
    expect(first('15만 4박 5일')).toMatchObject({ amount: '150000' })
  })
})

describe('findAmounts — multiple mentions', () => {
  it('finds all three marked amounts in the A2 guard sentence', () => {
    const hits = amounts('13000원 김치찌개 3개, 7000원 콜라 2개, 400000원 와규 2개')
    expect(hits.map((h) => h.amount)).toEqual(['13000', '7000', '400000'])
    expect(hits.every((h) => h.marked)).toBe(true)
  })

  it('counts a single compound as one hit, not one per unit', () => {
    expect(amounts('3만5천원 노래방')).toHaveLength(1)
    expect(amounts('택시 8,500원 유나가 냄')).toHaveLength(1)
  })

  it('finds two symbol-prefixed amounts', () => {
    expect(amounts('$130 A $400 B', 'USD').map((h) => h.amount)).toEqual(['130', '400'])
  })
})

describe('findAmounts — spans', () => {
  it('covers the currency marker on either side of the number', () => {
    expect(first('택시 8,500원 유나가 냄')?.span).toBe('8,500원')
    expect(first('lunch $45.60')?.span).toBe('$45.60')
    expect(first('USD3.14')?.span).toBe('USD3.14')
    expect(first('fifty bucks')?.span).toBe('fifty bucks')
  })

  it('folds a trailing quantity suffix into the span', () => {
    expect(first('회비 3만씩 걷자')?.span).toBe('3만씩')
    expect(first('5천짜리 선물')?.span).toBe('5천짜리')
    expect(first('오만원어치 샀어')?.span).toBe('오만원어치')
  })

  it('leaves a following counter as description text', () => {
    const input = '3만 5명 모임'
    const hit = findAmounts(tokenize(input), input, 'KRW')[0]
    expect(input.slice(hit.end)).toBe(' 5명 모임')
  })

  it('does not swallow a spaced word that merely starts with a currency syllable', () => {
    // "엔진" is an engine, not 엔(JPY) — a SPACED currency word has to end
    // cleanly, unlike a glued one ("12000원이야").
    expect(first('3만 엔진 고장')).toMatchObject({ currency: 'KRW', span: '3만' })
    expect(first('12000원이야')).toMatchObject({ amount: '12000', currency: 'KRW' })
  })
})

describe('findAmounts — the "half" ruling (Task 5 carry-over)', () => {
  it('binds the number the sentence actually contains', () => {
    // Controller ruling: "half of 45 dollars" yields 45 USD. Halving is not
    // the parser's job — the number IS in the text, and inventing 22.5 would
    // be exactly the confidently-wrong-number failure this branch refuses.
    expect(first('half of 45 dollars', 'USD')).toMatchObject({ amount: '45', currency: 'USD' })
  })

  it('still refuses a read the en reader suppressed as half-modified', () => {
    // "half a million" has no number to bind — the reader suppresses it and
    // this parser does not invent one.
    expect(amounts('half a million', 'USD')).toEqual([])
  })
})

describe('findAmounts — the never-invent-a-number invariant', () => {
  const CORPUS = [
    '김치찌개 3만원 내가 냈고 민수랑 반반',
    '노래방 3만5천원',
    '삼만 오천원',
    '0.07만원',
    '택시 8,500원 유나가 냄',
    'lunch $45.60 with 민수',
    'fifty bucks each',
    'a grand',
    '5 grand',
    'USD3.14',
    '13000원 김치찌개 3개, 7000원 콜라 2개, 400000원 와규 2개',
    '점심 12000 민수랑 나',
    '5만 천천히 줄게',
    '오만원어치 샀어',
  ]

  it('re-reading a hit’s own span reproduces the same amount', () => {
    // This is the invariant the parser enforces internally (in production it
    // drops a violating hit; outside production it throws). Asserted here
    // over a corpus so a composition or multiplier bug can never pass
    // silently: the amount must be reconstructable from the consumed text.
    for (const input of CORPUS) {
      for (const hit of findAmounts(tokenize(input), input, 'KRW')) {
        const span = input.slice(hit.start, hit.end)
        const reread = findAmounts(tokenize(span), span, 'KRW')
        expect(reread).toHaveLength(1)
        expect(reread[0].value.amount).toBe(hit.value.amount)
        expect(reread[0].value.currency).toBe(hit.value.currency)
      }
    }
  })
})

describe('findAmounts — marker interaction', () => {
  it('a leading symbol names the currency a trailing slang unit does not', () => {
    expect(first('$5 grand', 'KRW')).toMatchObject({ amount: '5000', currency: 'USD' })
  })
})

// --- Review round 1 fixes ---------------------------------------------------

describe('findAmounts — reads confirmed by their right context (review C1)', () => {
  // Each of these is accepted BECAUSE of text outside the hit's own span (a
  // rolled-back josa syllable, or a 짜리 that rescues a decoy across a space),
  // so the span does not read on its own. The reproducibility invariant is
  // checked against the text from the hit's start ONWARD for exactly this
  // reason — checking the span alone threw on ordinary Korean.
  it.each([
    ['오천이야', '5000'],
    ['오만이야', '50000'],
    ['이만이야', '20000'],
    ['오만이면', '50000'],
    ['오만 짜리', '50000'],
    ['삼천 짜리', '3000'],
    ['오천 짜리 지폐', '5000'],
  ])('%s -> %s (no invariant throw)', (input, amount) => {
    expect(first(input)).toMatchObject({ amount, currency: 'KRW' })
  })
})

describe('findAmounts — a consumed trailing digit syllable (review C2)', () => {
  it('never reports 5002 for 오천이', () => {
    // The reader keeps the 이 as a ones digit (5002); in an amount it is the
    // subject particle. Nothing confirms the digit, so the honest answer is
    // to ask — 5002 would be a confidently wrong number, and re-reading the
    // span can never catch it (it re-reads as 5002 just as consistently).
    expect(amounts('오천이 나왔어')).toEqual([])
  })
  it('still keeps a trailing digit a currency word confirms', () => {
    expect(first('삼백육십오원')).toMatchObject({ amount: '365', currency: 'KRW' })
    expect(first('십이원을 냈어')).toMatchObject({ amount: '12', currency: 'KRW' })
  })
})

describe('findAmounts — bare numbers stand alone (review I4)', () => {
  it.each(['2026-08-13 정산하자', '010-1234-5678로 보내줘', '가격은 1500~2000'])(
    '%s carries no amount',
    (input) => {
      expect(amounts(input)).toEqual([])
    },
  )
  it('a MARKED amount may still sit against punctuation', () => {
    expect(first('13000원, 김치찌개')).toMatchObject({ amount: '13000' })
    expect(first('($45.60)', 'USD')).toMatchObject({ amount: '45.60', currency: 'USD' })
  })
})

describe('findAmounts — glued and spaced quantity markers (review I5, I6)', () => {
  it.each([
    ['3만원쯤', '30000'],
    ['3만원정도', '30000'],
    ['3만원했어', '30000'],
    ['오만원쯤', '50000'],
    ['12000원쯤', '12000'],
    ['3만원 정도', '30000'],
    ['회비 오만 씩 걷자', '50000'],
  ])('%s -> %s', (input, amount) => {
    expect(first(input)).toMatchObject({ amount, currency: 'KRW' })
  })
  it('folds a spaced quantity marker into the span so it leaves the description', () => {
    expect(first('3만원 정도')?.span).toBe('3만원 정도')
    expect(first('회비 오만 씩 걷자')?.span).toBe('오만 씩')
  })
})

describe('findAmounts — three spaced segments compose like two (review I7)', () => {
  it('삼만 오천 오백원 is one amount of 35500', () => {
    const hits = amounts('삼만 오천 오백원')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ amount: '35500', currency: 'KRW', span: '삼만 오천 오백원' })
  })
  it('만 이천원 is 12000, not the 2000 its tail reads alone', () => {
    expect(first('만 이천원')).toMatchObject({ amount: '12000' })
  })
  it('asks instead of reporting the tail of a number it could not read whole', () => {
    // "오만 삼천원" is 53,000; the reader declines 오만 across the space (decoy,
    // nothing rescues it), so reporting the 3,000 the tail reads would be a
    // confidently wrong number.
    expect(amounts('오만 삼천원')).toEqual([])
    // An Arabic anchor is unambiguous numeric intent, so an unreadable Korean
    // word before it never suppresses it.
    expect(first('천사 3만원')).toMatchObject({ amount: '30000' })
  })
})

// --- Review round 2 ---------------------------------------------------------

describe('findAmounts — cost is linear in the input (review round 2)', () => {
  it('parses a long message of many amounts without going quadratic', () => {
    // The reproducibility check re-parses the text from each hit's start, and
    // used to run that re-parse to completion — once per hit, over the whole
    // remaining message. That is quadratic: 400 amounts took 9.5s where the
    // old implementation took 78ms. The re-parse now stops at the first hit,
    // which is the only one it ever compares.
    const input = '3만원 '.repeat(320) // ~1,600 chars
    const started = performance.now()
    const hits = findAmounts(tokenize(input), input, 'KRW')
    const elapsed = performance.now() - started
    // Exact count pins the semantics; the wall-time bound is deliberately
    // loose (it runs in ~20ms) so this cannot flake on a busy machine.
    expect(hits).toHaveLength(320)
    expect(hits[0].value).toMatchObject({ amount: '30000', currency: 'KRW' })
    expect(elapsed).toBeLessThan(1000)
  })
})

describe('findAmounts — the place-value gate carries the quantity-marker lexicon', () => {
  it('이정도 좋아 is not ₩2', () => {
    // 정도 was added to ko/numbers.ts's continuation lexicon so that
    // "오만 씩"/"오만원쯤" survive, which also lets the reader read the 이 of
    // "이정도" ("about this much") as digit 2. Nothing downstream of the
    // reader distinguishes them — what keeps this out of the amounts is the
    // gate that refuses a Korean reading with no place-value unit and no
    // Arabic digit. This test is that gate's alarm.
    expect(amounts('이정도 좋아')).toEqual([])
    expect(amounts('이정도면 충분해')).toEqual([])
  })
})
