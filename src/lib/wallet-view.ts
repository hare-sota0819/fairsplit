import type { ExchangeRecordInput, WalletInfo } from '@/lib/settlement'
import { walletBalance } from '@/lib/settlement'

/**
 * One PORTION of an expense, as far as a wallet balance is concerned. A
 * receipt paid half from a card and half in cash draws down only the half
 * that came off the card.
 */
export interface WalletExpenseRow {
  walletId: string | null
  amount: bigint
  isWalletAdjustment: boolean
  cancelledAt: Date | null
}

/**
 * What to `select` when loading funding portions for a wallet balance, and
 * the mapper that flattens the result. Every wallet figure in the app comes
 * through this pair, so none of them can be computed from expense totals by
 * accident — which is exactly the mistake that made a wallet read "32,000
 * over" (docs/BUGS.md 2026-08-04).
 */
export const WALLET_SPEND_SELECT = {
  walletId: true,
  amount: true,
  expense: { select: { isWalletAdjustment: true, cancelledAt: true } },
} as const

/** The same flattening, for callers that already loaded whole expense rows. */
export function fundingRowsOf(
  expenses: {
    isWalletAdjustment: boolean
    cancelledAt: Date | null
    funding: { walletId: string | null; amount: bigint }[]
  }[],
): WalletExpenseRow[] {
  return expenses.flatMap((expense) =>
    expense.funding.map((portion) => ({
      walletId: portion.walletId,
      amount: portion.amount,
      isWalletAdjustment: expense.isWalletAdjustment,
      cancelledAt: expense.cancelledAt,
    })),
  )
}

export function toWalletExpenseRows(
  portions: {
    walletId: string | null
    amount: bigint
    expense: { isWalletAdjustment: boolean; cancelledAt: Date | null }
  }[],
): WalletExpenseRow[] {
  return portions.map((portion) => ({
    walletId: portion.walletId,
    amount: portion.amount,
    isWalletAdjustment: portion.expense.isWalletAdjustment,
    cancelledAt: portion.expense.cancelledAt,
  }))
}

export interface WalletSummary {
  walletId: string
  label: string
  type: WalletInfo['type']
  currency: string
  /** Sum of top-ups onto this wallet. */
  loaded: bigint
  /** Spending funded from it (personal included, adjustments excluded). */
  spent: bigint
  /** Its wallet-adjustment expenses (signed). */
  adjustments: bigint
  /** loaded - spent - adjustments; equals the engine's walletBalance. */
  remaining: bigint
  /** Spent past zero — allowed, but it means a top-up is probably missing. */
  overdrawn: boolean
  /** No top-ups recorded: no average cost exists, so rates fall back. */
  hasTopUps: boolean
}

/**
 * Per-wallet breakdown, with spending and "count your wallet" corrections
 * listed separately. Same inclusion rule as the engine's walletBalance
 * (personal INCLUDED, cancelled excluded, refunds add back) — only the
 * presentation split between spending and adjustments is new here.
 */
export function walletSummaries(
  wallets: WalletInfo[],
  records: ExchangeRecordInput[],
  expenses: WalletExpenseRow[],
): WalletSummary[] {
  return wallets.map((wallet) => {
    const live = expenses.filter((e) => e.cancelledAt === null)
    let spent = 0n
    let adjustments = 0n
    for (const expense of live) {
      if (expense.walletId !== wallet.id) continue
      if (expense.isWalletAdjustment) {
        adjustments += expense.amount
      } else {
        spent += expense.amount
      }
    }
    const { balance, overdrawn, hasTopUps } = walletBalance(
      wallet.id,
      records,
      live,
    )
    return {
      walletId: wallet.id,
      label: wallet.label,
      type: wallet.type,
      currency: wallet.currency,
      loaded: balance + spent + adjustments,
      spent,
      adjustments,
      remaining: balance,
      overdrawn,
      hasTopUps,
    }
  })
}
