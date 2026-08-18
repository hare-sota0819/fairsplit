'use client'

import { useActionState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    <form action={formAction} className="flex w-72 flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {fields.map((name) => (
        <div key={name} className="flex flex-col gap-1.5">
          <Label htmlFor={`auth-${name}`}>{labels[name]}</Label>
          <Input
            id={`auth-${name}`}
            name={name}
            type={name === 'name' ? 'text' : name}
            required
            minLength={name === 'password' ? 8 : undefined}
            className="h-11"
          />
        </div>
      ))}
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
