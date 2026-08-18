import { destinationCurrencies } from './destinations'

/**
 * The currencies the UI offers, in picker order. PRODUCT-CURATED — storage
 * and the engine accept any ISO 4217 code.
 *
 * INVARIANT: every currency any destination in `destinations.ts` uses must
 * appear here, or picking that country as the trip destination would set a
 * trip currency the expense form cannot offer. `currencies.test.ts` enforces
 * it, so adding a destination fails the gate until its currency is listed.
 *
 * Order is deliberate, because a phone `<select>` is a long scroll: the
 * handful people actually settle in first, then everything else
 * alphabetically. Nothing depends on the order but the reading experience.
 */
const COMMON = [
  'KRW',
  'JPY',
  'USD',
  'EUR',
  'GBP',
  'CNY',
  'TWD',
  'HKD',
  'SGD',
  'THB',
  'VND',
  'AUD',
] as const

const REST = [
  'AED',
  'ARS',
  'BRL',
  'CAD',
  'CHF',
  'CLP',
  'COP',
  'CRC',
  'CUP',
  'CZK',
  'DKK',
  'DOP',
  'EGP',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'LKR',
  'MAD',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PEN',
  'PHP',
  'PLN',
  'SAR',
  'SEK',
  'TRY',
  'ZAR',
] as const

export const CURATED_CURRENCIES = [...COMMON, ...REST] as const

/** Currencies a destination implies but the picker does not yet offer. */
export function missingDestinationCurrencies(): string[] {
  const offered = new Set<string>(CURATED_CURRENCIES)
  return destinationCurrencies().filter((code) => !offered.has(code))
}
