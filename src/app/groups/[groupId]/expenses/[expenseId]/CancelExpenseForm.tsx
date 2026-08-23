'use client'

import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { setExpenseCancelled } from '../actions'
import { SubmitButton } from '@/components/SubmitButton'
import { Button } from '@/components/ui/button'
import { Switch, SwitchState } from '@/components/ui/switch'

/**
 * "Include in settlement" — one switch, on by default.
 *
 * This was two buttons named Cancel/Restore until the Korean translation
 * exposed the problem (docs/i18n/glossary.md §4-C): 결제 취소 means a REFUND,
 * and this refunds nothing. The money was still spent; the record still sits
 * in the feed with a note saying who took it out. All that changes is whether
 * it counts towards anybody's balance — which is a state, not an event, and a
 * switch is how you show a state.
 *
 * Turning it OFF confirms, because it moves other people's money and the
 * Phase 4A rule is that anything touching a balance asks first. Turning it
 * back ON does not: putting something back is not a thing anyone regrets.
 */
export function CancelExpenseForm({
  groupId,
  expenseId,
  cancelled,
}: {
  groupId: string
  expenseId: string
  cancelled: boolean
}) {
  const t = useTranslations('expenses.detail')
  const tCommon = useTranslations('common')
  const [confirming, setConfirming] = useState(false)
  const labelId = useId()

  const hidden = (
    <>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="expenseId" value={expenseId} />
    </>
  )

  // Off, and asking to come back on: one tap, no ceremony.
  if (cancelled) {
    return (
      <form action={setExpenseCancelled} className="mt-2">
        {hidden}
        <input type="hidden" name="cancelled" value="false" />
        <div className="flex items-center justify-between gap-3">
          <span id={labelId} className="font-medium">
            {t('cancel')}
          </span>
          <span className="flex items-center gap-4">
            <Switch
              type="submit"
              checked={false}
              aria-labelledby={labelId}
              testId="cancel-expense"
            />
            {/* §6: the state in words, meta grey, in a fixed column. */}
            <SwitchState
              on={false}
              labels={{ on: tCommon('on'), off: tCommon('off') }}
            />
          </span>
        </div>
      </form>
    )
  }

  if (!confirming) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span id={labelId} className="font-medium">
            {t('cancel')}
          </span>
          <span className="flex items-center gap-4">
            <Switch
              checked
              onCheckedChange={() => setConfirming(true)}
              aria-labelledby={labelId}
              testId="cancel-expense"
            />
            <SwitchState
              on
              labels={{ on: tCommon('on'), off: tCommon('off') }}
            />
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t('cancelHint')}</p>
      </div>
    )
  }

  return (
    <form action={setExpenseCancelled} className="mt-2 flex flex-col gap-2">
      {hidden}
      <input type="hidden" name="cancelled" value="true" />
      <p className="text-sm text-muted-foreground">{t('cancelConfirm')}</p>
      <div className="flex items-center gap-2">
        <SubmitButton
          variant="destructive"
          size="hero"
          className="flex-1"
          testId="cancel-expense-confirm"
          data-fixed-rule=""
        >
          {t('cancelConfirmAction')}
        </SubmitButton>
        {/* "Close", never "Cancel": next to a control about cancelling an
            expense, a Cancel button is asking to be misread. */}
        <Button
          type="button"
          variant="ghost"
          size="hero"
          onClick={() => setConfirming(false)}
        >
          {tCommon('close')}
        </Button>
      </div>
    </form>
  )
}
