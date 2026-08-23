'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { Input } from '@/components/ui/input'
import { fromLocalInputValue, toLocalInputValue } from '@/lib/datetime'
import type { CheckpointFormState } from './actions'

type Action = (
  prev: CheckpointFormState,
  formData: FormData,
) => Promise<CheckpointFormState>

/**
 * Draw a checkpoint: a name and the instant it closes.
 *
 * The datetime input is uncontrolled and filled in by ref after mount, the
 * same shape the expense form uses — a server-rendered default would be the
 * server's wall clock, which is UTC on Vercel and wrong for everyone.
 */
export function CheckpointForm({
  action,
  groupId,
}: {
  action: Action
  groupId: string
}) {
  // Translated here rather than handed down as props: `frozen` takes a count,
  // and a function cannot cross the server/client boundary. The rest follow
  // it so the copy for one form lives in one place.
  const t = useTranslations('checkpoints')
  const router = useRouter()
  const whenRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const node = whenRef.current
    if (node && node.value === '') {
      node.value = toLocalInputValue(new Date(), new Date().getTimezoneOffset())
    }
  }, [])

  // The instant is resolved at submit time from the live offset, so the
  // barrier lands where the user thinks they put it.
  const clientAction = async (
    previous: CheckpointFormState,
    formData: FormData,
  ): Promise<CheckpointFormState> => {
    const instant = fromLocalInputValue(
      whenRef.current?.value ?? '',
      new Date().getTimezoneOffset(),
    )
    formData.set('timestamp', instant ? instant.toISOString() : '')
    return action(previous, formData)
  }

  const [state, formAction, pending] = useActionState<
    CheckpointFormState,
    FormData
  >(clientAction, {})

  // A checkpoint changes what every other screen is allowed to do with the
  // expenses behind it, so the whole tree has to re-read rather than just
  // this list.
  useEffect(() => {
    if (state.frozenCount !== undefined) {
      router.refresh()
    }
  }, [state.frozenCount, router])

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="groupId" value={groupId} />
      <label className="flex flex-col gap-1 text-sm">
        {t('name')}
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={t('namePlaceholder')}
          className="h-11"
          data-testid="checkpoint-name"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t('when')}
        <Input
          ref={whenRef}
          type="datetime-local"
          className="h-11"
          data-testid="checkpoint-when"
        />
      </label>
      <p className="text-xs text-muted-foreground">{t('warning')}</p>
      <SubmitButton
        pending={pending}
        busyLabel={t('submitting')}
        testId="checkpoint-submit"
      >
        {t('submit')}
      </SubmitButton>
      {state.error ? (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="checkpoint-error"
        >
          {state.error}
        </p>
      ) : null}
      {state.frozenCount !== undefined ? (
        <p className="text-sm" role="status" data-testid="checkpoint-saved">
          {t('frozen', { count: state.frozenCount })}
        </p>
      ) : null}
    </form>
  )
}
