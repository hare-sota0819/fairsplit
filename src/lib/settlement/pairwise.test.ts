import fc from 'fast-check'
import { describe, expect, it, test } from 'vitest'
import { computeNetBalances } from './balances'
import {
  pairwiseContribution,
  pairwiseContributions,
  pairwiseNetFor,
} from './pairwise'
import type {
  ExpenseInput,
  MemberId,
  RateMode,
  SettlementContext,
} from './types'

// Same 3-person Japan trip fixture as balances.test.ts.
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

const trip: ExpenseInput[] = [
  {
    payerId: 'alice',
    amount: 30_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.20',
    walletId: 'alice-jpy',
    participantIds: ['alice', 'bob', 'carol'],
    items: [],
  },
  {
    payerId: 'bob',
    amount: 60_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.15',
    walletId: 'bob-jpy',
    participantIds: ['alice', 'bob', 'carol'],
    items: [],
  },
  {
    payerId: 'carol',
    amount: 12_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.10',
    // carol has no wallet: falls back to the market snapshot, same as before.
    walletId: 'carol-jpy',
    participantIds: ['alice', 'bob', 'carol'],
    items: [],
  },
]

describe('pairwiseNetFor', () => {
  test('nets what I consumed of their payments against what they consumed of mine', () => {
    const net = pairwiseNetFor('alice', trip, 'AVG_COST', context)
    // alice consumed 180600 of bob's expense; bob consumed 93100 of alice's.
    expect(net.get('bob')).toBe(180_600n - 93_100n)
    // alice consumed 36400 of carol's; carol consumed 93100 of alice's.
    expect(net.get('carol')).toBe(36_400n - 93_100n)
    // Never an entry for the member themselves.
    expect(net.has('alice')).toBe(false)
  })

  test('members with no shared expenses net to zero (absent)', () => {
    const net = pairwiseNetFor('dave', trip, 'AVG_COST', context)
    expect(net.size).toBe(0)
  })

  const memberIds = ['alice', 'bob', 'carol', 'dave', 'eve']
  const expensesArb = fc
    .array(
      fc.record({
        payerId: fc.constantFrom(...memberIds),
        amount: fc
          .bigInt({ min: -10_000_000n, max: 10_000_000n })
          .filter((a) => a !== 0n),
        currency: fc.constantFrom('JPY', 'USD', 'KRW'),
        snapshotTenths: fc.integer({ min: 1, max: 200_000 }),
        method: fc.constantFrom('CASH', 'CARD') as fc.Arbitrary<
          'CASH' | 'CARD'
        >,
        participants: fc
          .subarray(memberIds, { minLength: 1 })
          .map((ids) => [...ids]),
      }),
      { minLength: 1, maxLength: 20 },
    )
    .map((raws) =>
      raws.map((raw): ExpenseInput => ({
        payerId: raw.payerId,
        amount: raw.amount,
        currency: raw.currency,
        marketRateSnapshot: (raw.snapshotTenths / 10).toFixed(1),
        walletId: raw.method === 'CASH' ? `${raw.payerId}-jpy` : null,
        participantIds: raw.participants,
        items: [],
      })),
    )

  test('property: pairwise nets are antisymmetric', () => {
    fc.assert(
      fc.property(expensesArb, (expenses) => {
        for (const me of memberIds) {
          const mine = pairwiseNetFor(me, expenses, 'AVG_COST', context)
          for (const [other, amount] of mine) {
            const theirs = pairwiseNetFor(other, expenses, 'AVG_COST', context)
            expect(theirs.get(me) ?? 0n).toBe(-amount)
          }
        }
      }),
    )
  })

  test('property: pairwise nets sum to minus the net balance', () => {
    fc.assert(
      fc.property(expensesArb, (expenses) => {
        const balances = computeNetBalances(expenses, 'AVG_COST', context)
        for (const me of memberIds) {
          const net = pairwiseNetFor(me, expenses, 'AVG_COST', context)
          const total = [...net.values()].reduce((a, b) => a + b, 0n)
          expect(total).toBe(-(balances.get(me) ?? 0n))
        }
      }),
    )
  })
})

// No `makeExpense`/`mode` fixtures pre-existed in this file (the tests above
// build ExpenseInput literals directly and pass 'AVG_COST' inline), so this
// block defines its own minimal versions. Currency is KRW == settlementCurrency
// so the rate is identity and the numbers below need no FX arithmetic.
const mode: RateMode = 'AVG_COST'

function makeExpense(overrides: {
  payerId: MemberId
  amount: bigint
  participantIds: MemberId[]
}): ExpenseInput {
  return {
    payerId: overrides.payerId,
    amount: overrides.amount,
    currency: 'KRW',
    walletId: null,
    marketRateSnapshot: '1',
    participantIds: overrides.participantIds,
    items: [],
  }
}

describe('pairwiseContributions', () => {
  it('is empty for an expense neither of us touched', () => {
    // An expense paid by carol and consumed by carol only.
    const expense = makeExpense({
      payerId: 'carol',
      amount: 3000n,
      participantIds: ['carol'],
    })
    expect(pairwiseContributions('alice', expense, mode, context).size).toBe(0)
  })

  it('is negative against each consumer of an expense I paid', () => {
    const expense = makeExpense({
      payerId: 'alice',
      amount: 3000n,
      participantIds: ['alice', 'bob'],
    })
    const contributions = pairwiseContributions('alice', expense, mode, context)
    expect(contributions.get('bob')).toBe(-1500n)
  })

  it('is positive against the payer of an expense I consumed', () => {
    const expense = makeExpense({
      payerId: 'bob',
      amount: 3000n,
      participantIds: ['alice', 'bob'],
    })
    expect(pairwiseContribution('alice', 'bob', expense, mode, context)).toBe(
      1500n,
    )
  })

  it('reads zero for a counterparty the expense never involved', () => {
    const expense = makeExpense({
      payerId: 'bob',
      amount: 3000n,
      participantIds: ['alice', 'bob'],
    })
    expect(pairwiseContribution('alice', 'carol', expense, mode, context)).toBe(
      0n,
    )
  })

  it('sums to exactly what pairwiseNetFor reports', () => {
    // The whole point of the extraction: a row in the shared-history screen
    // can never disagree with the total printed above it.
    const expenses = [
      makeExpense({
        payerId: 'alice',
        amount: 10000n,
        participantIds: ['alice', 'bob', 'carol'],
      }),
      makeExpense({
        payerId: 'bob',
        amount: 7000n,
        participantIds: ['alice', 'bob'],
      }),
      makeExpense({
        payerId: 'carol',
        amount: 500n,
        participantIds: ['carol'],
      }),
    ]
    const total = pairwiseNetFor('alice', expenses, mode, context)
    for (const other of ['bob', 'carol']) {
      const folded = expenses.reduce(
        (sum, expense) =>
          sum + pairwiseContribution('alice', other, expense, mode, context),
        0n,
      )
      expect(folded).toBe(total.get(other) ?? 0n)
    }
  })

  it('rounds a foreign-currency share up, payer-favored, and folds consistently with pairwiseNetFor', () => {
    // Pay-as-you-go JPY expenses (walletId: null) so resolveRate always uses
    // the market snapshot rate, regardless of mode. Both JPY and KRW have 0
    // minor-unit digits, so 9.2 KRW per JPY major unit is also 9.2 per minor
    // unit (rate = 92/10).
    const paidByAlice: ExpenseInput = {
      payerId: 'alice',
      amount: 10_000n,
      currency: 'JPY',
      walletId: null,
      marketRateSnapshot: '9.2',
      participantIds: ['alice', 'bob', 'carol'],
      items: [],
    }
    const paidByBob: ExpenseInput = {
      payerId: 'bob',
      amount: 5_000n,
      currency: 'JPY',
      walletId: null,
      marketRateSnapshot: '9.2',
      participantIds: ['alice', 'bob'],
      items: [],
    }

    // paidByAlice: 10,000 JPY split 3 ways is 10,000/3 JPY/person, which does
    // not divide evenly. Converted: 10,000 * 92 / (3 * 10) = 920,000 / 30 =
    // 30,666.67 KRW, rounded UP exactly once (payer-favored ceiling) to
    // 30,667. Bob owes alice, so from alice's side that's negative.
    expect(
      pairwiseContribution('alice', 'bob', paidByAlice, mode, context),
    ).toBe(-30_667n)
    // paidByBob: 5,000 JPY split 2 ways is exactly 2,500 JPY/person ->
    // 2,500 * 92 / 10 = 23,000 KRW exactly, no rounding involved. Alice owes
    // bob, so from alice's side that's positive.
    expect(pairwiseContribution('alice', 'bob', paidByBob, mode, context)).toBe(
      23_000n,
    )

    const expenses = [paidByAlice, paidByBob]
    const total = pairwiseNetFor('alice', expenses, mode, context)
    const folded = expenses.reduce(
      (sum, expense) =>
        sum + pairwiseContribution('alice', 'bob', expense, mode, context),
      0n,
    )
    expect(folded).toBe(total.get('bob') ?? 0n)
    expect(folded).toBe(-30_667n + 23_000n)
  })
})
