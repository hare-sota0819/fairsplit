import { describe, expect, it } from 'vitest'
import { parseAmountToMinor } from '../format'
import { parseItems } from './items'
import type { ParsedItemList } from './items'
import type { ParseContext } from './types'

const ctx: ParseContext = {
  members: [
    { id: 'm-sota', name: '소타' },
    { id: 'm-minsu', name: '민수' },
    { id: 'm-yuna', name: '유나' },
  ],
  actorId: 'm-sota',
  defaultCurrency: 'KRW',
}

/** Shorthand: a line with no sentence-stated assignment. */
function line(name: string, unitAmount: string | null, quantity: number) {
  return { name, unitAmount, quantity, assigneeIds: [], shareAll: false }
}

/** Per-line total via the exact same arithmetic saveExpense/lineTotal use. */
function lineMinor(unitAmount: string | null, quantity: number, currency: string): bigint {
  if (unitAmount === null) return 0n
  return parseAmountToMinor(unitAmount, currency)! * BigInt(quantity)
}

/** Grand total, summed from the PARSED result's own items — never a literal. */
function grandTotalMinor(result: ParsedItemList): bigint {
  return result.items.reduce(
    (sum, item) => sum + lineMinor(item.unitAmount, item.quantity, result.currency),
    0n,
  )
}

describe('parseItems', () => {
  it("parses the owner's exact multi-item sentence", () => {
    const result = parseItems(
      '30000엔짜리 와규 덮밥 3개랑 700엔 콜라 2개, 50000엔 와규 안심 2개',
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.currency).toBe('JPY')
    expect(result!.items).toEqual([
      line('와규 덮밥', '30000', 3),
      line('콜라', '700', 2),
      line('와규 안심', '50000', 2),
    ])
    expect(grandTotalMinor(result!)).toBe(191400n)
  })

  it('reads N개 as quantity', () => {
    const result = parseItems('30000엔 스테이크 3개랑 5000엔 콜라 1개', ctx)
    expect(result!.items).toEqual([line('스테이크', '30000', 3), line('콜라', '5000', 1)])
    expect(grandTotalMinor(result!)).toBe(95000n)
  })

  it('reads N인분 as quantity', () => {
    const result = parseItems('30000엔 스테이크 3인분랑 5000엔 콜라 1개', ctx)
    expect(result!.items).toEqual([line('스테이크', '30000', 3), line('콜라', '5000', 1)])
    expect(grandTotalMinor(result!)).toBe(95000n)
  })

  it('reads N잔 as quantity', () => {
    const result = parseItems('5000엔 맥주 3잔랑 30000엔 스테이크 1개', ctx)
    expect(result!.items).toEqual([line('맥주', '5000', 3), line('스테이크', '30000', 1)])
    expect(grandTotalMinor(result!)).toBe(45000n)
  })

  it('reads ×N (multiplication sign) as quantity', () => {
    const result = parseItems('30000엔 스테이크 ×3랑 5000엔 콜라 1개', ctx)
    expect(result!.items).toEqual([line('스테이크', '30000', 3), line('콜라', '5000', 1)])
    expect(grandTotalMinor(result!)).toBe(95000n)
  })

  it('reads xN (ASCII x) as quantity', () => {
    const result = parseItems('30000엔 스테이크 x3랑 5000엔 콜라 1개', ctx)
    expect(result!.items).toEqual([line('스테이크', '30000', 3), line('콜라', '5000', 1)])
    expect(grandTotalMinor(result!)).toBe(95000n)
  })

  it('defaults quantity to 1 when no marker is present', () => {
    const result = parseItems('30000엔 스테이크랑 5000엔 콜라 1개', ctx)
    expect(result!.items).toEqual([line('스테이크', '30000', 1), line('콜라', '5000', 1)])
    expect(grandTotalMinor(result!)).toBe(35000n)
  })

  it('keeps a PRICED item with an empty name instead of vanishing its money', () => {
    const result = parseItems('30000엔 3개랑 700엔 콜라 2개', ctx)
    expect(result!.items).toEqual([line('', '30000', 3), line('콜라', '700', 2)])
    expect(grandTotalMinor(result!)).toBe(91400n)
  })

  it('parses a hangul compound unit price and strips 짜리', () => {
    const result = parseItems('만원짜리 젤라또 2개랑 5천원 아이스크림 1개', ctx)
    expect(result!.currency).toBe('KRW')
    expect(result!.items).toEqual([line('젤라또', '10000', 2), line('아이스크림', '5000', 1)])
    expect(grandTotalMinor(result!)).toBe(25000n)
  })

  it('parses symbol-prefixed amounts', () => {
    const result = parseItems('$5 콜라 3개랑 $12 피자 1개', ctx)
    expect(result!.currency).toBe('USD')
    expect(result!.items).toEqual([line('콜라', '5', 3), line('피자', '12', 1)])
    expect(grandTotalMinor(result!)).toBe(2700n)
  })

  it('rejects mixed currencies', () => {
    expect(parseItems('$5 콜라 3개랑 700엔 피자 1개', ctx)).toBeNull()
  })

  it('strips 그리고 connector from names', () => {
    const result = parseItems('30000엔 스테이크 3개 그리고 5000엔 콜라 1개', ctx)
    expect(result!.items).toEqual([line('스테이크', '30000', 3), line('콜라', '5000', 1)])
  })

  it('strips a 이랑 connector glued directly onto the name (no quantity marker)', () => {
    const result = parseItems('30000엔 스테이크이랑 5000엔 콜라', ctx)
    expect(result!.items).toEqual([line('스테이크', '30000', 1), line('콜라', '5000', 1)])
  })

  it('does not strip a 랑 that is part of the name itself, only the trailing connector', () => {
    // 랑그드샤 (langue-de-chat cookie) starts with 랑 — a global strip of
    // every 랑 occurrence would mangle it to "그드샤". Only the trailing
    // connector separating this item from the next may be removed.
    const result = parseItems('30000엔 랑그드샤랑 5000엔 콜라', ctx)
    expect(result!.items).toEqual([line('랑그드샤', '30000', 1), line('콜라', '5000', 1)])
  })

  it('keeps a leading 와 that is part of the name (와규)', () => {
    const result = parseItems('400000원 와규 2개랑 7000원 콜라 1개', ctx)
    expect(result!.items).toEqual([line('와규', '400000', 2), line('콜라', '7000', 1)])
  })

  // --- 2026-08-14 live-app fix round (docs/PROMPT.md) -----------------------

  it('single priced item WITH a quantity takes the items path (unit × qty)', () => {
    // The owner's screenshot bug: "2만엔짜리 … 2개" saved as ¥20,000. The
    // unit price × quantity reading lives here now.
    const result = parseItems('2만엔짜리 치킨 덮밥 2개 샀어', ctx)
    expect(result!.currency).toBe('JPY')
    expect(result!.items).toEqual([line('치킨 덮밥', '20000', 2)])
    expect(grandTotalMinor(result!)).toBe(40000n)
  })

  it('a plain single-amount sentence still stays out of the items path', () => {
    expect(parseItems('점심 12000원 냈어', ctx)).toBeNull()
    expect(parseItems('커피 5천원', ctx)).toBeNull()
  })

  it("the owner's screenshot-1 sentence: priced×qty plus an UNPRICED item", () => {
    const result = parseItems(
      '점심에 2만엔짜리 치킨 덮밥 2개랑 콜라 하나를 나랑 수이수이가 먹음',
      { ...ctx, members: [...ctx.members, { id: 'm-sui', name: '수이수이' }] },
    )
    expect(result!.currency).toBe('JPY')
    expect(result!.items).toEqual([line('치킨 덮밥', '20000', 2), line('콜라', null, 1)])
  })

  it("the owner's screenshot-2 sentence: all unpriced, with per-item assignment", () => {
    const withSutak: ParseContext = {
      ...ctx,
      members: [...ctx.members, { id: 'm-sutak', name: '수탉' }],
      defaultCurrency: 'JPY',
    }
    const result = parseItems(
      '내가 수탉이랑 점심에 콜라 하나, 우동 3개, 우유롤 2개를 먹었어. 우동은 내가 3개 다먹었고 콜라는 수탉이, 우유롤은 하나씩 나눠먹음',
      withSutak,
    )
    expect(result!.currency).toBe('JPY')
    expect(result!.items).toEqual([
      { name: '콜라', unitAmount: null, quantity: 1, assigneeIds: ['m-sutak'], shareAll: false },
      { name: '우동', unitAmount: null, quantity: 3, assigneeIds: ['m-sota'], shareAll: false },
      { name: '우유롤', unitAmount: null, quantity: 2, assigneeIds: [], shareAll: true },
    ])
  })

  it('native numerals count: 하나 / 두 개 / 세 개', () => {
    expect(parseItems('300엔짜리 우유 하나 샀어', { ...ctx, defaultCurrency: 'JPY' })!.items).toEqual(
      [line('우유', '300', 1)],
    )
    expect(parseItems('2000원짜리 물 두개 샀어', ctx)!.items).toEqual([line('물', '2000', 2)])
    expect(parseItems('9000원짜리 파스타 세 개랑 4000원짜리 콜라 두 잔', ctx)!.items).toEqual([
      line('파스타', '9000', 3),
      line('콜라', '4000', 2),
    ])
  })

  it('name-first order: 김치찌개 13000원이랑 콜라 7000원', () => {
    const result = parseItems('김치찌개 13000원이랑 콜라 7000원 샀어', ctx)
    expect(result!.items).toEqual([line('김치찌개', '13000', 1), line('콜라', '7000', 1)])
  })

  it('name-qty-price order reads the trailing price as the LINE total', () => {
    const result = parseItems('삼겹살 2인분 36000원, 된장찌개 하나 9000원', ctx)
    expect(result!.items).toEqual([line('삼겹살', '18000', 2), line('된장찌개', '9000', 1)])
    expect(grandTotalMinor(result!)).toBe(45000n)
  })

  it('inline per-item assignment: 커피는 수이수이가 마시고 파스타는 내가', () => {
    const result = parseItems('5000원 커피는 유나가 마시고 12000원 파스타는 내가 먹었어', ctx)
    expect(result!.items).toEqual([
      { name: '커피', unitAmount: '5000', quantity: 1, assigneeIds: ['m-yuna'], shareAll: false },
      { name: '파스타', unitAmount: '12000', quantity: 1, assigneeIds: ['m-sota'], shareAll: false },
    ])
  })

  it('a bare-number decoy never becomes an item when a marked amount exists', () => {
    // "카톡 1234" is an account-ish number; the marked 3만원 makes every bare
    // number a non-price.
    expect(parseItems('카톡 1234 보고 3만원 냈어', ctx)).toBeNull()
  })

  it('an all-bare pair still parses (legacy reading)', () => {
    const result = parseItems('콜라 1500, 우동 3000 먹었어', ctx)
    expect(result!.items).toEqual([line('콜라', '1500', 1), line('우동', '3000', 1)])
  })

  it('an all-unpriced enumeration without a consume verb is small talk, not an expense', () => {
    expect(parseItems('표 2장 남았어', ctx)).toBeNull()
  })

  it('head-count 명 is never an item quantity', () => {
    expect(parseItems('우리 4명이서 노래방 갔다옴 3만원', ctx)).toBeNull()
  })

  it('priced + unpriced mixture keeps both lines', () => {
    const result = parseItems('700엔 콜라 2개랑 우동 3개 먹었어', {
      ...ctx,
      defaultCurrency: 'JPY',
    })
    expect(result!.items).toEqual([line('콜라', '700', 2), line('우동', null, 3)])
  })
})
