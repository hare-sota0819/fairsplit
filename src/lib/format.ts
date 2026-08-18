import { minorUnitDigits } from '@/lib/settlement'

/**
 * Format bigint minor units for display (display edge only — money math
 * stays bigint everywhere else). Locale fixed to `en` to match the single
 * app locale.
 */
export function formatMinor(amount: bigint, currency: string): string {
  const digits = minorUnitDigits(currency)
  const formatter = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return formatter.format(Number(amount) / 10 ** digits)
}

const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/

/**
 * Parse a user-typed decimal amount into exact minor units with string math
 * (no floats). Negative amounts are refunds. Returns null for malformed or
 * over-precise input.
 */
export function parseAmountToMinor(
  input: string,
  currency: string,
): bigint | null {
  const trimmed = input.trim()
  if (!AMOUNT_PATTERN.test(trimmed)) {
    return null
  }
  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const digits = minorUnitDigits(currency)
  const [intPart, fracPart = ''] = unsigned.split('.')
  if (fracPart.length > digits) {
    return null
  }
  const minor = BigInt(intPart + fracPart.padEnd(digits, '0'))
  return negative ? -minor : minor
}

/** Inverse of parseAmountToMinor: minor units -> plain decimal input text. */
export function minorToDecimalInput(amount: bigint, currency: string): string {
  const digits = minorUnitDigits(currency)
  const negative = amount < 0n
  const unsigned = (negative ? -amount : amount).toString()
  if (digits === 0) {
    return `${negative ? '-' : ''}${unsigned}`
  }
  const s = unsigned.padStart(digits + 1, '0')
  return `${negative ? '-' : ''}${s.slice(0, -digits)}.${s.slice(-digits)}`
}

/** Compact "how long ago" label: minutes under an hour, else whole hours. */
export function formatRelativeTime(from: Date, to: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((to.getTime() - from.getTime()) / 60_000),
  )
  if (minutes < 60) {
    return `${minutes}m`
  }
  return `${Math.floor(minutes / 60)}h`
}
