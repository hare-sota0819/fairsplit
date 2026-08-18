import {
  allocateExactShares,
  ceilDiv,
  consumedShares,
  convertFunding,
  fundingSources,
  resolveRate,
  type CurrencyCode,
  type ExpenseInput,
  type MemberId,
  type Rate,
  type RateMode,
  type RateSource,
  type SettlementContext,
} from '@/lib/settlement'

/**
 * The two headline figures on home, broken down by WHICH RATE produced them.
 *
 * A converted number with no rate beside it is the defect this exists to
 * prevent: the same ¥11,000 becomes a different number of won depending on
 * whether it came off a travel card bought at 913 or was tapped on the spot
 * at 920, and the user has no way to tell those apart from the total alone.
 *
 * Two properties matter more than anything else here, and both are secured
 * by CONSTRUCTION rather than by checking afterwards:
 *
 *  1. The rows sum EXACTLY to the headline. The headline is defined as the
 *     sum of the rows — it is never computed by a second route that could
 *     round differently. `totalSpend`/`totalSettlement` are folds of `rows`.
 *  2. Two pots are never merged just because their rates coincide. The
 *     grouping key carries the wallet's identity, not its rate. (This
 *     project has already shipped a bug where wallets were told apart by
 *     rate alone.)
 *
 * Pure — no DB, no clock, no formatting — so every branch is unit-tested.
 */

export interface RateRow {
  /** Stable identity for the group; also a React key. */
  key: string
  source: RateSource
  /** The wallet the rate came from, when one did. */
  walletId: string | null
  walletLabel?: string
  /**
   * WHOSE rate this is. For "what I fronted" that is always the viewer, so
   * the UI omits it; for "my share" it is the payer, because a share of
   * someone else's purchase converts at THEIR wallet's rate, not yours.
   */
  rateOwnerId: MemberId
  /** Exact rate, for the row to state. Formatting belongs to the UI. */
  rate: Rate
  /** The currency the money was spent in. */
  currency: CurrencyCode
  /** Total in `currency` minor units. */
  spend: bigint
  /** Total in settlement-currency minor units. */
  settlement: bigint
}

export interface RateBreakdown {
  rows: RateRow[]
  /** Sum of every row's settlement figure. Exact by construction. */
  totalSettlement: bigint
  /**
   * The spend-currency total, but ONLY when every row shares one currency.
   * Null for a mixed-currency trip: adding yen to won would need a rate the
   * app has deliberately never had (it converts foreign -> settlement, never
   * foreign -> foreign), and inventing one to fill a headline would be the
   * exact class of silent error this screen exists to stop.
   */
  totalSpend: { currency: CurrencyCode; amount: bigint } | null
}

interface Accumulator {
  row: RateRow
}

function keyFor(
  ownerId: MemberId,
  walletId: string | null,
  source: RateSource,
  currency: CurrencyCode,
): string {
  return `${ownerId}|${walletId ?? 'none'}|${source}|${currency}`
}

function finish(groups: Map<string, Accumulator>): RateBreakdown {
  const rows = [...groups.values()].map((group) => group.row)
  // Biggest first: the row that moved the most money is the one worth
  // reading, and a stable tiebreak keeps the order from flickering.
  rows.sort((a, b) =>
    a.settlement === b.settlement
      ? a.key.localeCompare(b.key)
      : b.settlement > a.settlement
        ? 1
        : -1,
  )
  const totalSettlement = rows.reduce((sum, row) => sum + row.settlement, 0n)
  const currencies = new Set(rows.map((row) => row.currency))
  return {
    rows,
    totalSettlement,
    totalSpend:
      currencies.size === 1
        ? {
            currency: rows[0].currency,
            amount: rows.reduce((sum, row) => sum + row.spend, 0n),
          }
        : null,
  }
}

function add(
  groups: Map<string, Accumulator>,
  seed: Omit<RateRow, 'spend' | 'settlement'>,
  spend: bigint,
  settlement: bigint,
): void {
  const existing = groups.get(seed.key)
  if (existing) {
    existing.row.spend += spend
    existing.row.settlement += settlement
    return
  }
  groups.set(seed.key, { row: { ...seed, spend, settlement } })
}

/**
 * What this member paid out on behalf of the group, grouped by the rate
 * their money converted at. Every expense they are the payer of counts,
 * whatever anyone's share of it turned out to be.
 *
 * One receipt paid from two sources lands in TWO rows — that is the whole
 * point of the screen, and the only place the split is visible as money
 * rather than as a note.
 */
export function frontedBreakdown(
  memberId: MemberId,
  expenses: ExpenseInput[],
  mode: RateMode,
  context: SettlementContext,
): RateBreakdown {
  const groups = new Map<string, Accumulator>()
  for (const expense of expenses) {
    if (expense.payerId !== memberId) {
      continue
    }
    for (const portion of convertFunding(expense, mode, context).portions) {
      const { source, walletLabel, rate } = portion.resolution
      const walletId = portion.funding.walletId
      add(
        groups,
        {
          key: keyFor(memberId, walletId, source, expense.currency),
          source,
          walletId,
          ...(walletLabel === undefined ? {} : { walletLabel }),
          rateOwnerId: memberId,
          rate,
          currency: expense.currency,
        },
        portion.funding.amount,
        portion.settlement,
      )
    }
  }
  return finish(groups)
}

/**
 * This member's share of everything the group bought, grouped by the rate
 * that share converted at — which belongs to whoever PAID, not to them.
 *
 * The settlement figure per expense is `consumedShares`, the same number the
 * rest of the app shows for "what I consumed", so the breakdown cannot
 * disagree with it. The spend-currency figure rounds the exact rational
 * share the same payer-favoured way, once, here.
 *
 * A receipt paid from several sources stays ONE row here, unlike the fronted
 * side. A share is not attached to any one source — you did not eat the
 * travel-card half — and cutting it up would mean rounding each piece, which
 * is exactly how a breakdown starts disagreeing with the total it explains.
 * The row says `SPLIT_FUNDING` so the UI states the sources instead of a
 * rate.
 */
export function shareBreakdown(
  memberId: MemberId,
  expenses: ExpenseInput[],
  mode: RateMode,
  context: SettlementContext,
): RateBreakdown {
  const groups = new Map<string, Accumulator>()
  for (const expense of expenses) {
    const settlement = consumedShares(expense, mode, context).get(memberId)
    if (settlement === undefined) {
      continue
    }
    const exact = allocateExactShares(expense).get(memberId)
    if (exact === undefined) {
      continue
    }
    const { source, walletLabel, rate } = resolveRate(expense, mode, context)
    const sources = fundingSources(expense)
    const walletId = sources.length === 1 ? sources[0].walletId : null
    add(
      groups,
      {
        key: keyFor(expense.payerId, walletId, source, expense.currency),
        source,
        walletId,
        ...(walletLabel === undefined ? {} : { walletLabel }),
        rateOwnerId: expense.payerId,
        rate,
        currency: expense.currency,
      },
      ceilDiv(exact.num, exact.den),
      settlement,
    )
  }
  return finish(groups)
}
