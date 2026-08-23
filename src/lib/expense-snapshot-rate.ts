/**
 * The snapshot rate a NEW expense is priced with, when nobody typed one in.
 *
 * Split out of `expense-create.ts` (review round 1, IMPORTANT 2): that module
 * is a pure function of its input and is pinned as such by a test, which it
 * could not be while it also reached the database and the rate provider
 * through this. Its caller is `saveExpense` (expenses/actions.ts); the
 * chat's currency swap, which shared it so a re-created expense was priced
 * exactly as a fresh entry at the same instant would be, went with the chat
 * programme on 2026-08-21.
 */
import { prisma } from '@/lib/prisma'
import { getSnapshotRate } from '@/lib/rates/cached'
import { rateToDecimalString, walletOwnAvgRate } from '@/lib/settlement'

/**
 * The rate to store when no market rate can be reached: the average cost of
 * the single prepaid wallet the whole expense came out of, or null.
 *
 * Deliberately narrow. It answers only for an expense funded ENTIRELY from
 * ONE wallet holding the expense's own currency, because that is the only
 * shape where a single stored number is exactly what the expense converts at.
 * Split funding prices each portion separately and has no single rate to
 * stand in for; a pay-as-you-go portion genuinely needs the market. Both fall
 * through to null, and the caller asks the user instead of guessing.
 */
async function walletStandInRate(
  fundingRows: { walletId: string | null }[],
  currency: string,
  settlementCurrency: string,
): Promise<string | null> {
  const walletIds = new Set(fundingRows.map((row) => row.walletId))
  if (walletIds.size !== 1) {
    return null
  }
  const [walletId] = [...walletIds]
  if (walletId === null) {
    return null
  }
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    include: { exchangeRecords: true },
  })
  // A wallet in another currency prices its own money, not this expense's.
  if (!wallet || wallet.currency !== currency) {
    return null
  }
  const rate = walletOwnAvgRate(walletId, {
    settlementCurrency,
    walletsById: new Map([
      [
        wallet.id,
        {
          id: wallet.id,
          memberId: wallet.memberId,
          type: wallet.type,
          label: wallet.label,
          currency: wallet.currency,
        },
      ],
    ]),
    recordsByWallet: new Map([
      [
        wallet.id,
        wallet.exchangeRecords.map((record) => ({
          walletId: record.walletId,
          amountPaid: record.amountPaid,
          amountReceived: record.amountReceived,
          currency: record.currency,
        })),
      ],
    ]),
  })
  return rate === null
    ? null
    : rateToDecimalString(rate, settlementCurrency, currency)
}

/**
 * Set exactly once, at creation, and never updated afterwards. Same currency
 * as settlement converts at 1. Otherwise the provider answers (cached), and it
 * must never block entry: on failure an expense paid entirely out of ONE
 * prepaid wallet stores that wallet's own average cost instead — the rate it
 * genuinely converts at — flagged `provisional` so the two readers that would
 * take it for a market rate can say it is standing in.
 *
 * `null` means no rate could be established at all; the caller asks the user
 * rather than storing a guess.
 */
export async function resolveSnapshotRate(params: {
  timestamp: Date
  currency: string
  settlementCurrency: string
  funding: { walletId: string | null }[]
}): Promise<{ rate: string; provisional: boolean } | null> {
  if (params.currency === params.settlementCurrency) {
    return { rate: '1', provisional: false }
  }
  const fetched = await getSnapshotRate(
    params.timestamp,
    params.currency,
    params.settlementCurrency,
  )
  if (fetched !== null) {
    return { rate: fetched.rate, provisional: false }
  }
  const provisional = await walletStandInRate(
    params.funding,
    params.currency,
    params.settlementCurrency,
  )
  return provisional === null ? null : { rate: provisional, provisional: true }
}
