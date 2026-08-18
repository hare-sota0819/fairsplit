import { describe, expect, test } from 'vitest'
import { computeNetBalances } from './balances'
import { resolveRate } from './convert'
import type { ExpenseInput, SettlementContext } from './types'

/**
 * Extended Japan-trip scenario (Phase 3A DoD): mixed CASH/CARD payer,
 * an actual-charged card expense, and a refund. The cancelled expense of
 * the product scenario is excluded BEFORE the engine (isSettleable at the
 * loader) and therefore does not appear here.
 *
 * Hand-checkable derivation (AVG_COST, settlement KRW):
 *   alice avg 9.31 (931,000/100,000), bob avg 9.03, carol no records.
 *   1. alice CASH 30,000 JPY @avg 9.31 -> 93,100/member
 *   2. bob   CASH 60,000 JPY @avg 9.03 -> 180,600/member
 *   3. carol CARD 12,000 JPY @snap 9.10 -> 36,400/member
 *   4. alice CARD 10,000 JPY, bank billed 93,000 -> 31,000/member
 *   5. alice CASH -1,000 JPY refund @avg 9.31 -> -3,103/member (toward zero)
 *   alice = 186,200-180,600-36,400+62,000-6,206 =  24,994
 *   bob   = -93,100+361,200-36,400-31,000+3,103 = 203,803
 *   carol = -93,100-180,600+72,800-31,000+3,103 = -228,797
 */
const context: SettlementContext = {
  settlementCurrency: 'KRW',
  walletsById: new Map([
    [
      'alice-jpy',
      {
        id: 'alice-jpy',
        memberId: 'alice',
        type: 'CASH',
        label: 'Cash',
        currency: 'JPY',
      },
    ],
    [
      'bob-jpy',
      {
        id: 'bob-jpy',
        memberId: 'bob',
        type: 'CASH',
        label: 'Cash',
        currency: 'JPY',
      },
    ],
  ]),
  recordsByWallet: new Map([
    [
      'alice-jpy',
      [
        {
          walletId: 'alice-jpy',
          amountPaid: 931_000n,
          amountReceived: 100_000n,
          currency: 'JPY',
        },
      ],
    ],
    [
      'bob-jpy',
      [
        {
          walletId: 'bob-jpy',
          amountPaid: 903_000n,
          amountReceived: 100_000n,
          currency: 'JPY',
        },
      ],
    ],
  ]),
}

const everyone = ['alice', 'bob', 'carol']

const trip: ExpenseInput[] = [
  {
    payerId: 'alice',
    amount: 30_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.20',
    walletId: 'alice-jpy',
    participantIds: everyone,
    items: [],
  },
  {
    payerId: 'bob',
    amount: 60_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.15',
    walletId: 'bob-jpy',
    participantIds: everyone,
    items: [],
  },
  {
    payerId: 'carol',
    amount: 12_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.10',
    walletId: null,
    participantIds: everyone,
    items: [],
  },
  {
    payerId: 'alice',
    amount: 10_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.25',
    walletId: null,
    actualChargedAmount: 93_000n,
    participantIds: everyone,
    items: [],
  },
  {
    payerId: 'alice',
    amount: -1_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.20',
    walletId: 'alice-jpy',
    participantIds: everyone,
    items: [],
  },
]

describe('extended Japan scenario (mixed methods, actual-charged, refund)', () => {
  test('AVG_COST balances match the hand-checked table', () => {
    const balances = computeNetBalances(trip, 'AVG_COST', context)
    expect(balances.get('alice')).toBe(24_994n)
    expect(balances.get('bob')).toBe(203_803n)
    expect(balances.get('carol')).toBe(-228_797n)
    expect([...balances.values()].reduce((a, b) => a + b, 0n)).toBe(0n)
  })

  test("alice's cash converts at her average but her card does not", () => {
    const sources = trip.map(
      (expense) => resolveRate(expense, 'AVG_COST', context).source,
    )
    expect(sources).toEqual([
      'WALLET_AVG_COST',
      'WALLET_AVG_COST',
      'MARKET_SNAPSHOT',
      'ACTUAL_CHARGED',
      'WALLET_AVG_COST',
    ])
  })

  test('MARKET mode uses snapshots for everything, ignoring actual-charged', () => {
    const sources = new Set(
      trip.map((expense) => resolveRate(expense, 'MARKET', context).source),
    )
    expect(sources).toEqual(new Set(['MARKET_SNAPSHOT']))
  })
})
