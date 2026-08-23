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
 * A stakeholder's answer. Two buttons in one form, told apart by the value
 * they submit — approving and refusing are the same decision, and putting them
 * side by side is what makes "no" as easy to give as "yes".
 */
export function RespondForm({
  action,
  groupId,
  requestId,
}: {
  action: Action
  groupId: string
  requestId: string
}) {
  const t = useTranslations('changes')
  const [state, formAction, pending] = useActionState<
    ChangeFormState,
    FormData
  >(action, {})

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex gap-2">
        <SubmitButton
          pending={pending}
          name="approve"
          value="true"
          className="flex-1"
          busyLabel={t('submitting')}
          testId="respond-approve"
        >
          {t('approve')}
        </SubmitButton>
        <SubmitButton
          pending={pending}
          name="approve"
          value="false"
          variant="outline"
          className="flex-1"
          busyLabel={t('submitting')}
          testId="respond-reject"
        >
          {t('reject')}
        </SubmitButton>
      </div>
      {state.error ? (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="respond-error"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
