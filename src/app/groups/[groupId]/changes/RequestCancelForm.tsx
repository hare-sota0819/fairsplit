'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import type { ChangeFormState } from './actions'

type Action = (
  prev: ChangeFormState,
  formData: FormData,
) => Promise<ChangeFormState>

/**
 * Asking to cancel — or to bring back — an expense a checkpoint has settled.
 *
 * It looks like the ordinary cancel button and behaves like one right up to
 * the point where somebody else's money is involved: if nobody ends up worse
 * off it simply happens, and only otherwise does it become a request. Which of
 * the two occurred is what the result line says, because "done" and "asked"
 * are very different answers to the same press.
 */
export function RequestCancelForm({
  action,
  groupId,
  expenseId,
  cancelled,
}: {
  action: Action
  groupId: string
  expenseId: string
  cancelled: boolean
}) {
  const t = useTranslations('changes')
  const [state, formAction, pending] = useActionState<
    ChangeFormState,
    FormData
  >(action, {})

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="expenseId" value={expenseId} />
      <input
        type="hidden"
        name="restore"
        value={cancelled ? 'true' : 'false'}
      />
      <SubmitButton
        pending={pending}
        variant="outline"
        busyLabel={t('submitting')}
        testId="request-cancel"
      >
        {cancelled ? t('requestRestore') : t('requestCancel')}
      </SubmitButton>
      {state.error ? (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="request-error"
        >
          {state.error}
        </p>
      ) : null}
      {state.applied ? (
        <p className="text-sm" role="status" data-testid="request-applied">
          {t('appliedNoConsent')}
        </p>
      ) : null}
      {state.requested ? (
        <p className="text-sm" role="status" data-testid="request-opened">
          {t('opened')}
        </p>
      ) : null}
    </form>
  )
}
