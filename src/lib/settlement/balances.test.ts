import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { computeNetBalances } from './balances'
import { resolveRate } from './convert'
import { allocateExactShares } from './items'
import { addRatio, ratio } from './money'
import type { ExpenseInput, SettlementContext } from './types'

const sum = (balances: Map<string, bigint>): bigint =>
  [...balances.values()].reduce((a, b) => a + b, 0n)

// 3-person Japan trip (brief scenario 1): two cash payers exchanged at
// different rates (9.31 vs 9.03 KRW/JPY), one card payer on market snapshots.
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
    // carol paid by card: no wallet.
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
    // carol paid by CARD: converts at the snapshot (she also has no
    // wallet, so the Phase 1 fallback numbers are identical — asserted).
    payerId: 'carol',
    amount: 12_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.10',
    walletId: null,
    participantIds: ['alice', 'bob', 'carol'],
    items: [],
  },
]

describe('computeNetBalances', () => {
  test('AVG_COST mode: cash payers at their average rate, card payer at market fallback', () => {
    const balances = computeNetBalances(trip, 'AVG_COST', context)
    // alice: +2/3 of 30000*9.31  -1/3 of 60000*9.03  -1/3 of 12000*9.10
    expect(balances.get('alice')).toBe(-30_800n)
    expect(balances.get('bob')).toBe(231_700n)
    expect(balances.get('carol')).toBe(-200_900n)
    expect(sum(balances)).toBe(0n)
  })

  test('MARKET mode: every expense converts at its stored snapshot', () => {
    const balances = computeNetBalances(trip, 'MARKET', context)
    expect(balances.get('alice')).toBe(-35_400n)
    expect(balances.get('bob')).toBe(237_600n)
    expect(balances.get('carol')).toBe(-202_200n)
    expect(sum(balances)).toBe(0n)
  })

  test('expenses in the settlement currency need no conversion in either mode', () => {
    const expenses: ExpenseInput[] = [
      {
        payerId: 'alice',
        amount: 30_000n,
        currency: 'KRW',
        marketRateSnapshot: '1',
        walletId: 'alice-jpy',
        participantIds: ['alice', 'bob'],
        items: [],
      },
    ]
    for (const mode of ['AVG_COST', 'MARKET'] as const) {
      const balances = computeNetBalances(expenses, mode, context)
      expect(balances.get('alice')).toBe(15_000n)
      expect(balances.get('bob')).toBe(-15_000n)
    }
  })

  test('itemized expenses allocate consumers by item assignment', () => {
    const expenses: ExpenseInput[] = [
      {
        payerId: 'alice',
        amount: 3_800n,
        currency: 'KRW',
        marketRateSnapshot: '1',
        walletId: 'alice-jpy',
        participantIds: ['alice', 'bob'],
        items: [
          {
            name: 'dish',
            unitAmount: 3_000n,
            quantity: 1,
            assignees: [
              { memberId: 'alice', quantity: 1 },
              { memberId: 'bob', quantity: 1 },
            ],
          },
          {
            name: 'sake',
            unitAmount: 800n,
            quantity: 1,
            assignees: [{ memberId: 'bob', quantity: 1 }],
          },
        ],
      },
    ]
    const balances = computeNetBalances(expenses, 'MARKET', context)
    expect(balances.get('alice')).toBe(3_800n - 1_500n)
    expect(balances.get('bob')).toBe(-2_300n)
  })

  test('uneven split: each consumer share rounds up, payer keeps the surplus', () => {
    const expenses: ExpenseInput[] = [
      {
        payerId: 'alice',
        amount: 10_000n,
        currency: 'KRW',
        marketRateSnapshot: '1',
        walletId: 'alice-jpy',
        participantIds: ['alice', 'bob', 'carol'],
        items: [],
      },
    ]
    const balances = computeNetBalances(expenses, 'MARKET', context)
    // Exact share 3333.33…: bob and carol owe 3334 each (rounded up);
    // alice is credited 6668, not the exact 6666.67 — payer-favored surplus.
    expect(balances.get('bob')).toBe(-3_334n)
    expect(balances.get('carol')).toBe(-3_334n)
    expect(balances.get('alice')).toBe(6_668n)
    expect(sum(balances)).toBe(0n)
  })

  test('cross-currency uneven split rounds each share up exactly once', () => {
    const expenses: ExpenseInput[] = [
      {
        payerId: 'alice',
        amount: 1_000n,
        currency: 'JPY',
        marketRateSnapshot: '9.205',
        walletId: 'alice-jpy',
        participantIds: ['alice', 'bob', 'carol'],
        items: [],
      },
    ]
    const balances = computeNetBalances(expenses, 'MARKET', context)
    // Exact share 1000/3 JPY * 9.205 = 3068.33… KRW -> 3069 each.
    expect(balances.get('bob')).toBe(-3_069n)
    expect(balances.get('carol')).toBe(-3_069n)
    expect(balances.get('alice')).toBe(6_138n)
  })

  test('refund: negative shares round toward zero — payer still never loses', () => {
    const expenses: ExpenseInput[] = [
      {
        payerId: 'alice',
        amount: -1_000n,
        currency: 'JPY',
        marketRateSnapshot: '9.31',
        walletId: 'alice-jpy',
        participantIds: ['alice', 'bob', 'carol'],
        items: [],
      },
    ]
    const balances = computeNetBalances(expenses, 'AVG_COST', context)
    // Exact share -9310/3 = -3103.33…: toward zero -> -3103 back to each.
    expect(balances.get('bob')).toBe(3_103n)
    expect(balances.get('carol')).toBe(3_103n)
    expect(balances.get('alice')).toBe(-6_206n)
    expect(sum(balances)).toBe(0n)
  })

  const memberIds = ['alice', 'bob', 'carol', 'dave', 'eve']
  const expenseArb = fc.record({
    payerId: fc.constantFrom(...memberIds),
    amount: fc
      .bigInt({ min: -10_000_000n, max: 10_000_000n })
      .filter((a) => a !== 0n),
    currency: fc.constantFrom('JPY', 'USD', 'KRW'),
    snapshotTenths: fc.integer({ min: 1, max: 200_000 }),
    method: fc.constantFrom('CASH', 'CARD') as fc.Arbitrary<'CASH' | 'CARD'>,
    participants: fc
      .subarray(memberIds, { minLength: 1 })
      .map((ids) => [...ids]),
  })
  const toExpense = (raw: {
    payerId: string
    amount: bigint
    currency: string
    snapshotTenths: number
    method: 'CASH' | 'CARD'
    participants: string[]
  }): ExpenseInput => ({
    payerId: raw.payerId,
    amount: raw.amount,
    currency: raw.currency,
    marketRateSnapshot: (raw.snapshotTenths / 10).toFixed(1),
    // CASH resolves to the payer's own wallet (real for alice/bob, an
    // absent id for everyone else, which falls back exactly as before).
    walletId: raw.method === 'CASH' ? `${raw.payerId}-jpy` : null,
    participantIds: raw.participants,
    items: [],
  })

  test('property: balances always sum to zero', () => {
    fc.assert(
      fc.property(
        fc.array(expenseArb, { minLength: 1, maxLength: 20 }),
        (rawExpenses) => {
          const balances = computeNetBalances(
            rawExpenses.map(toExpense),
            'AVG_COST',
            context,
          )
          expect(sum(balances)).toBe(0n)
        },
      ),
    )
  })

  test('property: payer credited >= exact receivable, surplus bounded', () => {
    for (const mode of ['AVG_COST', 'MARKET'] as const) {
      fc.assert(
        fc.property(expenseArb, (raw) => {
          const expense = toExpense(raw)
          const balances = computeNetBalances([expense], mode, context)
          const credit = balances.get(expense.payerId) ?? 0n

          const { rate } = resolveRate(expense, mode, context)
          // Exact receivable = sum of non-payer exact shares * rate.
          let exact = ratio(0n, 1n)
          let consumers = 0n
          for (const [memberId, share] of allocateExactShares(expense)) {
            if (memberId === expense.payerId) continue
            consumers += 1n
            exact = addRatio(
              exact,
              ratio(share.num * rate.numerator, share.den * rate.denominator),
            )
          }
          // credit >= exact receivable (payer never receives less)…
          expect(credit * exact.den >= exact.num).toBe(true)
          // …and each consumer ceil adds strictly less than 1 minor unit,
          // so surplus < consumers. With the payer among the participants
          // (the normal case) consumers = participants - 1, which gives the
          // brief's bound "surplus <= participants - 1 per division event".
          if (consumers === 0n) {
            expect(credit).toBe(0n)
          } else {
            expect(credit * exact.den - exact.num < consumers * exact.den).toBe(
              true,
            )
          }
        }),
      )
    }
  })

  test('property: a payer outside the participants is credited at least the converted total', () => {
    fc.assert(
      fc.property(
        expenseArb.filter((raw) => !raw.participants.includes(raw.payerId)),
        (raw) => {
          const expense = toExpense(raw)
          const balances = computeNetBalances([expense], 'MARKET', context)
          const credit = balances.get(expense.payerId) ?? 0n
          const { rate } = resolveRate(expense, 'MARKET', context)
          // credit >= amount * rate exactly (payer credited >= paid).
          expect(
            credit * rate.denominator >= expense.amount * rate.numerator,
          ).toBe(true)
        },
      ),
    )
  })
})
