import { describe, expect, test } from 'vitest'
import { computeNetBalances, expenseNet } from './balances'
import { pairwiseContribution, pairwiseNetFor } from './pairwise'
import type { ExpenseInput, SettlementContext } from './types'

/**
 * A receipt one person could not cover alone.
 *
 * The wizard already let an expense name several funding portions, but every
 * one of them belonged to the payer: `Expense.payerId` was the only member the
 * money could have come from. "My card ran out so Bob paid the rest" had
 * nowhere to live, and the group's usual answer — enter it as a second expense
 * — makes one dinner look like two and splits the receipt's items wrongly.
 *
 * A portion may now name its own funder. What must hold, whatever the mix:
 *   - balances stay zero-sum;
 *   - each funder is credited what they actually put in, at their own rate;
 *   - a single-funder expense behaves exactly as it did before.
 */

const context: SettlementContext = {
  settlementCurrency: 'KRW',
  walletsById: new Map(),
  recordsByWallet: new Map(),
}

/** ¥30,000 dinner, three ways, at a flat 100 JPY = 900 KRW (₩270,000). */
const dinner = (funding: ExpenseInput['funding']): ExpenseInput => ({
  payerId: 'alice',
  amount: 30_000n,
  currency: 'JPY',
  marketRateSnapshot: '9',
  participantIds: ['alice', 'bob', 'carol'],
  items: [],
  funding,
})

describe('a portion funded by someone other than the payer', () => {
  test('credits each funder what they put in, and stays zero-sum', () => {
    // Alice fronts ¥20,000, Bob the last ¥10,000: ₩180,000 and ₩90,000.
    const balances = computeNetBalances(
      [
        dinner([
          { amount: 20_000n, walletId: null },
          { amount: 10_000n, walletId: null, memberId: 'bob' },
        ]),
      ],
      'MARKET',
      context,
    )
    // Each of the three consumed ₩90,000 of a ₩270,000 dinner.
    // Alice: paid 180,000, ate 90,000 -> +90,000.
    // Bob:   paid  90,000, ate 90,000 ->       0.
    // Carol: paid       0, ate 90,000 -> -90,000.
    expect(balances.get('alice')).toBe(90_000n)
    expect(balances.get('bob') ?? 0n).toBe(0n)
    expect(balances.get('carol')).toBe(-90_000n)
    expect([...balances.values()].reduce((a, b) => a + b, 0n)).toBe(0n)
  })

  test('a funder who did not eat is owed the whole of what they put in', () => {
    const expense: ExpenseInput = {
      ...dinner([
        { amount: 15_000n, walletId: null },
        { amount: 15_000n, walletId: null, memberId: 'dave' },
      ]),
      // Dave paid half and went home.
      participantIds: ['alice', 'bob', 'carol'],
    }
    const balances = computeNetBalances([expense], 'MARKET', context)
    expect(balances.get('dave')).toBe(135_000n)
    expect([...balances.values()].reduce((a, b) => a + b, 0n)).toBe(0n)
  })

  test('an unnamed portion still belongs to the payer', () => {
    // The shape every expense had before this existed, and still the shape
    // the DB stores for one: omitting memberId must not change a figure.
    const named = computeNetBalances(
      [
        dinner([
          { amount: 20_000n, walletId: null, memberId: 'alice' },
          { amount: 10_000n, walletId: null, memberId: 'alice' },
        ]),
      ],
      'MARKET',
      context,
    )
    const unnamed = computeNetBalances(
      [
        dinner([
          { amount: 20_000n, walletId: null },
          { amount: 10_000n, walletId: null },
        ]),
      ],
      'MARKET',
      context,
    )
    expect([...named]).toStrictEqual([...unnamed])
    expect(named.get('alice')).toBe(180_000n)
  })

  test('the rounding residual still lands on the payer, not on a co-funder', () => {
    // ¥30,001 over three at 100 JPY = 907 KRW does not divide. The two
    // consumers round UP to ₩90,704 each and the payer absorbs what is left
    // of the ₩272,110 the receipt actually cost — the rule the whole engine
    // is built on (README: the payer must never receive less than they paid).
    // Bob's ₩90,700 portion leaves him ₩4 short of his own share, and that
    // ₩4 is his, not something the co-funding quietly moves onto him.
    const odd: ExpenseInput = {
      ...dinner([
        { amount: 20_001n, walletId: null },
        { amount: 10_000n, walletId: null, memberId: 'bob' },
      ]),
      amount: 30_001n,
      marketRateSnapshot: '9.07',
    }
    const balances = computeNetBalances([odd], 'MARKET', context)
    expect([...balances.values()].reduce((a, b) => a + b, 0n)).toBe(0n)
    expect(balances.get('carol')).toBe(-90_704n)
    expect(balances.get('bob')).toBe(-4n)
    expect(balances.get('alice')).toBe(90_708n)
  })

  test('expenseNet omits members the expense does not touch', () => {
    const net = expenseNet(
      dinner([
        { amount: 20_000n, walletId: null },
        { amount: 10_000n, walletId: null, memberId: 'bob' },
      ]),
      'MARKET',
      context,
    )
    expect(net.has('bob')).toBe(false)
    expect(net.has('dave')).toBe(false)
  })
})

describe('who owes whom when two people fronted one receipt', () => {
  const expense = dinner([
    { amount: 20_000n, walletId: null },
    { amount: 10_000n, walletId: null, memberId: 'bob' },
  ])

  test('the only debtor owes the only creditor', () => {
    // Bob came out even, so he is neither owed nor owing: Carol's ₩90,000
    // goes to Alice, and nothing sits between Carol and Bob.
    expect(pairwiseContribution('carol', 'alice', expense, 'MARKET', context)).toBe(
      90_000n,
    )
    expect(pairwiseContribution('carol', 'bob', expense, 'MARKET', context)).toBe(
      0n,
    )
    expect(pairwiseContribution('alice', 'carol', expense, 'MARKET', context)).toBe(
      -90_000n,
    )
  })

  test('a member’s pairwise row sums to minus their net balance', () => {
    // The invariant the status screen relies on: per-expense rows can never
    // disagree with the total printed above them.
    const expenses = [
      expense,
      dinner([
        { amount: 6_000n, walletId: null, memberId: 'carol' },
        { amount: 24_000n, walletId: null, memberId: 'bob' },
      ]),
    ]
    const balances = computeNetBalances(expenses, 'MARKET', context)
    for (const member of ['alice', 'bob', 'carol']) {
      const row = [...pairwiseNetFor(member, expenses, 'MARKET', context)]
      const sum = row.reduce((total, [, amount]) => total + amount, 0n)
      expect(sum).toBe(-(balances.get(member) ?? 0n))
    }
  })

  test('one side’s view of the other is exactly the other’s view negated', () => {
    const expenses = [
      expense,
      dinner([
        { amount: 6_000n, walletId: null, memberId: 'carol' },
        { amount: 24_000n, walletId: null, memberId: 'bob' },
      ]),
    ]
    for (const [a, b] of [
      ['alice', 'bob'],
      ['alice', 'carol'],
      ['bob', 'carol'],
    ] as const) {
      const forward = pairwiseNetFor(a, expenses, 'MARKET', context).get(b) ?? 0n
      const back = pairwiseNetFor(b, expenses, 'MARKET', context).get(a) ?? 0n
      expect(forward).toBe(-back)
    }
  })
})
