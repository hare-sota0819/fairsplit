import { ratio, rateFromDecimalString } from './money'
import { walletAvgRate } from './rates'
import { convertSplitFunding, fundingRemainder } from './split-funding'
import type {
  ConvertedMoney,
  ExpenseInput,
  FundingSourceInput,
  Rate,
  RateMode,
  RateResolution,
  RateResult,
  RateSource,
  SettlementContext,
  WalletId,
} from './types'

const IDENTITY: RateResolution = {
  rate: { numerator: 1n, denominator: 1n },
  source: 'MARKET_SNAPSHOT',
}

const IDENTITY_RATE: RateResult = {
  rate: { numerator: 1n, denominator: 1n },
  usedFallback: false,
}

/**
 * The rate one wallet converts at (identity when it holds the settlement
 * currency). Exported for the "paid from" picker, which has to show each
 * wallet's consequence before an expense exists.
 */
export function walletRateFor(
  walletId: WalletId,
  marketRateSnapshot: string,
  context: SettlementContext,
): RateResult {
  const wallet = context.walletsById.get(walletId)
  if (!wallet || wallet.currency === context.settlementCurrency) {
    return IDENTITY_RATE
  }
  const marketRate = rateFromDecimalString(
    marketRateSnapshot,
    context.settlementCurrency,
    wallet.currency,
  )
  return walletAvgRate(walletId, context, marketRate)
}

const abs = (x: bigint): bigint => (x < 0n ? -x : x)

type RateInputs = Pick<
  ExpenseInput,
  | 'payerId'
  | 'amount'
  | 'currency'
  | 'marketRateSnapshot'
  | 'funding'
  | 'walletId'
  | 'actualChargedAmount'
  | 'ownRateSnapshot'
>

/**
 * The funding an expense is priced from, normalised.
 *
 * `funding` is the truth when it is there; without it the expense had one
 * source, described by the flat shorthand fields. Every piece of maths goes
 * through here so the two shapes are reconciled in exactly one place.
 *
 * The sum is checked rather than trusted: portions that do not add up to the
 * expense would price part of a receipt twice or not at all, and that is a
 * caller bug worth failing loudly for, not a number to quietly settle on.
 */
export function fundingSources(expense: RateInputs): FundingSourceInput[] {
  const funding = expense.funding
  if (funding === undefined) {
    return [
      {
        amount: expense.amount,
        walletId: expense.walletId ?? null,
        ...(expense.actualChargedAmount === undefined
          ? {}
          : { actualChargedAmount: expense.actualChargedAmount }),
        ...(expense.ownRateSnapshot === undefined
          ? {}
          : { ownRateSnapshot: expense.ownRateSnapshot }),
      },
    ]
  }
  if (funding.length === 0) {
    throw new Error('An expense must have at least one funding source')
  }
  const remainder = fundingRemainder(expense.amount, funding)
  if (remainder !== 0n) {
    throw new Error(
      `Funding sources leave ${remainder} of ${expense.amount} unaccounted for`,
    )
  }
  return funding
}

/**
 * The rate ONE funding source settles at. The single rate-decision point,
 * per source (AVG_COST mode):
 *
 * - PREPAID (a wallet id): the money was exchanged before it was spent, so
 *   it converts at THAT WALLET's average cost. A wallet with no top-ups
 *   recorded has no cost to average, so it falls back to the market
 *   snapshot, flagged — never blocked.
 * - PREPAID WITH NO WALLET (`ownRateSnapshot`): the payer exchanged the
 *   money at a rate they told us, but keeps no wallet to draw it down from.
 *   That rate is their cost, so it wins over everything below — a member
 *   without a wallet must still be able to record spending honestly.
 * - PAY-AS-YOU-GO (null): the bank converted at purchase time. That is the
 *   snapshot, unless the payer recorded what the bank actually billed
 *   (`actualChargedAmount`), which then IS their true cost (expressed as the
 *   exact rational actualCharged/amount so per-share rounding is unchanged).
 *
 * MARKET mode always uses the snapshot, ignoring both the wallet and
 * actualCharged, for group fairness (see README).
 */
export function resolveSourceRate(
  funding: FundingSourceInput,
  expense: Pick<RateInputs, 'currency' | 'marketRateSnapshot'>,
  mode: RateMode,
  context: SettlementContext,
): RateResolution {
  // A checkpoint has settled this portion: the rate is pinned and nothing
  // entered since is allowed to reach it. This has to come FIRST — every
  // branch below reads live data (the wallet's top-ups, the group's mode),
  // and live data is exactly what a barrier exists to keep out.
  if (funding.frozen !== undefined) {
    return {
      rate: funding.frozen.rate,
      source: funding.frozen.source,
      frozen: true,
      ...(funding.walletId === null
        ? {}
        : { walletLabel: context.walletsById.get(funding.walletId)?.label }),
    }
  }
  if (
    mode === 'AVG_COST' &&
    funding.walletId === null &&
    funding.ownRateSnapshot !== undefined &&
    expense.currency !== context.settlementCurrency
  ) {
    return {
      rate: rateFromDecimalString(
        funding.ownRateSnapshot,
        context.settlementCurrency,
        expense.currency,
      ),
      source: 'OWN_EXCHANGE_RATE',
    }
  }
  if (
    mode === 'AVG_COST' &&
    funding.walletId === null &&
    funding.actualChargedAmount !== undefined
  ) {
    if (
      funding.actualChargedAmount === 0n ||
      funding.actualChargedAmount < 0n !== funding.amount < 0n
    ) {
      throw new Error('actualChargedAmount must have the sign of the amount')
    }
    return {
      rate: {
        numerator: abs(funding.actualChargedAmount),
        denominator: abs(funding.amount),
      },
      source: 'ACTUAL_CHARGED',
    }
  }
  if (expense.currency === context.settlementCurrency) {
    return IDENTITY
  }
  const marketRate = (): Rate =>
    rateFromDecimalString(
      expense.marketRateSnapshot,
      context.settlementCurrency,
      expense.currency,
    )
  if (mode === 'MARKET' || funding.walletId === null) {
    return { rate: marketRate(), source: 'MARKET_SNAPSHOT' }
  }
  // AVG_COST + prepaid: that wallet's average cost, snapshot fallback.
  const walletLabel = context.walletsById.get(funding.walletId)?.label
  const avg = walletAvgRate(funding.walletId, context, marketRate())
  return {
    rate: avg.rate,
    source: avg.usedFallback ? 'MARKET_FALLBACK' : 'WALLET_AVG_COST',
    walletLabel,
  }
}

/**
 * The exact cost of the whole expense divided by the whole expense: the
 * factor a PER-MEMBER share has to be multiplied by.
 *
 * This is deliberately NOT a rate anyone was charged, and it must never be
 * shown as one — that is what `SPLIT_FUNDING` on the resolution says, and
 * what `convertFunding` exists to display instead. It is only ever an
 * intermediate: a member who consumed a third of the receipt owes a third of
 * what the receipt actually cost, whatever mixture of sources paid it, and
 * that stays exact and proportional with ONE rounding per share.
 */
function blendedRate(
  portions: readonly { amount: bigint; rate: Rate }[],
  total: bigint,
): Rate {
  // Sum the exact rationals amount_i * rate_i over a running common
  // denominator; nothing is rounded on the way.
  let numerator = 0n
  let denominator = 1n
  for (const portion of portions) {
    numerator =
      numerator * portion.rate.denominator +
      portion.amount * portion.rate.numerator * denominator
    denominator *= portion.rate.denominator
  }
  // ...then divide by the total. A refund makes both sides negative; the
  // Rate contract wants the denominator positive.
  const scaled = total < 0n ? -denominator * total : denominator * total
  const signed = total < 0n ? -numerator : numerator
  const reduced = ratio(signed, scaled)
  return { numerator: reduced.num, denominator: reduced.den }
}

/**
 * The one rate to price this expense's shares at, and where it came from.
 *
 * One funding source is the ordinary case and answers exactly as it always
 * has. More than one has no single answer to give, so it reports
 * `SPLIT_FUNDING` with the blended factor above — correct for arithmetic,
 * never for display.
 */
export function resolveRate(
  expense: RateInputs,
  mode: RateMode,
  context: SettlementContext,
): RateResolution {
  const sources = fundingSources(expense)
  if (sources.length === 1) {
    return resolveSourceRate(sources[0], expense, mode, context)
  }
  const portions = sources.map((source) => ({
    amount: source.amount,
    rate: resolveSourceRate(source, expense, mode, context).rate,
  }))
  return {
    rate: blendedRate(portions, expense.amount),
    source: 'SPLIT_FUNDING',
    // Same rule as `convertExpense`: every portion, or it is not frozen.
    ...(sources.every((source) => source.frozen !== undefined)
      ? { frozen: true }
      : {}),
  }
}

/**
 * The chip value for a resolution: 'FROZEN' when a checkpoint pinned it,
 * otherwise the source that applied.
 *
 * Two facts, one chip. The user needs to know the number cannot move; the
 * record needs to know which rate produced it. Splitting them here rather
 * than overwriting `source` at freeze time keeps both — and keeps
 * `rateChip.FROZEN` a display key with no storage meaning.
 */
export function displayRateSource(resolution: {
  source: RateSource
  frozen?: boolean
}): RateSource {
  return resolution.frozen === true ? 'FROZEN' : resolution.source
}

export interface ConvertedPortion {
  funding: FundingSourceInput
  resolution: RateResolution
  /** This portion in settlement minor units, rounded once. */
  settlement: bigint
}

export interface FundingConversion {
  /** The expense total: the sum of the portions, never a second division. */
  amount: bigint
  portions: ConvertedPortion[]
}

/**
 * Convert an expense portion by portion — the shape every display needs,
 * because "¥50,000 at the card's rate and ¥32,000 at the market's" is the
 * fact, and any single number that replaces it is either a coincidence or a
 * lie. Rounding follows `convertSplitFunding`: once per portion.
 */
export function convertFunding(
  expense: RateInputs,
  mode: RateMode,
  context: SettlementContext,
): FundingConversion {
  const sources = fundingSources(expense)
  const resolutions = sources.map((source) =>
    resolveSourceRate(source, expense, mode, context),
  )
  const split = convertSplitFunding(
    sources.map((source, index) => ({
      amount: source.amount,
      rate: resolutions[index].rate,
    })),
  )
  return {
    amount: split.amount,
    portions: sources.map((funding, index) => ({
      funding,
      resolution: resolutions[index],
      settlement: split.portions[index],
    })),
  }
}

/**
 * Convert an expense total into the settlement currency, rounded exactly
 * once per funding portion with signed ceiling (up for positives, toward
 * zero for refunds) — payer-favored either way. Returns the rate source for
 * display chips; an expense paid from several sources reports
 * `SPLIT_FUNDING` and has no single wallet label to give.
 */
export function convertExpense(
  expense: RateInputs,
  mode: RateMode,
  context: SettlementContext,
): ConvertedMoney {
  const { amount, portions } = convertFunding(expense, mode, context)
  const single = portions.length === 1 ? portions[0].resolution : undefined
  return {
    amount,
    currency: context.settlementCurrency,
    source: single?.source ?? 'SPLIT_FUNDING',
    walletLabel: single?.walletLabel,
    // A split-funded expense counts as frozen only when EVERY portion is —
    // which is the only state a checkpoint can leave it in, since it freezes
    // whole expenses. Deriving it rather than assuming it means a
    // half-written freeze shows up as unfrozen instead of silently claiming
    // finality it does not have.
    //
    // Omitted rather than set to false when it is not frozen: this object is
    // compared structurally all over the tests, and a live conversion is the
    // same fact it has always been.
    ...(portions.every((portion) => portion.resolution.frozen === true)
      ? { frozen: true }
      : {}),
  }
}
