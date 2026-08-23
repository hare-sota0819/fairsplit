'use client'

import { useActionState } from 'react'
import { StatementField } from '@/components/StatementField'
import { SubmitButton } from '@/components/SubmitButton'
import type { AuthFormState } from '@/app/(auth)/signup/actions'

type Action = (
  prev: AuthFormState,
  formData: FormData,
) => Promise<AuthFormState>

export function CredentialsForm({
  action,
  fields,
  labels,
  submitLabel,
  callbackUrl,
}: {
  action: Action
  fields: ('name' | 'email' | 'password')[]
  labels: Record<string, string>
  submitLabel: string
  callbackUrl: string
}) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    action,
    {},
  )
  return (
    <form action={formAction} className="flex w-full flex-col gap-7">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {fields.map((name) => (
        <StatementField
          key={name}
          id={`auth-${name}`}
          name={name}
          label={labels[name]}
          type={name === 'name' ? 'text' : name}
          required
          minLength={name === 'password' ? 8 : undefined}
        />
      ))}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <SubmitButton
        pending={pending}
        variant="statement"
        size="text"
        className="w-fit"
      >
        {submitLabel}
        <span aria-hidden="true">&rarr;</span>
      </SubmitButton>
    </form>
  )
}
