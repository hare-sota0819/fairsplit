'use client'

import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { setActualCharged, type BankChargedState } from './actions'
import { SubmitButton } from '@/components/SubmitButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseAmountToMinor } from '@/lib/format'
import { quoteUnitFor, storageRateToDisplay } from '@/lib/rate-units'
import { rateToDecimalString } from '@/lib/settlement'

const abs = (x: bigint): bigint => (x < 0n ? -x : x)

/**
 * The bank-statement correction, framed as a LATER step: the payer types in
 * what their card statement actually billed once it posts, days after the
 * expense was entered. Renders from the action's returned state rather than
 * `router.refresh()` — that call does not reliably re-render this route
 * (see docs/STATUS.md).
 */
export function BankChargedForm({
  groupId,
  expenseId,
  currency,
  settlementCurrency,
  foreignAmount,
  initialDecimal,
  initialFormatted,
}: {
  groupId: string
  expenseId: string
  /** The expense's own (foreign) currency. */
  currency: string
  settlementCurrency: string
  /** expense.amount, as a bigint decimal string (sign preserved). */
  foreignAmount: string
  /** Decimal prefill for the input, in settlement-currency major units. */
  initialDecimal: string
  /** Formatted current actualChargedAmount, or null if unset. */
  initialFormatted: string | null
}) {
  const t = useTranslations('expenses.detail.bankCharged')
  const [value, setValue] = useState(initialDecimal)
  const [state, formAction] = useActionState<BankChargedState, FormData>(
    setActualCharged,
    {},
  )

  const current = state.saved ? state.amount || null : initialFormatted

  const foreignAmountMinor = BigInt(foreignAmount)
  const charged = parseAmountToMinor(value, settlementCurrency)
  const unit = quoteUnitFor(currency)
  const unitLabel = unit === 1 ? '' : unit.toLocaleString('en')
  const implied =
    charged !== null && charged !== 0n && foreignAmountMinor !== 0n
      ? storageRateToDisplay(
          rateToDecimalString(
            { numerator: abs(charged), denominator: abs(foreignAmountMinor) },
            settlementCurrency,
            currency,
            10,
          ),
          currency,
        )
      : null

  return (
    <section
      className="flex flex-col gap-2 rounded-xl bg-card p-4 text-sm shadow-sm"
      data-testid="bank-charged"
    >
      <h2 className="font-medium">{t('title')}</h2>
      <p className="text-muted-foreground">{t('prompt')}</p>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
      {current ? (
        <p className="text-xs text-muted-foreground">
          {t('current', { amount: current })}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="expenseId" value={expenseId} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-charged-amount">{t('label')}</Label>
          <Input
            id="bank-charged-amount"
            name="actualCharged"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-11"
            data-testid="bank-charged-input"
          />
        </div>
        {implied ? (
          <p className="text-xs text-muted-foreground">
            {t('implied', {
              unit: unitLabel,
              currency,
              rate: implied,
              settlement: settlementCurrency,
            })}
          </p>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-xs text-destructive">
            {state.error}
          </p>
        ) : null}
        {state.saved ? (
          <p className="text-xs text-positive" data-testid="bank-charged-saved">
            {t('saved')}
          </p>
        ) : null}
        <SubmitButton
          variant="outline"
          size="sm"
          className="w-full"
          testId="bank-charged-save"
        >
          {t('save')}
        </SubmitButton>
      </form>

      {current ? (
        // Empty the visible field too, or clearing leaves a figure on screen
        // that the expense is no longer using.
        <form action={formAction} onSubmit={() => setValue('')}>
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="expenseId" value={expenseId} />
          <input type="hidden" name="actualCharged" value="" />
          <SubmitButton
            variant="ghost"
            size="sm"
            className="w-full"
            testId="bank-charged-clear"
          >
            {t('clear')}
          </SubmitButton>
        </form>
      ) : null}
    </section>
  )
}
