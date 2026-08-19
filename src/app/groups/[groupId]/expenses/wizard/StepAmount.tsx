'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CURATED_CURRENCIES } from '@/lib/currencies'
import { NumberField } from './NumberField'
import { RatePreview } from './RatePreview'
import type { StepProps } from './StepProps'

/**
 * Native <select> wearing the shadcn Input skin. The native picker is a
 * better phone experience than a Radix listbox, so this is the one control
 * that stays native — the styling still comes from the design tokens.
 */
export const SELECT_CLASS =
  'h-13 rounded-lg border border-input bg-transparent px-3 text-base ' +
  'outline-none transition-[color,box-shadow] focus-visible:border-ring ' +
  'focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

/**
 * Step 1 — what was paid, and when.
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
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <NumberField
              id="amount"
              label={t('amount')}
              value={state.amount}
              onChange={(amount) => patch({ amount })}
              unit={state.currency}
              required
              className="min-w-0 flex-1"
              inputClassName="h-13 w-full text-2xl font-bold"
              testId="amount"
            />
            <select
              value={state.currency}
              onChange={(e) => patch({ currency: e.target.value })}
              disabled={Boolean(expenseId)}
              aria-label={t('currency')}
              className={SELECT_CLASS + ' w-24'}
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
        </CardContent>
      </Card>

      <div className="flex flex-col gap-1.5 text-sm">
        <Label htmlFor="when">{t('when')}</Label>
        {/* Controlled, but seeded with the instant rendered in UTC so the
            server and the first client render agree; the shell rewrites it
            in the device's timezone once, after mount. */}
        <Input
          id="when"
          type="datetime-local"
          value={state.timestamp}
          onChange={(e) => patch({ timestamp: e.target.value })}
          required
          className="h-13"
          data-testid="timestamp"
        />
      </div>
    </div>
  )
}
