import { describe, expect, it } from 'vitest'
import { frontedBreakdown, shareBreakdown } from './rate-breakdown'
import {
  consumedShares,
  convertExpense,
  type ExpenseInput,
  type SettlementContext,
} from '@/lib/settlement'

/**
 * The property that matters: the rows sum EXACTLY to the headline.
 *
 * The brief was explicit — if rounding makes them not sum, fix the rounding
 * rather than fudge the display. The way this module secures it is to define
 * the headline as the fold of the rows, so there is no second computation to
 * disagree with. These tests pin that, and pin that the headline still
 * matches what the REST of the app shows for the same member.
 */

const ME = 'me'
const SOTA = 'sota'

const CONTEXT: SettlementContext = {
  settlementCurrency: 'KRW',
  walletsById: new Map([
    [
      'w-card',
      {
        id: 'w-card',
        memberId: ME,
        type: 'TRAVEL_CARD',
        label: 'Travel card',
        currency: 'JPY',
      },
    ],
    [
      'w-sota-cash',
      {
        id: 'w-sota-cash',
        memberId: SOTA,
        type: 'CASH',
        label: 'Cash',
        currency: 'JPY',
      },
    ],
  ]),
  recordsByWallet: new Map([
    // 100 JPY cost 913 KRW.
    [
      'w-card',
      [
        {
          walletId: 'w-card',
          amountPaid: 91_300n,
          amountReceived: 10_000n,
          currency: 'JPY',
        },
      ],
    ],
    // 100 JPY cost 905 KRW.
    [
      'w-sota-cash',
      [
        {
          walletId: 'w-sota-cash',
          amountPaid: 90_500n,
          amountReceived: 10_000n,
          currency: 'JPY',
        },
      ],
    ],
  ]),
}

const expense = (over: Partial<ExpenseInput>): ExpenseInput => ({
  payerId: ME,
  amount: 5_000n,
  currency: 'JPY',
  walletId: 'w-card',
  // 100 JPY = 920 KRW on the day.
  marketRateSnapshot: '9.2',
  participantIds: [ME, SOTA],
  items: [],
  ...over,
})

const TRIP: ExpenseInput[] = [
  // Paid off my travel card.
  expense({ amount: 5_000n }),
  // Paid on the spot, my card tapped at the till.
  expense({ amount: 11_000n, walletId: null }),
  // Sota paid, out of his cash.
  expense({ payerId: SOTA, amount: 3_200n, walletId: 'w-sota-cash' }),
]

describe('frontedBreakdown', () => {
  it('groups what I paid out by the rate my money converted at', () => {
    const result = frontedBreakdown(ME, TRIP, 'AVG_COST', CONTEXT)
    expect(result.rows).toHaveLength(2)
    const bySource = new Map(result.rows.map((r) => [r.source, r]))
    expect(bySource.get('WALLET_AVG_COST')?.walletLabel).toBe('Travel card')
    expect(bySource.get('WALLET_AVG_COST')?.spend).toBe(5_000n)
    expect(bySource.get('MARKET_SNAPSHOT')?.spend).toBe(11_000n)
  })

  it('ignores expenses somebody else paid for', () => {
    const rows = frontedBreakdown(ME, TRIP, 'AVG_COST', CONTEXT).rows
    expect(rows.every((row) => row.rateOwnerId === ME)).toBe(true)
    expect(rows.reduce((sum, r) => sum + r.spend, 0n)).toBe(16_000n)
  })

  it('THE INVARIANT: rows sum exactly to both headline figures', () => {
    const result = frontedBreakdown(ME, TRIP, 'AVG_COST', CONTEXT)
    expect(result.rows.reduce((s, r) => s + r.settlement, 0n)).toBe(
      result.totalSettlement,
    )
    expect(result.totalSpend).not.toBeNull()
    expect(result.rows.reduce((s, r) => s + r.spend, 0n)).toBe(
      result.totalSpend!.amount,
    )
  })

  it('agrees with what the rest of the app shows for the same member', () => {
    // The old home screen summed convertExpense over expenses I paid for.
    // The breakdown must not produce a different number.
    const legacy = TRIP.filter((e) => e.payerId === ME).reduce(
      (sum, e) => sum + convertExpense(e, 'AVG_COST', CONTEXT).amount,
      0n,
    )
    expect(
      frontedBreakdown(ME, TRIP, 'AVG_COST', CONTEXT).totalSettlement,
    ).toBe(legacy)
  })
})

describe('shareBreakdown', () => {
  it("names whose rate applied, not the viewer's", () => {
    const rows = shareBreakdown(ME, TRIP, 'AVG_COST', CONTEXT).rows
    const sotasRow = rows.find((row) => row.rateOwnerId === SOTA)
    expect(sotasRow).toBeDefined()
    expect(sotasRow?.walletLabel).toBe('Cash')
    // My share of Sota's 3,200 yen purchase, split two ways.
    expect(sotasRow?.spend).toBe(1_600n)
  })

  it('THE INVARIANT: rows sum exactly to both headline figures', () => {
    const result = shareBreakdown(ME, TRIP, 'AVG_COST', CONTEXT)
    expect(result.rows.reduce((s, r) => s + r.settlement, 0n)).toBe(
      result.totalSettlement,
    )
    expect(result.rows.reduce((s, r) => s + r.spend, 0n)).toBe(
      result.totalSpend!.amount,
    )
  })

  it('agrees with consumedShares, which the rest of the app uses', () => {
    const legacy = TRIP.reduce(
      (sum, e) => sum + (consumedShares(e, 'AVG_COST', CONTEXT).get(ME) ?? 0n),
      0n,
    )
    expect(shareBreakdown(ME, TRIP, 'AVG_COST', CONTEXT).totalSettlement).toBe(
      legacy,
    )
  })

  it('leaves out expenses the member had no share of', () => {
    const notMine = expense({
      payerId: SOTA,
      participantIds: [SOTA],
      walletId: 'w-sota-cash',
    })
    const rows = shareBreakdown(ME, [notMine], 'AVG_COST', CONTEXT).rows
    expect(rows).toHaveLength(0)
  })
})

describe('grouping rules', () => {
  it('never merges two wallets that happen to share a rate', () => {
    const twin: SettlementContext = {
      ...CONTEXT,
      walletsById: new Map([
        ...CONTEXT.walletsById,
        [
          'w-twin',
          {
            id: 'w-twin',
            memberId: ME,
            type: 'CASH',
            label: 'Cash',
            currency: 'JPY',
          },
        ],
      ]),
      recordsByWallet: new Map([
        ...CONTEXT.recordsByWallet,
        // Identical rate to w-card, by coincidence.
        [
          'w-twin',
          [
            {
              walletId: 'w-twin',
              amountPaid: 91_300n,
              amountReceived: 10_000n,
              currency: 'JPY',
            },
          ],
        ],
      ]),
    }
    const rows = frontedBreakdown(
      ME,
      [expense({ walletId: 'w-card' }), expense({ walletId: 'w-twin' })],
      'AVG_COST',
      twin,
    ).rows
    expect(rows).toHaveLength(2)
  })

  it('keeps currencies apart and refuses a mixed spend headline', () => {
    const mixed = [
      expense({ amount: 5_000n, currency: 'JPY' }),
      expense({
        amount: 20_000n,
        currency: 'KRW',
        walletId: null,
        marketRateSnapshot: '1',
      }),
    ]
    const result = frontedBreakdown(ME, mixed, 'AVG_COST', CONTEXT)
    expect(result.rows).toHaveLength(2)
    // Adding yen to won would need a rate this app has never had.
    expect(result.totalSpend).toBeNull()
    // The settlement total is still exact and still the fold of the rows.
    expect(result.rows.reduce((s, r) => s + r.settlement, 0n)).toBe(
      result.totalSettlement,
    )
  })

  it('is empty, not broken, for a member with nothing', () => {
    const empty = frontedBreakdown('nobody', TRIP, 'AVG_COST', CONTEXT)
    expect(empty.rows).toEqual([])
    expect(empty.totalSettlement).toBe(0n)
    expect(empty.totalSpend).toBeNull()
  })

  it('does not assume a maximum row count', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      expense({
        walletId: null,
        currency: 'JPY',
        marketRateSnapshot: `${9 + i}`,
      }),
    )
    const result = frontedBreakdown(ME, many, 'AVG_COST', CONTEXT)
    // Same source and currency, so they collapse — the point is that nothing
    // truncates and the fold still holds however many there are.
    expect(result.rows.reduce((s, r) => s + r.spend, 0n)).toBe(
      result.totalSpend!.amount,
    )
  })
})
