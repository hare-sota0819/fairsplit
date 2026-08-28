'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { Input } from '@/components/ui/input'
import type { GroupFormState } from './actions'

export interface GroupFormLabels {
  name: string
  namePlaceholder: string
  submit: string
  cancel: string
}

/**
 * One field, one action. The statement grammar owns the styling (underline
 * Input, micro-label); this file owns the rhythm: label -> field -> a
 * submit row where the primary action is the only ink on the line.
 */
export function GroupForm({
  action,
  labels,
}: {
  action: (prev: GroupFormState, formData: FormData) => Promise<GroupFormState>
  labels: GroupFormLabels
}) {
  const [state, formAction, pending] = useActionState<GroupFormState, FormData>(
    action,
    {},
  )
  return (
    <form action={formAction} className="flex w-full flex-col">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.12em] text-[#a8a8a8]">
          {labels.name}
        </span>
        <Input
          name="name"
          type="text"
          required
          autoFocus
          placeholder={labels.namePlaceholder}
          className="text-[19px] md:text-[19px]"
        />
      </label>
      {state.error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <div className="mt-9 flex flex-col gap-5 sm:flex-row sm:items-baseline sm:gap-7">
        <SubmitButton pending={pending} size="hero">
          {labels.submit}
        </SubmitButton>
        <Link
          href="/groups"
          data-testid="cancel-group"
          className="inline-flex min-h-11 items-center justify-center text-[13.5px] text-[#a8a8a8] transition-colors duration-fast hover:text-[#565656] sm:min-h-0 sm:justify-start"
        >
          {labels.cancel}
        </Link>
      </div>
    </form>
  )
}
