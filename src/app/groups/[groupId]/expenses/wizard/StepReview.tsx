'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Money } from '@/components/Money'
import { ChevronDown } from 'lucide-react'
import { formatMinor } from '@/lib/format'
import { quoteUnitFor, storageRateToDisplay } from '@/lib/rate-units'
import { roundDivHalfEven, type Ratio } from '@/lib/settlement'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { selectOnFocusProps } from './NumberField'
import { formatAsOf, formatLiveTime } from './RatePreview'
import type { StepProps } from './StepProps'

/**
 * Step 5 — the receipt check and the per-person breakdown.
 *
 * Every row opens onto the working that produced it, straight out of the
 * engine's own `explainShares`, so the explanation cannot drift from the
 * number. Where the rows do not add up to the headline — they can be a few
 * minor units over, because each share rounds up in the payer's favour — the
 * screen says so instead of hiding it.
 */
export function StepReview({ state, patch, data, math, market }: StepProps) {
  const t = useTranslations('expenses.form')
  const tChip = useTranslations('rateChip')
  const locale = useLocale()
  const settlement = data.defaults.settlementCurrency
  const nameOf = (id: string): string =>
    data.members.find((m) => m.id === id)?.name ?? '?'
  const participants = state.isPersonal ? [state.payerId] : state.participantIds

  const receiptValue = state.receiptTouched ? state.receiptTotal : state.amount
  const sum = participants.reduce(
    (total, id) => total + (math.shares.get(id) ?? 0n),
    0n,
  )
  const quoteUnit = quoteUnitFor(state.currency)
  const unit = quoteUnit === 1 ? '' : quoteUnit.toLocaleString('en')
  const rateLabel =
    math.rateSource === 'WALLET_AVG_COST' && math.wallet
      ? tChip('withLabel', { label: math.wallet.label })
      : tChip(math.rateSource)

  // Same "dated vs live vs a source timestamp" rule as RatePreview (step 1),
  // so the two screens never disagree about whether the rate is live.
  const bankBilled = math.rateSource === 'ACTUAL_CHARGED'
  const lookedUp = math.rateSource !== 'WALLET_AVG_COST'
  const dated =
    lookedUp &&
    market?.asOf != null &&
    market.today != null &&
    market.asOf !== market.today
      ? market.asOf
      : null
  const liveAt =
    dated === null && lookedUp && market?.asOfInstant
      ? formatLiveTime(market.asOfInstant)
      : null

  return (
    <div className="flex flex-col gap-6">
      {state.items.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1.5 text-sm">
            <Label htmlFor="receipt-total">{t('receiptTotal')}</Label>
            <Input
              id="receipt-total"
              inputMode="decimal"
              value={receiptValue}
              {...selectOnFocusProps}
              onChange={(e) =>
                patch({ receiptTouched: true, receiptTotal: e.target.value })
              }
              className="h-11 tabular-nums"
              data-testid="receipt-total"
            />
          </div>
          <p className="flex justify-between text-sm tabular-nums">
            <span className="text-muted-foreground">{t('itemsTotal')}</span>
            <span data-testid="review-items-total">
              {math.itemsSum === null
                ? '—'
                : formatMinor(math.itemsSum, state.currency)}
            </span>
          </p>
          {math.discrepancy !== null && math.itemsSum !== null ? (
            <p className="text-sm text-notice" data-testid="discrepancy">
              {t('discrepancy', {
                items: formatMinor(math.itemsSum, state.currency),
                receipt: formatMinor(
                  math.itemsSum - math.discrepancy,
                  state.currency,
                ),
                amount: formatMinor(
                  math.discrepancy < 0n ? -math.discrepancy : math.discrepancy,
                  state.currency,
                ),
              })}
            </p>
          ) : (
            <p className="text-sm text-positive" data-testid="discrepancy-ok">
              {t('discrepancyOk')}
            </p>
          )}
        </section>
      ) : null}

      {math.total !== null ? (
        <Card data-testid="split-preview">
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">{t('splitTitle')}</h2>
              <Money size="lg">{formatMinor(math.total, settlement)}</Money>
            </div>
            {math.foreign && math.rateSource === 'SPLIT_FUNDING' ? (
              <div
                className="flex flex-col gap-0.5 text-xs text-muted-foreground"
                data-testid="review-split-funding"
              >
                <span>{t('reviewSplitTitle')}</span>
                {math.portions.map((portion) => (
                  <span key={portion.key}>
                    {t('splitPortion', {
                      amount: formatMinor(portion.amount, state.currency),
                      rate: portion.rate
                        ? `${unit} ${state.currency} = ${storageRateToDisplay(portion.rate, state.currency) ?? '?'} ${settlement}`
                        : '?',
                    })}
                  </span>
                ))}
              </div>
            ) : math.foreign && math.effectiveRate ? (
              <div
                className="flex flex-col gap-0.5 text-xs text-muted-foreground"
                data-testid="review-rate"
              >
                <span>
                  {t('reviewConverted', {
                    amount: formatMinor(math.total, settlement),
                  })}
                </span>
                {/* Its own line: run together, the converted figure and the
                    rate that produced it read as one run-on sentence. */}
                <span>
                  {t('derivationRate', {
                    source: rateLabel,
                    unit,
                    currency: state.currency,
                    rate:
                      storageRateToDisplay(
                        math.effectiveRate,
                        state.currency,
                      ) ?? '?',
                    settlement,
                  })}
                </span>
                {math.rateSource === 'WALLET_AVG_COST' ||
                math.rateSource === 'OWN_EXCHANGE_RATE' ||
                bankBilled ? null : dated ? (
                  <span>{t('rateAsOf', { date: formatAsOf(dated, locale) })}</span>
                ) : !lookedUp ? null : liveAt ? (
                  <span>{t('rateLiveAt', { time: liveAt })}</span>
                ) : (
                  <span>{t('rateToday')}</span>
                )}
              </div>
            ) : null}
            <ul className="flex flex-col divide-y divide-border">
              {participants.map((id) => {
                const share = math.shares.get(id) ?? 0n
                const explanation = math.explanations.get(id)
                return (
                  <li key={id}>
                    <details className="group">
                      <summary
                        className="flex cursor-pointer list-none items-center justify-between gap-3 py-2.5"
                        data-testid={`split-row-${id}`}
                      >
                        <span>
                          {nameOf(id)}
                          {id === state.payerId ? (
                            <span className="ml-2 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">
                              {t('splitPaid')}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className="flex items-center gap-2"
                          data-testid={`split-share-${id}`}
                        >
                          {share === 0n ? (
                            <span className="text-muted-foreground">
                              {t('splitNothing')}
                            </span>
                          ) : (
                            <Money>{formatMinor(share, settlement)}</Money>
                          )}
                          <ChevronDown
                            aria-hidden="true"
                            className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                          />
                        </span>
                      </summary>
                      <ul
                        className="flex flex-col gap-1 pb-3 pl-1 text-xs text-muted-foreground"
                        data-testid={`derivation-${id}`}
                      >
                        {explanation?.evenSplitOf ? (
                          <li>
                            {t('derivationEven', {
                              total: formatMinor(
                                explanation.evenSplitOf.total,
                                state.currency,
                              ),
                              count: explanation.evenSplitOf.among,
                            })}
                          </li>
                        ) : null}
                        {explanation?.lines.map((line) => (
                          <li key={`${line.index}-${line.name}`}>
                            {line.splitMode === 'BY_AMOUNT'
                              ? t('derivationByAmount', {
                                  name: line.name,
                                  count: line.claimants,
                                  total: money(line.share, state.currency, t),
                                })
                              : line.quantity > 1
                                ? t('derivationItem', {
                                    name: line.name,
                                    units: line.units,
                                    total: money(line.share, state.currency, t),
                                  })
                                : t('derivationShared', {
                                    name: line.name,
                                    count: line.claimants,
                                    total: money(line.share, state.currency, t),
                                  })}
                          </li>
                        ))}
                        {explanation && explanation.unassigned.num !== 0n ? (
                          <li>
                            {t('derivationUnassigned', {
                              amount: money(
                                explanation.unassigned,
                                state.currency,
                                t,
                              ),
                            })}
                          </li>
                        ) : null}
                        <li>
                          {math.foreign &&
                          math.rateSource === 'SPLIT_FUNDING' ? (
                            <span>{t('derivationSplit')}</span>
                          ) : math.foreign && math.effectiveRate ? (
                            t('derivationRate', {
                              source: rateLabel,
                              unit,
                              currency: state.currency,
                              rate:
                                storageRateToDisplay(
                                  math.effectiveRate,
                                  state.currency,
                                ) ?? '?',
                              settlement,
                            })
                          ) : (
                            <span>{t('derivationSame')}</span>
                          )}
                        </li>
                        {id === state.payerId ? null : (
                          <li>{t('derivationRounding', { settlement })}</li>
                        )}
                      </ul>
                    </details>
                  </li>
                )
              })}
            </ul>
            <p
              className="text-xs text-muted-foreground"
              data-testid="split-sum"
            >
              {sum === math.total
                ? t('splitAgrees', {
                    amount: formatMinor(math.total, settlement),
                  })
                : t('splitAgreesRounded', {
                    sum: formatMinor(sum, settlement),
                    diff: formatMinor(sum - math.total, settlement),
                    total: formatMinor(math.total, settlement),
                  })}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-1.5 text-sm">
        <Label htmlFor="note">{t('note')}</Label>
        <Input
          id="note"
          value={state.note}
          onChange={(e) => patch({ note: e.target.value })}
          className="h-11"
          data-testid="note"
        />
      </div>
    </div>
  )
}

/**
 * An exact rational share as money. Shares of unassigned lines rarely land on
 * a whole minor unit, so a non-exact one is marked approximate rather than
 * silently rounded into looking exact.
 */
function money(
  share: Ratio,
  currency: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const rounded = roundDivHalfEven(share.num, share.den)
  const text = formatMinor(rounded, currency)
  return share.num % share.den === 0n ? text : t('approx', { amount: text })
}
