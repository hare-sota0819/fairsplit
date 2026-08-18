import { describe, expect, it } from 'vitest'
import {
  convertSplitFunding,
  fundingRemainder,
  walletCapacity,
} from './split-funding'
import type { Rate } from './types'

/** 100 JPY = 930 KRW, the travel card's average in the reported case. */
const CARD: Rate = { numerator: 930n, denominator: 100n }
/** 100 JPY = 907 KRW, the market rate on the day. */
const MARKET: Rate = { numerator: 907n, denominator: 100n }

describe('fundingRemainder', () => {
  it('is what still needs a source', () => {
    expect(fundingRemainder(82_000n, [{ amount: 50_000n }])).toBe(32_000n)
  })

  it('is zero when one source covers the whole expense', () => {
    expect(fundingRemainder(50_000n, [{ amount: 50_000n }])).toBe(0n)
  })

  it('goes negative when the portions overshoot, so a caller can catch it', () => {
    expect(fundingRemainder(50_000n, [{ amount: 60_000n }])).toBe(-10_000n)
  })
})

describe('walletCapacity', () => {
  it('is the remaining balance', () => {
    expect(walletCapacity(50_000n)).toBe(50_000n)
  })

  it('is zero for an already overdrawn wallet, never a credit', () => {
    expect(walletCapacity(-32_000n)).toBe(0n)
  })
})

describe('convertSplitFunding', () => {
  it('converts each portion at its OWN rate — the whole point', () => {
    // The reported case: ¥50,000 on the card, ¥32,000 paid another way.
    const split = convertSplitFunding([
      { amount: 50_000n, rate: CARD },
      { amount: 32_000n, rate: MARKET },
    ])
    expect(split.portions).toEqual([465_000n, 290_240n])
    expect(split.amount).toBe(755_240n)
  })

  it('is NOT the same as converting the total at one rate', () => {
    // ¥82,000 all at the card rate — what the app does today, and it is
    // ₩7,000 too high because ¥32,000 never touched the card.
    const wrong = convertSplitFunding([{ amount: 82_000n, rate: CARD }])
    const right = convertSplitFunding([
      { amount: 50_000n, rate: CARD },
      { amount: 32_000n, rate: MARKET },
    ])
    expect(wrong.amount).toBe(762_600n)
    expect(wrong.amount - right.amount).toBe(7_360n)
  })

  it('matches a single conversion when there is only one portion', () => {
    const split = convertSplitFunding([{ amount: 5_800n, rate: CARD }])
    expect(split.amount).toBe(53_940n)
  })

  it('rounds each portion payer-favoured, and says so in the total', () => {
    // 1 JPY at 907/100 is 9.07 KRW; each portion rounds UP on its own.
    const split = convertSplitFunding([
      { amount: 1n, rate: MARKET },
      { amount: 1n, rate: MARKET },
    ])
    expect(split.portions).toEqual([10n, 10n])
    // Converting 2 JPY in one go would have been 19, so a two-way split can
    // sit one minor unit high. That bound is the documented cost.
    expect(split.amount).toBe(20n)
    expect(convertSplitFunding([{ amount: 2n, rate: MARKET }]).amount).toBe(19n)
  })

  it('refuses an expense with no funding at all', () => {
    expect(() => convertSplitFunding([])).toThrow(/at least one/)
  })
})
