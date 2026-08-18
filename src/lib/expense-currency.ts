import type { FundingSource } from './schemas/expense'

/** A recent expense is one entered within this window of "now". */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Whether `at` is close enough to `now` — within a day, either direction —
 * to still be trusted as "the last thing that happened". Only
 * `defaultExpenseCurrency` uses this: currency SHOULD go stale, because a
 * trip moves countries and an old expense stops being good evidence of what
 * currency you are spending in today.
 *
 * Payer identity does not use this window either, but for the opposite
 * reason: it is not guessed from history at all. The person entering an
 * expense is the person holding the receipt, so the form defaults to them.
 */
function isWithinRecentWindow(at: Date, now: Date): boolean {
  return Math.abs(now.getTime() - at.getTime()) < RECENT_WINDOW_MS
}

/**
 * Which currency the expense form should propose.
 *
 * The last expense wins only while it is fresh. Following it forever trails
 * the past on a multi-country trip: ten Tokyo expenses then a flight to
 * Taipei would still suggest JPY for the first Taipei coffee. Within a day it
 * is still the right guess — that is the same-city case.
 */
export function defaultExpenseCurrency(input: {
  recent: { currency: string; at: Date } | null
  now: Date
  tripCurrency: string | null
  settlementCurrency: string
}): string {
  const { recent, now, tripCurrency, settlementCurrency } = input
  if (recent !== null && isWithinRecentWindow(recent.at, now)) {
    return recent.currency
  }
  return tripCurrency ?? settlementCurrency
}

/**
 * Tolerance for clock skew between the device that entered an expense and
 * this server — NOT a staleness window. `lastFundingByPayer` distrusts a
 * timestamp only when it is meaningfully in the future (e.g. a fat-fingered
 * 2027 date, which would otherwise pin the default until that date actually
 * arrives); an old expense is still the best evidence of how a member tends
 * to pay, so there is no upper bound on age.
 */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

const isMeaningfullyFuture = (at: Date, now: Date): boolean =>
  at.getTime() - now.getTime() > FUTURE_TOLERANCE_MS

/**
 * Each payer's most recently used funding source, given expenses ordered
 * newest-first by timestamp. Age never disqualifies an expense; only a
 * timestamp meaningfully in the future does.
 */
export function lastFundingByPayer(
  recentExpenses: { payerId: string; walletId: string | null; timestamp: Date }[],
  now: Date,
): Record<string, FundingSource> {
  const result: Record<string, FundingSource> = {}
  for (const expense of recentExpenses) {
    if (isMeaningfullyFuture(expense.timestamp, now)) continue
    result[expense.payerId] ??= expense.walletId
      ? { kind: 'WALLET', walletId: expense.walletId }
      : { kind: 'PAY_AS_YOU_GO' }
  }
  return result
}
