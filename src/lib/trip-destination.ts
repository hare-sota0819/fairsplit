import { destinationFor } from './destinations'

export interface TripDestination {
  /** ISO 3166-1 alpha-2, or null for "not decided". */
  country: string | null
  /** A city within that country, or null. */
  city: string | null
  /** ISO 4217, DERIVED from the country. Null when no country is set. */
  currency: string | null
}

const NONE: TripDestination = { country: null, city: null, currency: null }

/**
 * Turn the destination form fields into what the group actually stores.
 *
 * The currency is derived HERE, from the country, and is never taken from
 * the client: the user was asked where they are going, so the only thing
 * they can get wrong is the place. An unrecognised country means "not
 * decided" rather than an error — the field is optional and a rejected
 * group-create over a stale option value would be a worse trade.
 *
 * A city is only kept if it really belongs to the chosen country. Otherwise
 * a country change that raced the city field would strand "Kyoto" on a trip
 * to Thailand.
 *
 * Pure, so every branch is unit-tested without a form or a database.
 */
export function resolveTripDestination(
  countryRaw: string | undefined,
  cityRaw: string | undefined,
): TripDestination {
  const destination = destinationFor((countryRaw ?? '').trim().toUpperCase())
  if (!destination) {
    return NONE
  }
  const city = (cityRaw ?? '').trim()
  return {
    country: destination.code,
    city: destination.cities.includes(city) ? city : null,
    currency: destination.currency,
  }
}
