/**
 * Rate DISPLAY units vs. rate STORAGE units.
 *
 * Storage (what the engine and `marketRateSnapshot` hold) is always
 * "settlement major units per 1 foreign major unit" — e.g. 9.1666 KRW/JPY.
 * Nobody quotes rates that way for small-denomination currencies: Koreans
 * say "100 JPY = 916.66 KRW". Phase 3C's headline bug was a user typing the
 * quoted form into a field that meant the storage form, 100x too large.
 *
 * So every rate the user reads or types goes through this module, and
 * nothing else converts between the two units.
 */

import { rateFromDecimalString, roundDivHalfEven } from '@/lib/settlement'

/**
 * How many major units of the foreign currency a quoted rate refers to.
 * PRODUCT-CURATED, and every value must be a power of ten so the conversion
 * is an exact decimal-point shift (never a float multiply). Unlisted
 * currencies quote per 1.
 */
export const QUOTE_UNITS: Record<string, number> = {
  JPY: 100,
  KRW: 100,
  VND: 1000,
  IDR: 1000,
  HUF: 100,
  CLP: 100,
}

/** DB column is Decimal(24, 10): a storage rate may not exceed 10 decimals. */
const MAX_STORAGE_DECIMALS = 10

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/

export function quoteUnitFor(currency: string): number {
  return QUOTE_UNITS[currency] ?? 1
}

/** Digits to move the decimal point by for this currency (log10 of the unit). */
const placesFor = (currency: string): number =>
  Math.round(Math.log10(quoteUnitFor(currency)))

/**
 * Move a decimal string's point by `places` (negative = divide), exactly.
 * Returns a plain decimal string with no leading/trailing padding.
 */
function shiftDecimal(value: string, places: number): string {
  const [intPart, fracPart = ''] = value.split('.')
  const digits = intPart + fracPart
  // Position of the point counted from the left of `digits`.
  let point = intPart.length + places
  let padded = digits
  if (point <= 0) {
    padded = '0'.repeat(1 - point) + digits
    point += 1 - point
  }
  if (point > padded.length) {
    padded = padded + '0'.repeat(point - padded.length)
  }
  const head = padded.slice(0, point).replace(/^0+(?=\d)/, '')
  const tail = padded.slice(point).replace(/0+$/, '')
  return tail ? `${head}.${tail}` : head
}

/**
 * A rate as the user typed it (settlement major per `quoteUnitFor(currency)`
 * foreign major) → the storage form. Null for malformed, zero, or
 * over-precise input.
 */
export function displayRateToStorage(
  display: string,
  currency: string,
): string | null {
  const trimmed = display.trim()
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return null
  }
  if (/^0+(\.0+)?$/.test(trimmed)) {
    return null
  }
  const stored = shiftDecimal(trimmed, -placesFor(currency))
  const decimals = stored.split('.')[1]?.length ?? 0
  return decimals > MAX_STORAGE_DECIMALS ? null : stored
}

/**
 * The inverse, for prefilling and for the "today's rate 100 JPY = 916 KRW"
 * line: storage form → display form, rounded (half-up) at `maxDecimals`.
 */
export function storageRateToDisplay(
  storage: string,
  currency: string,
  maxDecimals = 4,
): string | null {
  const trimmed = storage.trim()
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return null
  }
  const shifted = shiftDecimal(trimmed, placesFor(currency))
  const [intPart, fracPart = ''] = shifted.split('.')
  if (fracPart.length <= maxDecimals) {
    return shifted
  }
  const keep = BigInt(intPart + fracPart.slice(0, maxDecimals))
  const rounded = fracPart.charCodeAt(maxDecimals) >= 53 ? keep + 1n : keep
  return shiftDecimal(rounded.toString(), -maxDecimals)
}

/**
 * "I changed 50,000 JPY at 100 JPY = 916 KRW — what did that cost me?"
 * Part 2's exchange form asks for the rate and the foreign amount, which is
 * what people actually remember, and computes the settlement amount here
 * (exact rational, half-even at settlement minor units). Null when the rate
 * is unusable.
 */
export function convertAtDisplayRate(
  foreignMinor: bigint,
  displayRate: string,
  foreignCurrency: string,
  settlementCurrency: string,
): bigint | null {
  const storage = displayRateToStorage(displayRate, foreignCurrency)
  if (storage === null) {
    return null
  }
  try {
    const rate = rateFromDecimalString(
      storage,
      settlementCurrency,
      foreignCurrency,
    )
    return roundDivHalfEven(foreignMinor * rate.numerator, rate.denominator)
  } catch {
    return null
  }
}

/**
 * Sanity guard for a manually entered rate: does `candidate` differ from
 * `reference` by more than `percent`? Exact integer comparison — malformed
 * or zero input never trips it (the warning must never be the loud thing).
 * Both arguments are in the same unit.
 */
export function deviatesBeyond(
  candidate: string,
  reference: string,
  percent: number,
): boolean {
  const a = toScaled(candidate)
  const b = toScaled(reference)
  if (a === null || b === null || b.value === 0n) {
    return false
  }
  const scale = Math.max(a.decimals, b.decimals)
  const av = a.value * 10n ** BigInt(scale - a.decimals)
  const bv = b.value * 10n ** BigInt(scale - b.decimals)
  const diff = av > bv ? av - bv : bv - av
  return diff * 100n > bv * BigInt(percent)
}

function toScaled(value: string): { value: bigint; decimals: number } | null {
  const trimmed = value.trim()
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return null
  }
  const [intPart, fracPart = ''] = trimmed.split('.')
  return { value: BigInt(intPart + fracPart), decimals: fracPart.length }
}
