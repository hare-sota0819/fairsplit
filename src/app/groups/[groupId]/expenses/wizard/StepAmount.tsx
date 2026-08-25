'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CURATED_CURRENCIES } from '@/lib/currencies'
import { NumberField } from './NumberField'
import { RatePreview } from './RatePreview'
import type { StepProps } from './StepProps'

/**
 * The step's field labels (FIXES §4): 12px, .12em tracking, uppercase,
 * #a8a8a8 — the same caption the reference sets every section in.
 */
export const FIELD_LABEL =
  'text-[12px] leading-none tracking-[0.12em] text-[#a8a8a8] uppercase'

/**
 * The currency picker (FIXES §4): a secondary-tier underlined text button,
 * no box and no chevron. It stays a native <select> so the phone gets its
 * own picker — the element is invisible, the value beneath it is the
 * control you see.
 */
export const SELECT_CLASS =
  'appearance-none cursor-pointer rounded-none border-0 bg-transparent px-0 py-[9px] text-[15px] text-[#8a8a8a] outline-none ' +
  'bg-[linear-gradient(var(--foreground),var(--foreground))] bg-[length:0%_1px] bg-[position:left_bottom_7px] bg-no-repeat ' +
  'transition-[background-size,color] duration-[250ms] ease-swift ' +
  'hover:bg-[length:100%_1px] hover:text-foreground focus-visible:bg-[length:100%_1px] focus-visible:text-foreground ' +
  'disabled:cursor-default disabled:text-[#c8c8c8] disabled:bg-none'

/**
 * Step 1 — what was paid, and when.
 *
 * NO CARD (FIXES §4). The bordered box around the step is gone; the page is
 * the surface, and every field is an underline with a meta caption above it.
 *
 * The date sits HERE, not collapsed at the foot of the form as it used to:
 * it is part of what the expense is, and a wrong one is invisible until the
 * feed looks strange days later.
 */
export function StepAmount({
  state,
  patch,
  data,
  math,
  market,
  marketLoading,
  expenseId,
}: StepProps) {
  const t = useTranslations('expenses.form')
  const settlement = data.defaults.settlementCurrency

  return (
    <div className="flex flex-col gap-7">
      {/* WHAT it was, before how much (owner sketch, 2026-08-22): this
          one line is the expense's name everywhere else in the app —
          the receipt heading, the "my spending" rows, the duplicate
          warning — and asking for it on the last step meant most
          expenses ended up named after a receipt line or nothing at
          all. It is still optional; an unnamed expense falls back to
          the first item, then to the payer. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="note" className={FIELD_LABEL}>
          {t('note')}
        </Label>
        <Input
          id="note"
          value={state.note}
          onChange={(e) => patch({ note: e.target.value })}
          placeholder={t('notePlaceholder')}
          data-testid="note"
        />
      </div>

      <div className="flex items-end gap-4">
        {/* No `unit`: the currency is stated once, by the picker beside
            it — the field used to print "EUR" and then the select printed
            "EUR" again. */}
        <NumberField
          id="amount"
          label={t('amount')}
          labelClassName={FIELD_LABEL}
          value={state.amount}
          onChange={(amount) => patch({ amount })}
          required
          className="min-w-0 flex-1"
          inputClassName="w-full text-2xl"
          testId="amount"
        />
        <select
          value={state.currency}
          onChange={(e) => patch({ currency: e.target.value })}
          disabled={Boolean(expenseId)}
          aria-label={t('currency')}
          className={SELECT_CLASS}
        >
          {CURATED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      {state.amount.trim().startsWith('-') ? (
        <span className="text-xs text-notice" data-testid="refund-hint">
          {t('refundHint')}
        </span>
      ) : null}

      <RatePreview
        math={math}
        market={market}
        marketLoading={marketLoading}
        settlementCurrency={settlement}
        currency={state.currency}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor="when" className={FIELD_LABEL}>
          {t('when')}
        </Label>
        {/* Controlled, but seeded with the instant rendered in UTC so the
            server and the first client render agree; the shell rewrites it
            in the device's timezone once, after mount. */}
        <Input
          id="when"
          type="datetime-local"
          value={state.timestamp}
          onChange={(e) => patch({ timestamp: e.target.value })}
          required
          data-testid="timestamp"
        />
      </div>
    </div>
  )
}
