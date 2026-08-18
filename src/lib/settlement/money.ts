import currencyCodes from 'currency-codes'
import type { CurrencyCode, Rate, Ratio } from './types'

/**
 * Whether this is a code the ISO 4217 table knows — the same table
 * `minorUnitDigits` reads, never a hand-written list (the project's currency
 * rule). Callers that take a currency from PARSED TEXT ask this first:
 * `minorUnitDigits` throws on an unknown code, and a throw reaches the user as
 * a generic failure rather than as the reason.
 */
export function isKnownCurrency(currency: string): boolean {
  return currencyCodes.code(currency) !== undefined
}

/** ISO 4217 minor-unit digits for a currency (JPY -> 0, USD -> 2). */
export function minorUnitDigits(currency: CurrencyCode): number {
  const entry = currencyCodes.code(currency)
  if (!entry) {
    throw new Error(`Unknown ISO 4217 currency code: ${currency}`)
  }
  return entry.digits
}

const abs = (x: bigint): bigint => (x < 0n ? -x : x)

/**
 * Integer division rounded half-to-even (banker's rounding), sign-correct.
 * The engine's single rounding primitive: every currency conversion rounds
 * exactly once, through this.
 */
export function roundDivHalfEven(x: bigint, y: bigint): bigint {
  if (y === 0n) {
    throw new Error('Division by zero')
  }
  const quotient = x / y
  const remainder = x % y
  if (remainder === 0n) {
    return quotient
  }
  const towardResult = x < 0n === y < 0n ? 1n : -1n
  const doubledRemainder = 2n * abs(remainder)
  const absDivisor = abs(y)
  if (doubledRemainder > absDivisor) {
    return quotient + towardResult
  }
  if (doubledRemainder < absDivisor) {
    return quotient
  }
  // Exact half: round to the even neighbor.
  return quotient % 2n === 0n ? quotient : quotient + towardResult
}

/**
 * Signed ceiling division: the payer-favored rounding primitive. Positive
 * shares round UP (consumers pay the extra minor unit); negative shares
 * (refunds) round TOWARD ZERO (consumers get slightly less back) — either
 * way the payer never loses (product decision — see docs/DECISIONS.md and
 * the engine README). Divisor must be positive.
 */
export function ceilDiv(x: bigint, y: bigint): bigint {
  if (y <= 0n) {
    throw new Error('Divisor must be positive')
  }
  const quotient = x / y // BigInt division truncates toward zero
  return x % y !== 0n && x > 0n ? quotient + 1n : quotient
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))

const absBig = (x: bigint): bigint => (x < 0n ? -x : x)

/** Build a Ratio normalized to lowest terms (den > 0; num may be negative). */
export function ratio(num: bigint, den: bigint): Ratio {
  if (den <= 0n) {
    throw new Error('Denominator must be positive')
  }
  if (num === 0n) {
    return { num: 0n, den: 1n }
  }
  const g = gcd(absBig(num), den)
  return { num: num / g, den: den / g }
}

/** Exact sum of two ratios. */
export function addRatio(a: Ratio, b: Ratio): Ratio {
  return ratio(a.num * b.den + b.num * a.den, a.den * b.den)
}

/**
 * Split `total` proportionally to `weights` using the largest remainder
 * method: floor every share, then hand the leftover minor units to the
 * largest fractional remainders (ties broken by lower index). Deterministic,
 * and the result always sums exactly to `total`.
 */
export function allocateLargestRemainder(
  total: bigint,
  weights: bigint[],
): bigint[] {
  if (total < 0n) {
    throw new Error('Cannot allocate a negative total')
  }
  if (weights.some((w) => w < 0n)) {
    throw new Error('Weights must be non-negative')
  }
  const weightSum = weights.reduce((a, b) => a + b, 0n)
  if (weightSum === 0n) {
    throw new Error('Weights must not be empty or all zero')
  }

  const shares = weights.map((w) => (total * w) / weightSum)
  const remainders = weights.map((w) => (total * w) % weightSum)

  let leftover = total - shares.reduce((a, b) => a + b, 0n)
  const byLargestRemainder = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => {
      if (a.remainder !== b.remainder) {
        return b.remainder > a.remainder ? 1 : -1
      }
      return a.index - b.index
    })
  for (const { index } of byLargestRemainder) {
    if (leftover === 0n) break
    shares[index] += 1n
    leftover -= 1n
  }
  return shares
}

/**
 * Inverse of rateFromDecimalString, for display and snapshot fallback:
 * render a minor-per-minor rational as settlement MAJOR units per 1 foreign
 * MAJOR unit, half-even rounded at maxDecimals, trailing zeros trimmed.
 */
export function rateToDecimalString(
  rate: Rate,
  settlementCurrency: CurrencyCode,
  foreignCurrency: CurrencyCode,
  maxDecimals = 4,
): string {
  const foreignDigits = minorUnitDigits(foreignCurrency)
  const settlementDigits = minorUnitDigits(settlementCurrency)
  const scaled = roundDivHalfEven(
    rate.numerator * 10n ** BigInt(foreignDigits + maxDecimals),
    rate.denominator * 10n ** BigInt(settlementDigits),
  )
  const s = scaled.toString().padStart(maxDecimals + 1, '0')
  const intPart = s.slice(0, s.length - maxDecimals)
  const frac = s.slice(s.length - maxDecimals).replace(/0+$/, '')
  return frac ? `${intPart}.${frac}` : intPart
}

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/

/**
 * Parse a decimal rate string (settlement MAJOR units per foreign MAJOR unit,
 * e.g. "9.205" KRW/JPY) into an exact rational in MINOR units: settlement
 * minor units per 1 foreign minor unit. No floating point involved.
 */
export function rateFromDecimalString(
  value: string,
  settlementCurrency: CurrencyCode,
  foreignCurrency: CurrencyCode,
): Rate {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`Malformed rate: "${value}"`)
  }
  const [intPart, fracPart = ''] = value.split('.')
  const unscaled = BigInt(intPart + fracPart)
  if (unscaled === 0n) {
    throw new Error('Rate must be positive')
  }
  const settlementScale = 10n ** BigInt(minorUnitDigits(settlementCurrency))
  const foreignScale = 10n ** BigInt(minorUnitDigits(foreignCurrency))
  const fracScale = 10n ** BigInt(fracPart.length)
  return {
    numerator: unscaled * settlementScale,
    denominator: fracScale * foreignScale,
  }
}
