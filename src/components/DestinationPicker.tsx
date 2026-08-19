'use client'

import { useLocale } from 'next-intl'

import { useState } from 'react'
import { countryName } from '@/lib/country-name'
import { DESTINATIONS, destinationFor, flagEmoji } from '@/lib/destinations'

export interface DestinationLabels {
  /** "Where are you going?" */
  country: string
  /** The "not decided" option. */
  countryNone: string
  /** "Which city?" */
  city: string
  /** The "anywhere in the country" option. */
  cityNone: string
  /** Explains that the currency follows from the country. */
  help: string
  /** "Money there is spent in {currency}." */
  currencyNote: string
}

/**
 * "Where are you going?" — asked as a PLACE, which is the only form a
 * traveller can answer.
 *
 * It used to be a currency dropdown under that heading: the question said
 * "where" and the answers said KRW, JPY, USD. Nobody plans a trip to a
 * three-letter code. The country is now the question and the trip currency
 * falls out of it, stated back to the user so the derivation is visible
 * rather than magic.
 *
 * The city is a LABEL. It names the trip on screen and touches no money, no
 * rate and no date, so it is never required and the list is a shortlist
 * rather than a gazetteer.
 *
 * Flags are regional-indicator emoji built from the country code — no asset,
 * no request, and they inherit the system font. (Windows renders them as
 * bare letters; every phone this app targets draws the flag.)
 */
export function DestinationPicker({
  labels,
  defaultCountry,
  defaultCity,
  idPrefix = 'trip',
}: {
  labels: DestinationLabels
  defaultCountry?: string | null
  defaultCity?: string | null
  /** Distinguishes the two instances when both render on one page. */
  idPrefix?: string
}) {
  // The list is stored with English names; a Korean reader wants 일본, not
  // Japan. Intl has the names for every locale, so the data stays one column.
  const locale = useLocale()
  const [country, setCountry] = useState(defaultCountry ?? '')
  // Only meaningful while the country is unchanged; picking a new country
  // clears it, since "Kyoto" in Thailand would be nonsense.
  const [city, setCity] = useState(defaultCity ?? '')
  const selected = destinationFor(country)
  const localisedDestinations = [...DESTINATIONS]
    .map((destination) => ({
      ...destination,
      shown: countryName(destination.code, locale) ?? destination.name,
    }))
    .sort((a, b) => a.shown.localeCompare(b.shown, locale))

  const selectClass =
    'h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base ' +
    'outline-none transition-[color,box-shadow] focus-visible:border-ring ' +
    'focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-country`}>{labels.country}</label>
        <select
          id={`${idPrefix}-country`}
          name="tripCountry"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value)
            setCity('')
          }}
          className={selectClass}
          data-testid="trip-country"
        >
          <option value="">{labels.countryNone}</option>
          {localisedDestinations.map((destination) => (
            <option key={destination.code} value={destination.code}>
              {flagEmoji(destination.code)}{' '}
              {destination.shown}
            </option>
          ))}
        </select>
        {selected ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="trip-currency-note"
          >
            {labels.currencyNote.replace('{currency}', selected.currency)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{labels.help}</span>
        )}
      </div>

      {selected ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-city`}>{labels.city}</label>
          <select
            id={`${idPrefix}-city`}
            name="tripCity"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={selectClass}
            data-testid="trip-city"
          >
            <option value="">{labels.cityNone}</option>
            {selected.cities.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        // Keep the field in the payload so clearing the country clears the
        // city too, rather than stranding a city in a country nobody picked.
        <input type="hidden" name="tripCity" value="" />
      )}
    </div>
  )
}
