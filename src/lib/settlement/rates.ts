import type {
  ExchangeRecordInput,
  Rate,
  RateResult,
  SettlementContext,
  WalletId,
} from './types'

/**
 * The average cost of the money in ONE wallet: the exact rational
 * sum(amountPaid) / sum(amountReceived) over that wallet's top-ups, in minor
 * units (settlement minor per foreign minor).
 *
 * Wallet-scoped rather than member-scoped on purpose (Phase 4A): a member
 * who holds cash exchanged at one rate and a travel card loaded at another
 * has two different costs, and averaging them across the member would
 * misprice both.
 *
 * With no top-ups the market rate is used instead and flagged.
 */
export function computeAvgRate(
  records: ExchangeRecordInput[],
  marketRate: Rate,
): RateResult {
  if (records.length === 0) {
    return { rate: marketRate, usedFallback: true }
  }
  let totalPaid = 0n
  let totalReceived = 0n
  for (const record of records) {
    totalPaid += record.amountPaid
    totalReceived += record.amountReceived
  }
  if (totalReceived === 0n) {
    return { rate: marketRate, usedFallback: true }
  }
  return {
    rate: { numerator: totalPaid, denominator: totalReceived },
    usedFallback: false,
  }
}

/** The same, resolved through the context by wallet id. */
export function walletAvgRate(
  walletId: WalletId,
  context: SettlementContext,
  marketRate: Rate,
): RateResult {
  return computeAvgRate(context.recordsByWallet.get(walletId) ?? [], marketRate)
}

/**
 * A wallet's average cost on its own terms, or null when it has nothing to
 * average.
 *
 * `computeAvgRate` answers the same question but needs a market rate to fall
 * back on, which is precisely what a caller reaching for this one does not
 * have: it exists for saving an expense while the rate provider is
 * unreachable, where the wallet's own cost is the only real number in the
 * room. Null means "this wallet cannot price anything yet", and the caller
 * must then ask the user rather than invent a figure.
 */
export function walletOwnAvgRate(
  walletId: WalletId,
  context: SettlementContext,
): Rate | null {
  const wallet = context.walletsById.get(walletId)
  if (!wallet) {
    return null
  }
  const records = context.recordsByWallet.get(walletId) ?? []
  if (records.length === 0) {
    return null
  }
  let totalPaid = 0n
  let totalReceived = 0n
  for (const record of records) {
    totalPaid += record.amountPaid
    totalReceived += record.amountReceived
  }
  return totalReceived === 0n
    ? null
    : { numerator: totalPaid, denominator: totalReceived }
}
