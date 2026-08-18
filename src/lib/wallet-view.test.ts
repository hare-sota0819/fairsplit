import { describe, expect, test } from 'vitest'
import {
  walletBalance,
  type ExchangeRecordInput,
  type WalletInfo,
} from '@/lib/settlement'
import {
  fundingRowsOf,
  walletSummaries,
  type WalletExpenseRow,
} from './wallet-view'

const wallets: WalletInfo[] = [
  {
    id: 'jpy-wallet',
    memberId: 'me',
    type: 'CASH',
    label: 'Cash',
    currency: 'JPY',
  },
  {
    id: 'twd-wallet',
    memberId: 'me',
    type: 'CASH',
    label: 'Cash',
    currency: 'TWD',
  },
]

const records: ExchangeRecordInput[] = [
  {
    walletId: 'jpy-wallet',
    amountPaid: 93_100n,
    amountReceived: 10_000n,
    currency: 'JPY',
  },
  {
    walletId: 'jpy-wallet',
    amountPaid: 90_300n,
    amountReceived: 10_000n,
    currency: 'JPY',
  },
  {
    walletId: 'twd-wallet',
    amountPaid: 150_000n,
    amountReceived: 10_000n,
    currency: 'TWD',
  },
]

const row = (patch: Partial<WalletExpenseRow>): WalletExpenseRow => ({
  walletId: 'jpy-wallet',
  amount: 1_000n,
  isWalletAdjustment: false,
  cancelledAt: null,
  ...patch,
})

describe('walletSummaries', () => {
  test('one summary per wallet, in wallets order', () => {
    const summaries = walletSummaries(wallets, records, [])
    expect(summaries.map((s) => s.currency)).toEqual(['JPY', 'TWD'])
    expect(summaries[0]).toEqual({
      walletId: 'jpy-wallet',
      label: 'Cash',
      type: 'CASH',
      currency: 'JPY',
      loaded: 20_000n,
      spent: 0n,
      adjustments: 0n,
      remaining: 20_000n,
      overdrawn: false,
      hasTopUps: true,
    })
  })

  test("this wallet's spending counts; other wallets and cancelled do not", () => {
    const expenses = [
      row({ amount: 3_000n }),
      row({ amount: 9_999n, walletId: null }),
      row({ amount: 9_999n, walletId: 'someone-elses-wallet' }),
      row({ amount: 9_999n, cancelledAt: new Date() }),
    ]
    const [jpy] = walletSummaries(wallets, records, expenses)
    expect(jpy.spent).toBe(3_000n)
    expect(jpy.remaining).toBe(17_000n)
  })

  test('refunds add back; adjustments are listed separately', () => {
    const expenses = [
      row({ amount: 5_000n }),
      row({ amount: -1_000n }),
      row({ amount: 400n, isWalletAdjustment: true }),
    ]
    const [jpy] = walletSummaries(wallets, records, expenses)
    expect(jpy.spent).toBe(4_000n)
    expect(jpy.adjustments).toBe(400n)
    expect(jpy.remaining).toBe(15_600n)
  })

  test('remaining matches the engine walletBalance over the same rows', () => {
    const expenses = [
      row({ amount: 5_000n }),
      row({ amount: -1_000n }),
      row({ amount: 400n, isWalletAdjustment: true }),
      row({ amount: 2_500n, walletId: 'twd-wallet' }),
    ]
    const summaries = walletSummaries(wallets, records, expenses)
    for (const summary of summaries) {
      expect(summary.remaining).toBe(
        walletBalance(
          summary.walletId,
          records,
          expenses
            .filter((e) => e.cancelledAt === null)
            .map((e) => ({ walletId: e.walletId, amount: e.amount })),
        ).balance,
      )
    }
  })
})

describe('fundingRowsOf', () => {
  test('a wallet is drawn down by its PORTION, not the whole receipt', () => {
    // The reported case: an 82,000 JPY dinner, 50,000 of it off a wallet
    // holding exactly that. Charging the wallet the full 82,000 is what made
    // it read "32,000 over" (docs/BUGS.md 2026-08-04).
    const rows = fundingRowsOf([
      {
        isWalletAdjustment: false,
        cancelledAt: null,
        funding: [
          { walletId: 'jpy-wallet', amount: 50_000n },
          { walletId: null, amount: 32_000n },
        ],
      },
    ])
    const summary = walletSummaries(
      [wallets[0]],
      [
        {
          walletId: 'jpy-wallet',
          amountPaid: 465_000n,
          amountReceived: 50_000n,
          currency: 'JPY',
        },
      ],
      rows,
    )[0]
    expect(summary.spent).toBe(50_000n)
    expect(summary.remaining).toBe(0n)
    expect(summary.overdrawn).toBe(false)
  })

  test('the expense-level flags ride along on every portion', () => {
    const at = new Date()
    expect(
      fundingRowsOf([
        {
          isWalletAdjustment: true,
          cancelledAt: at,
          funding: [
            { walletId: 'jpy-wallet', amount: 1n },
            { walletId: 'twd-wallet', amount: 2n },
          ],
        },
      ]),
    ).toEqual([
      {
        walletId: 'jpy-wallet',
        amount: 1n,
        isWalletAdjustment: true,
        cancelledAt: at,
      },
      {
        walletId: 'twd-wallet',
        amount: 2n,
        isWalletAdjustment: true,
        cancelledAt: at,
      },
    ])
  })
})
