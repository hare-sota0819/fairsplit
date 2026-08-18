import { ceilDiv } from './money'
import type { Rate } from './types'

/**
 * One slice of an expense that was paid from its own source.
 *
 * A travel card holding ¥50,000 cannot pay an ¥82,000 receipt on its own. The
 * rest comes from somewhere else — another wallet, or on the spot — and THAT
 * IS NOT A COSMETIC DETAIL: the funding source decides the rate, so charging
 * the whole ¥82,000 at the card's average rate makes the settlement figures
 * wrong, not just the wallet balance.
 */
export interface FundingPortion {
  /** Minor units of the expense currency paid from this source. */
  amount: bigint
  /** The rate that source settles at, already resolved. */
  rate: Rate
}

export interface SplitConversion {
  /** Settlement minor units, the sum of the converted portions. */
  amount: bigint
  /** Each portion's own converted amount, in the order given. */
  portions: bigint[]
}

/**
 * Convert an expense that was funded from more than one source.
 *
 * ROUNDING. The project's rule is "round exactly once, at settlement minor
 * units". With one rate that means one rounding for the expense. With two
 * rates it CANNOT mean that: two portions at two different rates are two
 * separate exact rationals, and there is no single division left to defer to.
 * So the rule becomes "round exactly once PER PORTION", still payer-favoured
 * (`ceilDiv`), and the expense total is the sum of those roundings.
 *
 * The cost is bounded and worth stating: an expense split N ways can sit up
 * to N-1 minor units above the figure a single conversion would have given.
 * The alternative — convert the total at a blended rate — would be worse than
 * imprecise, it would be wrong: a blend invents a rate that nobody was
 * charged.
 */
export function convertSplitFunding(
  portions: readonly FundingPortion[],
): SplitConversion {
  if (portions.length === 0) {
    throw new Error('An expense must have at least one funding portion')
  }
  const converted = portions.map((portion) =>
    ceilDiv(portion.amount * portion.rate.numerator, portion.rate.denominator),
  )
  return {
    amount: converted.reduce((total, value) => total + value, 0n),
    portions: converted,
  }
}

/**
 * How much of `total` is left once the named portions are taken off.
 *
 * The wizard asks its question from this: a positive remainder is the amount
 * that still needs a source, and it is what the owner saw silently swallowed.
 */
export function fundingRemainder(
  total: bigint,
  portions: readonly { amount: bigint }[],
): bigint {
  return portions.reduce((left, portion) => left - portion.amount, total)
}

/**
 * What a wallet can still cover, floored at zero.
 *
 * A wallet already overdrawn covers nothing more; it must not report a
 * negative capacity and quietly turn into a credit.
 */
export function walletCapacity(remaining: bigint): bigint {
  return remaining > 0n ? remaining : 0n
}
