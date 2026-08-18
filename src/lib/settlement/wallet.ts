import type { ExchangeRecordInput, WalletId } from './types'

/** An expense as far as a wallet balance is concerned. */
export interface WalletSpendInput {
  /** Funding source: the wallet drawn down, or null for pay-as-you-go. */
  walletId: WalletId | null
  /** Amount in the wallet's currency minor units. */
  amount: bigint
}

export interface WalletBalance {
  /** Loaded minus spent, in the wallet's currency minor units. */
  balance: bigint
  /**
   * Spent more than was ever loaded. Never blocked — people forget to log a
   * top-up far more often than they overspend — but always surfaced, because
   * a negative wallet means the recorded history is incomplete.
   */
  overdrawn: boolean
  /** No top-ups recorded: there is no average cost, so rates fall back. */
  hasTopUps: boolean
}

/**
 * What is left on one wallet: everything loaded onto it minus every expense
 * funded from it. Personal expenses count (the money really did leave the
 * wallet); cancelled expenses must be filtered out by the caller. Negative
 * expenses (refunds) add value back.
 */
export function walletBalance(
  walletId: WalletId,
  records: ExchangeRecordInput[],
  spend: WalletSpendInput[],
): WalletBalance {
  let loaded = 0n
  let hasTopUps = false
  for (const record of records) {
    if (record.walletId === walletId) {
      loaded += record.amountReceived
      hasTopUps = true
    }
  }
  let balance = loaded
  for (const expense of spend) {
    if (expense.walletId === walletId) {
      balance -= expense.amount
    }
  }
  return { balance, overdrawn: balance < 0n, hasTopUps }
}

/**
 * Counted-vs-computed wallet correction: positive = money is missing,
 * record it as a personal expense of this amount funded from the wallet;
 * negative = surplus, record a negative one. Routing the diff through an
 * expense keeps "My spending" and the wallet mutually consistent.
 */
export function walletAdjustmentAmount(
  computed: bigint,
  counted: bigint,
): bigint {
  return computed - counted
}
