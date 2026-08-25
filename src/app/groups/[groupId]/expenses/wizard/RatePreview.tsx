'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Spinner } from '@/components/loaders'
import { Money } from '@/components/Money'
import { formatMinor } from '@/lib/format'
import { quoteUnitFor, storageRateToDisplay } from '@/lib/rate-units'
import type { StepProps } from './StepProps'

/**
 * The live conversion, its rate, and how fresh that rate actually is.
 *
 * The reported defect was the app showing "100 JPY = 900.93 KRW" against
 * Google's 918.82. The number was not wrong, it was OLD: a daily reference
 * fixing publishes on business days only, so on a Monday morning the newest
 * available one is Friday's. Phase 4D-A replaced the source with one that
 * restamps every minute, so the caption now shows that timestamp when there
 * is one. It still names the DAY instead whenever the daily-fixing fallback
 * answered — a stale rate must never be captioned as live.
 */
export function RatePreview({
  math,
  market,
  marketLoading,
  settlementCurrency,
  currency,
}: Pick<StepProps, 'math' | 'market' | 'marketLoading'> & {
  settlementCurrency: string
  currency: string
}) {
  const t = useTranslations('expenses.form')
  const tChip = useTranslations('rateChip')
  const locale = useLocale()
  if (!math.foreign) {
    return null
  }
  // Paid from several places: there is no single rate to state, so the
  // portions state themselves. Naming one rate here would be the same lie
  // the split exists to remove.
  if (math.rateSource === 'SPLIT_FUNDING') {
    return (
      <div className="flex flex-col gap-1 text-sm" data-testid="rate-preview">
        {math.total !== null ? (
          <span data-testid="converted-preview">
            <Money size="lg" className="text-foreground">
              {t('convertedPreview', {
                amount: formatMinor(math.total, settlementCurrency),
              })}
            </Money>
          </span>
        ) : null}
        <ul
          className="flex flex-col gap-0.5 text-[12px] text-[#a8a8a8]"
          data-testid="rate-portions"
        >
          {math.portions.map((portion) => (
            <li key={portion.key}>
              {t('splitPortion', {
                amount: formatMinor(portion.amount, currency),
                rate: portion.rate
                  ? `${quoteUnitFor(currency) === 1 ? '' : quoteUnitFor(currency).toLocaleString('en')} ${currency} = ${storageRateToDisplay(portion.rate, currency) ?? '?'} ${settlementCurrency}`
                  : '?',
              })}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // A bank-billed figure IS the conversion, so it stands on its own even
  // when the market lookup failed.
  const bankBilled = math.rateSource === 'ACTUAL_CHARGED'
  if (math.effectiveRate === null && !bankBilled) {
    return marketLoading ? (
      <span className="flex items-center gap-2 text-[12px] text-[#a8a8a8]">
        <Spinner /> {t('rateLoading')}
      </span>
    ) : (
      <span className="text-sm text-notice" data-testid="rate-unavailable">
        {t('rateUnavailableInline', { currency })}
      </span>
    )
  }

  const quoteUnit = quoteUnitFor(currency)
  const unit = quoteUnit === 1 ? '' : quoteUnit.toLocaleString('en')
  const rate =
    (math.effectiveRate &&
      storageRateToDisplay(math.effectiveRate, currency)) ||
    '?'
  // The as-of caption only applies to a looked-up market rate: a wallet's
  // average cost is not dated, and a hand-typed override is the user's own.
  const lookedUp = math.rateSource !== 'WALLET_AVG_COST'
  const dated =
    lookedUp &&
    market?.asOf != null &&
    market.today != null &&
    market.asOf !== market.today
      ? market.asOf
      : null
  // A source timestamp only means "live" while the rate IS today's; the
  // fallback's older date takes precedence over it.
  const liveAt =
    dated === null && lookedUp && market?.asOfInstant
      ? formatLiveTime(market.asOfInstant)
      : null

  // WHICH rate this is, named out loud. An unlabelled number is how this
  // project has produced silent errors before: the same "≈ ₩x" line means a
  // different thing on step 1 (market) than after a wallet is chosen, and
  // the user has no way to tell the two apart unless it says so.
  const sourceLabel =
    math.rateSource === 'WALLET_AVG_COST' && math.wallet
      ? tChip('withLabel', { label: math.wallet.label })
      : math.rateSource === 'OWN_EXCHANGE_RATE'
        ? tChip('OWN_EXCHANGE_RATE')
        : bankBilled
          ? null
          : tChip('MARKET_SNAPSHOT')

  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="rate-preview">
      <span className="flex flex-wrap items-baseline gap-x-2">
        {math.total !== null ? (
          <span data-testid="converted-preview">
            <Money size="lg" className="text-foreground">
              {t('convertedPreview', {
                amount: formatMinor(math.total, settlementCurrency),
              })}
            </Money>
          </span>
        ) : null}
        {bankBilled ? null : (
          <span className="text-[12px] text-[#a8a8a8]">
            {t('ratePreview', {
              unit,
              currency,
              rate,
              settlement: settlementCurrency,
            })}
          </span>
        )}
      </span>
      {sourceLabel ? (
        <span
          className="text-[12px] text-[#a8a8a8]"
          data-testid="rate-source-label"
        >
          {sourceLabel}
        </span>
      ) : null}
      <span className="text-[12px] text-[#a8a8a8]">
        {bankBilled ? (
          <span>{tChip('explain.ACTUAL_CHARGED')}</span>
        ) : math.rateSource === 'WALLET_AVG_COST' ||
          math.rateSource === 'OWN_EXCHANGE_RATE' ? null : dated ? (
          <span data-testid="rate-as-of">
            {t('rateAsOf', { date: formatAsOf(dated, locale) })}
          </span>
        ) : !lookedUp ? null : liveAt ? (
          <span data-testid="rate-live-at">
            {t('rateLiveAt', { time: liveAt })}
          </span>
        ) : (
          <span>{t('rateToday')}</span>
        )}
      </span>
      {math.rateSource === 'WALLET_AVG_COST' ||
      math.rateSource === 'OWN_EXCHANGE_RATE' ||
      bankBilled ? null : (
        <p className="text-[12px] leading-relaxed text-[#a8a8a8]">
          {t('rateBasis')}
        </p>
      )}
    </div>
  )
}

/**
 * "2026-08-03T03:03:00.000Z" -> "12:03" on a Seoul phone. Rendered in the
 * DEVICE's timezone, like every other time in this app: the point of the
 * caption is "this is from a moment ago", which only reads that way against
 * the clock the user is looking at. Client-only — `market` arrives from a
 * fetch after mount, so there is no server render to mismatch.
 */
export function formatLiveTime(instant: string): string | null {
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  // No locale needed: `hour12: false` pins this to "12:03" in both languages.
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

/**
 * "2026-07-31" -> "Jul 31", or "7월 31일" in Korean. Parsed as UTC noon so no
 * timezone shifts it.
 */
export function formatAsOf(isoDate: string, locale: string): string {
  const parsed = new Date(`${isoDate}T12:00:00Z`)
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}
