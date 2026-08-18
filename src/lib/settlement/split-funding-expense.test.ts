import { describe, expect, test } from 'vitest'
import { consumerDebits } from './balances'
import { convertExpense, convertFunding, fundingSources } from './convert'
import type { ExpenseInput, SettlementContext } from './types'

/**
 * The reported case, end to end (docs/BUGS.md 2026-08-04).
 *
 * A travel card holding ¥50,000 paid an ¥82,000 receipt. Charging the whole
 * receipt at the card's average rate is ₩7,360 too much on one dinner — the
 * negative wallet balance was only the symptom.
 */

// The card was loaded with ¥50,000 for ₩465,000: exactly 9.30 KRW per JPY.
const context: SettlementContext = {
  settlementCurrency: 'KRW',
  walletsById: new Map([
    [
      'card',
      {
        id: 'card',
        memberId: 'alice',
        type: 'TRAVEL_CARD',
        label: 'Travel card',
        currency: 'JPY',
      },
    ],
  ]),
  recordsByWallet: new Map([
    [
      'card',
      [
        {
          walletId: 'card',
          amountPaid: 465_000n,
          amountReceived: 50_000n,
          currency: 'JPY',
        },
      ],
    ],
  ]),
}

const dinner = (funding: ExpenseInput['funding']): ExpenseInput => ({
  payerId: 'alice',
  amount: 82_000n,
  currency: 'JPY',
  // The market rate on the day: 100 JPY = 907 KRW.
  marketRateSnapshot: '9.07',
  participantIds: ['alice', 'bob'],
  items: [],
  ...(funding === undefined ? { walletId: 'card' } : { funding }),
})

describe('an expense funded from more than one source', () => {
  test('each portion converts at its own rate', () => {
    const converted = convertFunding(
      dinner([
        { amount: 50_000n, walletId: 'card' },
        { amount: 32_000n, walletId: null },
      ]),
      'AVG_COST',
      context,
    )
    expect(converted.portions.map((portion) => portion.settlement)).toEqual([
      465_000n,
      290_240n,
    ])
    expect(
      converted.portions.map((portion) => portion.resolution.source),
    ).toEqual(['WALLET_AVG_COST', 'MARKET_SNAPSHOT'])
    expect(converted.amount).toBe(755_240n)
  })

  test('the whole receipt at the card rate is ₩7,360 too high', () => {
    const split = convertExpense(
      dinner([
        { amount: 50_000n, walletId: 'card' },
        { amount: 32_000n, walletId: null },
      ]),
      'AVG_COST',
      context,
    )
    const asShipped = convertExpense(dinner(undefined), 'AVG_COST', context)
    expect(asShipped.amount).toBe(762_600n)
    expect(asShipped.amount - split.amount).toBe(7_360n)
  })

  test('there is no single rate to name, and it says so', () => {
    const converted = convertExpense(
      dinner([
        { amount: 50_000n, walletId: 'card' },
        { amount: 32_000n, walletId: null },
      ]),
      'AVG_COST',
      context,
    )
    expect(converted.source).toBe('SPLIT_FUNDING')
    expect(converted.walletLabel).toBeUndefined()
  })

  test("a member's share is a share of what the receipt actually cost", () => {
    const debits = consumerDebits(
      dinner([
        { amount: 50_000n, walletId: 'card' },
        { amount: 32_000n, walletId: null },
      ]),
      'AVG_COST',
      context,
    )
    // Half of ₩755,240 exactly — proportional to consumption, not to which
    // pocket happened to pay.
    expect(debits.get('bob')).toBe(377_620n)
    // What the same dinner charged bob before the split existed.
    expect(
      consumerDebits(dinner(undefined), 'AVG_COST', context).get('bob'),
    ).toBe(381_300n)
  })

  test('MARKET mode prices every portion at the snapshot, as it always has', () => {
    const converted = convertFunding(
      dinner([
        { amount: 50_000n, walletId: 'card' },
        { amount: 32_000n, walletId: null },
      ]),
      'MARKET',
      context,
    )
    expect(converted.amount).toBe(743_740n)
    expect(convertExpense(dinner(undefined), 'MARKET', context).amount).toBe(
      743_740n,
    )
  })

  test('a refund splits the same way, still rounding toward zero', () => {
    const converted = convertFunding(
      {
        ...dinner(undefined),
        walletId: undefined,
        amount: -82_000n,
        funding: [
          { amount: -50_000n, walletId: 'card' },
          { amount: -32_000n, walletId: null },
        ],
      },
      'AVG_COST',
      context,
    )
    expect(converted.amount).toBe(-755_240n)
  })

  test('a portion may carry its own exchange rate, wallet or not', () => {
    const converted = convertFunding(
      dinner([
        { amount: 50_000n, walletId: 'card' },
        { amount: 32_000n, walletId: null, ownRateSnapshot: '9.5' },
      ]),
      'AVG_COST',
      context,
    )
    expect(converted.portions[1].resolution.source).toBe('OWN_EXCHANGE_RATE')
    expect(converted.portions[1].settlement).toBe(304_000n)
  })

  test('an N-way split sits at most N-1 minor units above one conversion', () => {
    // Three portions at the same rate: the only difference from converting
    // the total once is the per-portion rounding.
    const base = {
      payerId: 'alice',
      amount: 999n,
      currency: 'USD',
      marketRateSnapshot: '9.07',
      participantIds: ['alice', 'bob'],
      items: [],
    }
    const thirds = convertFunding(
      {
        ...base,
        funding: [
          { amount: 333n, walletId: null },
          { amount: 333n, walletId: null },
          { amount: 333n, walletId: null },
        ],
      },
      'AVG_COST',
      context,
    )
    const once = convertExpense(
      { ...base, walletId: null },
      'AVG_COST',
      context,
    )
    expect(thirds.amount - once.amount).toBeGreaterThanOrEqual(0n)
    expect(thirds.amount - once.amount).toBeLessThanOrEqual(2n)
  })
})

describe('fundingSources', () => {
  test('reads the single-source shorthand as one portion', () => {
    expect(fundingSources(dinner(undefined))).toEqual([
      { amount: 82_000n, walletId: 'card' },
    ])
  })

  test('refuses portions that do not add up to the expense', () => {
    expect(() =>
      fundingSources(
        dinner([
          { amount: 50_000n, walletId: 'card' },
          { amount: 30_000n, walletId: null },
        ]),
      ),
    ).toThrow(/unaccounted/)
  })

  test('refuses an expense funded from nothing', () => {
    expect(() => fundingSources(dinner([]))).toThrow(/at least one/)
  })
})
