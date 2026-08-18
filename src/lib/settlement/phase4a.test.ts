import { describe, expect, test } from 'vitest'
import { computeNetBalances, consumerDebits } from './balances'
import { consumedShares } from './consumed'
import { convertExpense, resolveRate } from './convert'
import {
  allocateExactShares,
  assignedQuantity,
  assignmentStatus,
  explainShares,
  itemsTotal,
  lineTotal,
  validateReceipt,
} from './items'
import { addRatio } from './money'
import { walletBalance } from './wallet'
import type {
  ExpenseInput,
  ExpenseItemInput,
  SettlementContext,
  WalletInfo,
} from './types'

/*
 * Phase 4A regressions. Two defects and one new capability:
 *
 *  - line totals ignored quantity everywhere (unit price was summed as if it
 *    were the line total),
 *  - "cash vs card" priced a travel card at the market rate even though the
 *    money on it was exchanged in advance,
 *  - per-person quantity within an item replaces "split into units".
 */

const wallet = (over: Partial<WalletInfo> & { id: string }): WalletInfo => ({
  memberId: 'alice',
  type: 'CASH',
  label: 'Cash',
  currency: 'JPY',
  ...over,
})

// Alice holds two JPY pots at DIFFERENT costs — the case a member-scoped
// average could not represent at all.
const ALICE_CASH = wallet({ id: 'alice-cash', label: 'Cash' })
const ALICE_CARD = wallet({
  id: 'alice-travel',
  type: 'TRAVEL_CARD',
  label: 'Travel Wallet',
})
const ALICE_EMPTY = wallet({
  id: 'alice-new',
  type: 'OTHER_PREPAID',
  label: 'Untouched pot',
})

const context: SettlementContext = {
  settlementCurrency: 'KRW',
  walletsById: new Map([
    [ALICE_CASH.id, ALICE_CASH],
    [ALICE_CARD.id, ALICE_CARD],
    [ALICE_EMPTY.id, ALICE_EMPTY],
  ]),
  recordsByWallet: new Map([
    // 100,000 JPY cost 950,000 KRW -> 9.50 KRW/JPY.
    [
      ALICE_CASH.id,
      [
        {
          walletId: ALICE_CASH.id,
          amountPaid: 950_000n,
          amountReceived: 100_000n,
          currency: 'JPY',
        },
      ],
    ],
    // 100,000 JPY cost 913_000 KRW -> 9.13 KRW/JPY ("100 JPY = 913 KRW").
    [
      ALICE_CARD.id,
      [
        {
          walletId: ALICE_CARD.id,
          amountPaid: 913_000n,
          amountReceived: 100_000n,
          currency: 'JPY',
        },
      ],
    ],
  ]),
}

const expense = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  payerId: 'alice',
  amount: 10_000n,
  currency: 'JPY',
  marketRateSnapshot: '9.20',
  walletId: ALICE_CASH.id,
  participantIds: ['alice', 'bob'],
  items: [],
  ...over,
})

const item = (
  over: Partial<ExpenseItemInput> & { unitAmount: bigint },
): ExpenseItemInput => ({
  name: 'line',
  quantity: 1,
  assignees: [],
  ...over,
})

const shareOf = (
  shares: Map<string, { num: bigint; den: bigint }>,
  memberId: string,
): { num: bigint; den: bigint } => shares.get(memberId) ?? { num: 0n, den: 1n }

const exact = (share: { num: bigint; den: bigint }): bigint => {
  expect(share.num % share.den).toBe(0n)
  return share.num / share.den
}

// ------------------------------------------------------ unit price x qty --

describe('line total is unit price x quantity', () => {
  test('lineTotal multiplies', () => {
    expect(lineTotal({ unitAmount: 1_500n, quantity: 3 })).toBe(4_500n)
  })

  test('the receipt check no longer reports a false discrepancy', () => {
    // THE BUG: 1,500 x 3 was summed as 1,500, so a 4,500 receipt "differed
    // by 3,000".
    const items = [item({ unitAmount: 1_500n, quantity: 3 })]
    expect(itemsTotal(items)).toBe(4_500n)
    expect(validateReceipt(items, 4_500n)).toEqual({
      ok: true,
      discrepancy: 0n,
    })
    expect(validateReceipt(items, 1_500n)).toEqual({
      ok: false,
      discrepancy: 3_000n,
    })
  })

  test('quantity reaches the allocation, not just the display', () => {
    // 1,500 x 3 assigned entirely to bob: bob owes 4,500, not 1,500.
    const shares = allocateExactShares(
      expense({
        amount: 4_500n,
        items: [
          item({
            unitAmount: 1_500n,
            quantity: 3,
            assignees: [{ memberId: 'bob', quantity: 3 }],
          }),
        ],
      }),
    )
    expect(exact(shareOf(shares, 'bob'))).toBe(4_500n)
    expect(shares.has('alice')).toBe(false)
  })

  test('a mixed receipt sums by line total', () => {
    const items = [
      item({ unitAmount: 1_500n, quantity: 3 }),
      item({ unitAmount: 800n, quantity: 2 }),
      item({ unitAmount: 300n }),
    ]
    expect(itemsTotal(items)).toBe(6_400n)
  })
})

// ------------------------------------------- per-person quantity assignment --

describe('per-person quantity within an item', () => {
  test('quantity 1 ticked by three people is the equal three-way split', () => {
    // The "we shared one dish" case: the sum of ticks (3) exceeding the line
    // quantity (1) is NOT an error, it is what a checkbox means.
    const line = item({
      unitAmount: 900n,
      quantity: 1,
      assignees: [
        { memberId: 'alice', quantity: 1 },
        { memberId: 'bob', quantity: 1 },
        { memberId: 'carol', quantity: 1 },
      ],
    })
    expect(assignmentStatus(line)).toBe('exact')
    const shares = allocateExactShares(
      expense({
        amount: 900n,
        participantIds: ['alice', 'bob', 'carol'],
        items: [line],
      }),
    )
    for (const id of ['alice', 'bob', 'carol']) {
      expect(shareOf(shares, id)).toEqual({ num: 300n, den: 1n })
    }
  })

  test('quantity 3 taken 1/1/1 charges each exactly one unit', () => {
    const line = item({
      unitAmount: 1_500n,
      quantity: 3,
      assignees: [
        { memberId: 'alice', quantity: 1 },
        { memberId: 'bob', quantity: 1 },
        { memberId: 'carol', quantity: 1 },
      ],
    })
    expect(assignedQuantity(line)).toBe(3)
    expect(assignmentStatus(line)).toBe('exact')
    const shares = allocateExactShares(
      expense({
        amount: 4_500n,
        participantIds: ['alice', 'bob', 'carol'],
        items: [line],
      }),
    )
    for (const id of ['alice', 'bob', 'carol']) {
      expect(exact(shareOf(shares, id))).toBe(1_500n)
    }
  })

  test('quantity 3 taken 2/1 splits two-thirds / one-third', () => {
    const shares = allocateExactShares(
      expense({
        amount: 4_500n,
        items: [
          item({
            unitAmount: 1_500n,
            quantity: 3,
            assignees: [
              { memberId: 'alice', quantity: 2 },
              { memberId: 'bob', quantity: 1 },
            ],
          }),
        ],
      }),
    )
    expect(exact(shareOf(shares, 'alice'))).toBe(3_000n)
    expect(exact(shareOf(shares, 'bob'))).toBe(1_500n)
  })

  test('partial assignment charges the takers and pools the rest', () => {
    // 3 beers, only 2 claimed: the claimants pay for exactly what they took
    // and the third beer joins the unassigned pool, which then redistributes
    // in proportion to what each person consumed.
    const line = item({
      unitAmount: 1_500n,
      quantity: 3,
      assignees: [
        { memberId: 'alice', quantity: 1 },
        { memberId: 'bob', quantity: 1 },
      ],
    })
    expect(assignmentStatus(line)).toBe('partial')
    const shares = allocateExactShares(
      expense({ amount: 4_500n, items: [line] }),
    )
    // Both consumed 1,500 of the 3,000 claimed, so the loose 1,500 splits
    // evenly: 2,250 each.
    expect(exact(shareOf(shares, 'alice'))).toBe(2_250n)
    expect(exact(shareOf(shares, 'bob'))).toBe(2_250n)
  })

  test('over-assignment never charges more than the line was worth', () => {
    // The UI blocks this; if one slips through, the line total is still the
    // only thing distributed.
    const line = item({
      unitAmount: 1_500n,
      quantity: 3,
      assignees: [
        { memberId: 'alice', quantity: 3 },
        { memberId: 'bob', quantity: 1 },
      ],
    })
    expect(assignmentStatus(line)).toBe('over')
    const shares = allocateExactShares(
      expense({ amount: 4_500n, items: [line] }),
    )
    const total = [...shares.values()].reduce(
      (sum, s) => sum + s.num / s.den,
      0n,
    )
    expect(total).toBe(4_500n)
    expect(exact(shareOf(shares, 'alice'))).toBe(3_375n)
    expect(exact(shareOf(shares, 'bob'))).toBe(1_125n)
  })

  test('an unassigned line still distributes proportionally to consumption', () => {
    const shares = allocateExactShares(
      expense({
        amount: 5_500n,
        items: [
          item({
            unitAmount: 3_000n,
            assignees: [{ memberId: 'alice', quantity: 1 }],
          }),
          item({
            unitAmount: 1_500n,
            assignees: [{ memberId: 'bob', quantity: 1 }],
          }),
          item({ unitAmount: 1_000n, name: 'service charge' }),
        ],
      }),
    )
    // 1,000 split 3,000:1,500 -> 666.66 / 333.33 exactly, as rationals.
    expect(shareOf(shares, 'alice')).toEqual({ num: 11_000n, den: 3n })
    expect(shareOf(shares, 'bob')).toEqual({ num: 5_500n, den: 3n })
  })

  test('shares always sum to the expense total', () => {
    const shares = allocateExactShares(
      expense({
        amount: 10_000n,
        participantIds: ['alice', 'bob', 'carol'],
        items: [
          item({
            unitAmount: 1_500n,
            quantity: 3,
            assignees: [
              { memberId: 'alice', quantity: 2 },
              { memberId: 'bob', quantity: 1 },
            ],
          }),
          item({ unitAmount: 900n, quantity: 2 }),
        ],
      }),
    )
    const sum = [...shares.values()].reduce(
      (acc, s) => ({
        num: acc.num * s.den + s.num * acc.den,
        den: acc.den * s.den,
      }),
      { num: 0n, den: 1n },
    )
    expect(sum.num / sum.den).toBe(10_000n)
    expect(sum.num % sum.den).toBe(0n)
  })
})

// ------------------------------------------------------------ derivation --

describe('the shown working matches the number it explains', () => {
  const itemised = expense({
    amount: 10_000n,
    participantIds: ['alice', 'bob', 'carol'],
    items: [
      item({
        name: 'beer',
        unitAmount: 1_500n,
        quantity: 3,
        assignees: [
          { memberId: 'alice', quantity: 1 },
          { memberId: 'bob', quantity: 1 },
          { memberId: 'carol', quantity: 1 },
        ],
      }),
      item({
        name: 'sashimi',
        unitAmount: 3_200n,
        assignees: [{ memberId: 'bob', quantity: 1 }],
      }),
      item({ name: 'service charge', unitAmount: 800n }),
    ],
  })

  test('every explanation totals its allocated share', () => {
    const allocated = allocateExactShares(itemised)
    for (const [memberId, explanation] of explainShares(itemised)) {
      const fromLines = explanation.lines.reduce(
        (sum, line) => addRatio(sum, line.share),
        { num: 0n, den: 1n },
      )
      expect(addRatio(fromLines, explanation.unassigned)).toEqual(
        explanation.total,
      )
      expect(explanation.total).toEqual(allocated.get(memberId))
    }
  })

  test('the working names the lines the member actually had', () => {
    const bob = explainShares(itemised).get('bob')!
    expect(bob.lines.map((line) => line.name)).toEqual(['beer', 'sashimi'])
    expect(bob.lines[0]).toMatchObject({ units: 1, quantity: 3, claimants: 3 })
    expect(bob.unassigned.num).toBeGreaterThan(0n)
  })

  test('an even split says so instead of listing lines', () => {
    const explanation = explainShares(
      expense({ amount: 9_000n, participantIds: ['alice', 'bob', 'carol'] }),
    ).get('carol')!
    expect(explanation.evenSplitOf).toEqual({ total: 9_000n, among: 3 })
    expect(explanation.lines).toEqual([])
    expect(explanation.total).toEqual({ num: 3_000n, den: 1n })
  })
})

// -------------------------------------------------------- wallet-scoped rates --

describe('wallet-scoped rates', () => {
  test('two wallets of the same member convert at their own cost', () => {
    const fromCash = convertExpense(
      expense({ walletId: ALICE_CASH.id }),
      'AVG_COST',
      context,
    )
    const fromCard = convertExpense(
      expense({ walletId: ALICE_CARD.id }),
      'AVG_COST',
      context,
    )
    expect(fromCash).toEqual({
      amount: 95_000n,
      currency: 'KRW',
      source: 'WALLET_AVG_COST',
      walletLabel: 'Cash',
    })
    expect(fromCard).toEqual({
      amount: 91_300n,
      currency: 'KRW',
      source: 'WALLET_AVG_COST',
      walletLabel: 'Travel Wallet',
    })
  })

  test('a wallet with no top-ups falls back to the market rate, flagged', () => {
    expect(
      convertExpense(
        expense({ walletId: ALICE_EMPTY.id }),
        'AVG_COST',
        context,
      ),
    ).toEqual({
      amount: 92_000n,
      currency: 'KRW',
      source: 'MARKET_FALLBACK',
      walletLabel: 'Untouched pot',
    })
  })

  test('pay-as-you-go uses the market snapshot', () => {
    expect(
      convertExpense(expense({ walletId: null }), 'AVG_COST', context),
    ).toEqual({
      amount: 92_000n,
      currency: 'KRW',
      source: 'MARKET_SNAPSHOT',
    })
  })

  test('pay-as-you-go prefers what the bank actually billed', () => {
    expect(
      convertExpense(
        expense({ walletId: null, actualChargedAmount: 90_500n }),
        'AVG_COST',
        context,
      ),
    ).toEqual({
      amount: 90_500n,
      currency: 'KRW',
      source: 'ACTUAL_CHARGED',
    })
  })

  test('a prepaid wallet ignores actualCharged — the money was already bought', () => {
    expect(
      resolveRate(
        expense({ walletId: ALICE_CARD.id, actualChargedAmount: 90_500n }),
        'AVG_COST',
        context,
      ).source,
    ).toBe('WALLET_AVG_COST')
  })

  test('MARKET mode ignores the wallet entirely', () => {
    for (const walletId of [ALICE_CASH.id, ALICE_CARD.id, null]) {
      expect(convertExpense(expense({ walletId }), 'MARKET', context)).toEqual({
        amount: 92_000n,
        currency: 'KRW',
        source: 'MARKET_SNAPSHOT',
      })
    }
  })

  test('a domestic expense converts at identity whatever it was paid from', () => {
    expect(
      convertExpense(
        expense({ amount: 42_000n, currency: 'KRW', walletId: ALICE_CASH.id }),
        'AVG_COST',
        context,
      ).amount,
    ).toBe(42_000n)
  })
})

// -------------------------------------------------------------- balances --

describe('wallet balances', () => {
  const spend = [
    { walletId: ALICE_CASH.id, amount: 30_000n },
    { walletId: ALICE_CARD.id, amount: 20_000n },
    { walletId: null, amount: 99_000n },
  ]
  const records = [...context.recordsByWallet.values()].flat()

  test('draws down only the wallet it was funded from', () => {
    expect(walletBalance(ALICE_CASH.id, records, spend)).toEqual({
      balance: 70_000n,
      overdrawn: false,
      hasTopUps: true,
    })
    expect(walletBalance(ALICE_CARD.id, records, spend)).toEqual({
      balance: 80_000n,
      overdrawn: false,
      hasTopUps: true,
    })
  })

  test('overspending is allowed but flagged', () => {
    const overspent = [{ walletId: ALICE_CASH.id, amount: 130_000n }]
    expect(walletBalance(ALICE_CASH.id, records, overspent)).toEqual({
      balance: -30_000n,
      overdrawn: true,
      hasTopUps: true,
    })
  })

  test('a wallet with no top-ups reports it rather than a confident zero', () => {
    expect(walletBalance(ALICE_EMPTY.id, records, [])).toEqual({
      balance: 0n,
      overdrawn: false,
      hasTopUps: false,
    })
  })

  test('a refund funded from a wallet puts money back', () => {
    expect(
      walletBalance(ALICE_CASH.id, records, [
        { walletId: ALICE_CASH.id, amount: -5_000n },
      ]).balance,
    ).toBe(105_000n)
  })
})

// ------------------------------------------------- payer-favored rounding --

describe('payer-favored rounding survives Phase 4A', () => {
  test('the payer is never credited less than the exact receivable', () => {
    // 10,000 JPY at 9.13, three ways: 3,333.33 JPY each -> 30,433.33 KRW,
    // each non-payer rounded UP to 30,434.
    const shared = expense({
      walletId: ALICE_CARD.id,
      participantIds: ['alice', 'bob', 'carol'],
    })
    const debits = consumerDebits(shared, 'AVG_COST', context)
    expect(debits.get('bob')).toBe(30_434n)
    expect(debits.get('carol')).toBe(30_434n)
    const credited = [...debits.values()].reduce((a, b) => a + b, 0n)
    const total = convertExpense(shared, 'AVG_COST', context).amount
    const aliceOwn = consumedShares(shared, 'AVG_COST', context).get('alice')!
    expect(credited + aliceOwn).toBeGreaterThanOrEqual(total)
  })

  test('quantity-weighted shares still round in the payer favour', () => {
    // 1,000 JPY unit x 3, alice 2 / bob 1, at 9.13: bob's exact share is
    // 1,000 JPY -> 9,130 KRW exactly; make it uneven instead.
    const shares = consumerDebits(
      expense({
        amount: 1_000n,
        walletId: ALICE_CARD.id,
        items: [
          item({
            unitAmount: 1_000n,
            quantity: 1,
            assignees: [
              { memberId: 'alice', quantity: 1 },
              { memberId: 'bob', quantity: 1 },
              { memberId: 'carol', quantity: 1 },
            ],
          }),
        ],
        participantIds: ['alice', 'bob', 'carol'],
      }),
      'AVG_COST',
      context,
    )
    // 1,000/3 JPY = 333.33 -> x 9.13 = 3,043.33 KRW -> up -> 3,044.
    expect(shares.get('bob')).toBe(3_044n)
    expect(shares.get('carol')).toBe(3_044n)
  })

  test('balances stay zero-sum across mixed funding sources', () => {
    const balances = computeNetBalances(
      [
        expense({ walletId: ALICE_CASH.id, amount: 7_777n }),
        expense({
          payerId: 'bob',
          walletId: null,
          amount: 3_333n,
          actualChargedAmount: 30_100n,
        }),
        expense({ walletId: ALICE_CARD.id, amount: -1_111n }),
      ],
      'AVG_COST',
      context,
    )
    expect([...balances.values()].reduce((a, b) => a + b, 0n)).toBe(0n)
  })
})
