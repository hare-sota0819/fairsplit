import { describe, expect, it } from 'vitest'
import { parse } from '../index'
import type { ChatMember, ParseContext } from '../types'
import { reconcileSplit, runPipeline } from './pipeline'
import { orderHits, refineHits, removeSpans, type RefineKey } from './refine'

const members: ChatMember[] = [
  { id: 'm-sota', name: '소타' },
  { id: 'm-minsu', name: '민수' },
  { id: 'm-yuna', name: '유나' },
]
const ko: ParseContext = { members, actorId: 'm-sota', defaultCurrency: 'KRW' }
const en: ParseContext = { members: [], actorId: 'm-sota', defaultCurrency: 'USD' }

const ctxWith = (name: string, defaultCurrency: string): ParseContext => ({
  members: [{ id: 'm-x', name }],
  actorId: 'm-sota',
  defaultCurrency,
})

const text = (input: string, span: { start: number; end: number }) =>
  input.slice(span.start, span.end)

// ---------------------------------------------------------------------------
// the refiner's one rule
// ---------------------------------------------------------------------------

describe('refineHits — (start ASC, length DESC, confidence DESC)', () => {
  const key = (h: RefineKey) => h
  const at = (start: number, end: number, confidence = 1, priority = 0): RefineKey => ({
    start,
    end,
    confidence,
    priority,
  })

  it('orders by start, then by LENGTH descending, then by confidence descending', () => {
    const a = at(5, 6)
    const b = at(0, 2)
    const c = at(0, 4)
    const d = at(0, 4, 0.5)
    expect(orderHits([a, b, d, c], key)).toEqual([c, d, b, a])
  })

  it('breaks an exact span+confidence tie by priority, then by input order', () => {
    const first = at(0, 3, 1, 5)
    const second = at(0, 3, 1, 1)
    const third = at(0, 3, 1, 1)
    expect(orderHits([first, second, third], key)).toEqual([second, third, first])
  })

  it('keeps the winner and drops every hit overlapping it', () => {
    const long = at(0, 10)
    const inside = at(2, 4)
    const after = at(10, 12)
    expect(refineHits([inside, after, long], key)).toEqual([long, after])
  })

  it('drops empty spans — they consume nothing, so they can neither win nor lose', () => {
    expect(refineHits([at(3, 3), at(0, 2)], key)).toEqual([at(0, 2)])
  })
})

// ---------------------------------------------------------------------------
// (a) + (b) amount vs a member name that is also money vocabulary
// ---------------------------------------------------------------------------

describe('an amount span beats a name hit inside it', () => {
  // (a) The name "Won" is also the currency word closing "5000 won", so both
  // parsers honestly claim the same characters. The amount's span starts no
  // later and runs longer — and is the currency-MARKED reading — so it wins.
  it('a currency-marked amount outranks a name that is part of its own span', () => {
    const input = 'lunch 5000 won'
    const slots = runPipeline(input, ctxWith('Won', 'KRW'), 'both')
    expect(slots.amounts.map((h) => text(input, h))).toEqual(['5000 won'])
    expect(slots.amounts[0].value).toMatchObject({ amount: '5000', marked: true })
    expect(slots.people).toEqual([])
    expect(parse(input, ctxWith('Won', 'KRW')).description).toBe('lunch')
  })

  // (b) The same rule stated as the brief states it: a person hit strictly
  // INSIDE an amount span is dropped.
  it('drops a person hit that sits inside an amount span', () => {
    const input = '5 grand'
    const slots = runPipeline(input, ctxWith('Grand', 'USD'), 'both')
    expect(slots.people).toEqual([])
    expect(slots.amounts.map((h) => h.value.amount)).toEqual(['5000'])
  })

  // The refiner drops only what actually OVERLAPS — a name elsewhere in the
  // same sentence is untouched, which is what keeps this a rule rather than a
  // ranking of parsers.
  it('leaves a name that does not overlap the amount alone', () => {
    const input = '민수랑 5000원'
    const slots = runPipeline(input, ko, 'both')
    expect(slots.people.map((h) => h.memberId)).toEqual(['m-minsu'])
    expect(slots.amounts.map((h) => h.value.amount)).toEqual(['5000'])
  })
})

// ---------------------------------------------------------------------------
// (c) "split N ways"'s N is never an amount
// ---------------------------------------------------------------------------

describe('a split expression swallows the count inside it', () => {
  it('"split 300 ways" reports an n-ways split and NO amount', () => {
    const input = 'dinner split 300 ways'
    const slots = runPipeline(input, en, 'both')
    expect(slots.splits.map((h) => [text(input, h), h.value])).toEqual([
      ['split 300 ways', { mode: 'n-ways', n: 300 }],
    ])
    expect(slots.amounts).toEqual([])
    const p = parse(input, en)
    expect(p.amount).toBeNull()
    expect(p.amountMentions).toBe(0)
    expect(p.description).toBe('dinner')
  })

  it('a real amount NEXT TO an n-ways phrase still survives', () => {
    const input = 'lunch 300 3 ways'
    const slots = runPipeline(input, en, 'both')
    expect(slots.amounts.map((h) => text(input, h))).toEqual(['300'])
    expect(slots.splits.map((h) => text(input, h))).toEqual(['3 ways'])
    expect(parse(input, en).amount).toBe('300')
  })
})

// ---------------------------------------------------------------------------
// (d) description = input minus consumed spans
// ---------------------------------------------------------------------------

describe('consumed spans and description reconstruction', () => {
  const sentences = [
    '김치찌개 3만원 내가 냈고 민수랑 반반',
    '택시 8,500원 유나가 냄 다같이',
    '민수한테 물어보고 민수가 결제했어',
    '숙소 120000 현금',
    '커피 5천원',
    '나도 껴줘',
    '전부 다같이 30000원',
    '편의점',
  ]

  it.each(sentences)('consumed spans are sorted and never overlap: %s', (input) => {
    const { consumed } = runPipeline(input, ko, 'both')
    for (let i = 1; i < consumed.length; i++) {
      expect(consumed[i].start).toBeGreaterThanOrEqual(consumed[i - 1].end)
    }
  })

  it.each(sentences)('description is exactly input minus consumed, collapsed: %s', (input) => {
    const { consumed } = runPipeline(input, ko, 'both')
    const expected = removeSpans(input, consumed).replace(/\s+/g, ' ').trim()
    expect(parse(input, ko).description).toBe(expected)
  })

  // The Task 4/7 artifact this switchover closes: the old global NOISE regex
  // knew the stem 결제했 but not where the inflected form ended, so it left a
  // stranded 어 in the description. The pay-verb hit's span covers the whole
  // inflection, so nothing is left behind.
  it('scrubs an inflected pay verb WHOLE — no trailing-어 artifact', () => {
    expect(parse('민수한테 물어보고 민수가 결제했어', ko).description).toBe('물어보고')
  })

  // The other side of the same coin: a sentence no parser claims keeps every
  // word it has. Only 나도 (a self-mention the parse genuinely reads) goes.
  it('removes nothing a hit did not claim', () => {
    expect(parse('나도 껴줘', ko).description).toBe('껴줘')
    expect(parse('편의점', ko).description).toBe('편의점')
  })

  it('consumes the funding keyword and reports it', () => {
    const input = '숙소 120000 현금'
    const slots = runPipeline(input, ko, 'both')
    expect(slots.funding.map((h) => text(input, h))).toEqual(['현금'])
    expect(parse(input, ko).funding).toBe('NEW_CASH_WALLET')
    expect(parse(input, ko).description).toBe('숙소')
  })
})

// ---------------------------------------------------------------------------
// (e) determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it.each([
    '김치찌개 3만원 내가 냈고 민수랑 반반',
    'dinner split 300 ways',
    'lunch $45.60 민수랑 유나랑 evenly',
    '민수랑 먹었는데 민수가 냈어',
  ])('the same input twice yields deep-equal slots: %s', (input) => {
    expect(runPipeline(input, ko, 'both')).toEqual(runPipeline(input, ko, 'both'))
  })
})

// ---------------------------------------------------------------------------
// split reconciliation
// ---------------------------------------------------------------------------

describe('reconcileSplit', () => {
  const read = (input: string, ctx: ParseContext = en) =>
    reconcileSplit(runPipeline(input, ctx, 'both').splits)

  it('an explicit count wins over a plain split word when both are present', () => {
    // findSplit reports both for "split it three ways" — the words between
    // them are not its to consume — and the count is the more specific
    // statement of the same intent.
    expect(read('split it three ways')).toEqual({ even: { mode: 'n-ways', n: 3 }, half: false })
  })

  it('reads a plain everyone keyword when there is no count', () => {
    expect(read('lunch 3000 evenly')).toEqual({ even: { mode: 'everyone' }, half: false })
    expect(read('3만5천원 노래방 엔빵', ko)).toEqual({ even: { mode: 'everyone' }, half: false })
  })

  it('keeps half on its own axis — it is not another `even` value', () => {
    expect(read('술값 40000 민수랑 반반', ko)).toEqual({ even: null, half: true })
    expect(read('다같이 반반', ko)).toEqual({ even: { mode: 'everyone' }, half: true })
  })

  it('is null/false for a sentence with no split expression', () => {
    expect(read('커피 5천원', ko)).toEqual({ even: null, half: false })
  })
})

// ---------------------------------------------------------------------------
// locale gating
// ---------------------------------------------------------------------------

describe('locale', () => {
  it("'ko' skips the english parsers and 'en' skips the korean ones", () => {
    const input = '민수가 냈어 cash'
    expect(runPipeline(input, ko, 'ko').funding).toEqual([])
    expect(runPipeline(input, ko, 'en').payVerbs).toEqual([])
    expect(runPipeline(input, ko, 'both').funding).toHaveLength(1)
    expect(runPipeline(input, ko, 'both').payVerbs).toHaveLength(1)
  })
})
