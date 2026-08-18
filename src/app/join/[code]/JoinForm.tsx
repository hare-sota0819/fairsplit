'use client'

import { useActionState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { Input } from '@/components/ui/input'
import type { JoinFormState } from './actions'

export function JoinForm({
  action,
  code,
  defaultName,
  label,
  submitLabel,
}: {
  action: (prev: JoinFormState, formData: FormData) => Promise<JoinFormState>
  code: string
  defaultName: string
  label: string
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState<JoinFormState, FormData>(
    action,
    {},
  )
  return (
    <form action={formAction} className="flex w-64 flex-col gap-3">
      <input type="hidden" name="code" value={code} />
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <Input
          name="displayName"
          type="text"
          required
          defaultValue={defaultName}
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
