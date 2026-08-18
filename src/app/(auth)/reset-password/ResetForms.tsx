'use client'

import { useActionState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { Input } from '@/components/ui/input'
import type { ResetFormState } from './actions'

type Action = (
  prev: ResetFormState,
  formData: FormData,
) => Promise<ResetFormState>

export function RequestResetForm({
  action,
  emailLabel,
  submitLabel,
  doneMessage,
}: {
  action: Action
  emailLabel: string
  submitLabel: string
  doneMessage: string
}) {
  const [state, formAction, pending] = useActionState<ResetFormState, FormData>(
    action,
    {},
  )
  if (state.done) {
    return <p className="w-64 text-sm">{doneMessage}</p>
  }
  return (
    <form action={formAction} className="flex w-64 flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {emailLabel}
        <Input name="email" type="email" required className="h-11" />
      </label>
      <SubmitButton pending={pending} size="hero">
        {submitLabel}
      </SubmitButton>
    </form>
  )
}

export function ConfirmResetForm({
  action,
  token,
  passwordLabel,
  submitLabel,
  doneMessage,
  signInLabel,
}: {
  action: Action
  token: string
  passwordLabel: string
  submitLabel: string
  doneMessage: string
  signInLabel: string
}) {
  const [state, formAction, pending] = useActionState<ResetFormState, FormData>(
    action,
    {},
  )
  if (state.done) {
    return (
      <p className="w-64 text-sm">
        {doneMessage}{' '}
        <a className="underline" href="/signin">
          {signInLabel}
        </a>
      </p>
    )
  }
  return (
    <form action={formAction} className="flex w-64 flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1 text-sm">
        {passwordLabel}
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          className="h-11"
        />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <SubmitButton pending={pending} size="hero">
        {submitLabel}
      </SubmitButton>
    </form>
  )
}
