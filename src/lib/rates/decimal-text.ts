/**
 * Exact arithmetic on rate strings, as text — never through a float.
 *
 * A rate arrives from a provider as a decimal literal in the response body
 * (e.g. `9.140467827`). Two things have to happen to it before it is worth
 * trusting, and neither may round-trip through `Number`:
 *
 *  1. It has to fit the storage column, `Decimal(24, 10)`.
 *  2. It has to be compared against a second provider's answer, so a
 *     wrong-by-100x rate is caught before it reaches a settlement.
 *
 * Both are decimal-string operations, so they live here and are unit-tested
 * on their own.
 */

/** Decimal literal with no sign and no exponent — the only shape we accept. */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/

export function isPlainDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value)
}

/**
 * Drop digits beyond `max` decimal places, exactly.
 *
 * Truncation rather than rounding, so the stored value is always a prefix of
 * what the provider said and can never be nudged upward past it. At the
 * storage limit of 10 places the discarded tail is below 1e-10 of a rate in
 * the 1–2000 range — orders of magnitude under one minor unit on any amount
 * this app will ever settle.
 */
export function clampDecimals(value: string, max: number): string {
  const [intPart, fracPart = ''] = value.split('.')
  if (fracPart.length <= max) {
    return value
  }
  const kept = fracPart.slice(0, max).replace(/0+$/, '')
  return kept ? `${intPart}.${kept}` : intPart
}

/** A decimal string as an exact integer scaled by 10^scale. */
function unscale(value: string): { unscaled: bigint; scale: number } {
  const [intPart, fracPart = ''] = value.split('.')
  return { unscaled: BigInt(intPart + fracPart), scale: fracPart.length }
}

/**
 * Whether `candidate` sits within `maxPercent` of `reference`, exactly.
 *
 * The comparison is `|candidate - reference| * 100 <= maxPercent * reference`
 * evaluated in bigint after aligning both scales, so a 100x error is caught
 * with certainty and a fraction-of-a-percent difference between two honest
 * live sources is not.
 *
 * `reference` must be positive; a zero or malformed reference means there is
 * nothing to check against and the caller is told so by `false`.
 */
export function withinTolerance(
  candidate: string,
  reference: string,
  maxPercent: number,
): boolean {
  if (!isPlainDecimal(candidate) || !isPlainDecimal(reference)) {
    return false
  }
  const a = unscale(candidate)
  const b = unscale(reference)
  const scale = Math.max(a.scale, b.scale)
  const left = a.unscaled * 10n ** BigInt(scale - a.scale)
  const right = b.unscaled * 10n ** BigInt(scale - b.scale)
  if (right <= 0n) {
    return false
  }
  const diff = left > right ? left - right : right - left
  // maxPercent is a caller-supplied constant, not user input; express it as
  // an integer permille so the whole comparison stays in bigint.
  const permille = BigInt(Math.round(maxPercent * 10))
  return diff * 1000n <= permille * right
}
