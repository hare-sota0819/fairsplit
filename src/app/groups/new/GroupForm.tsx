'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DestinationPicker,
  type DestinationLabels,
} from '@/components/DestinationPicker'
import { CURATED_CURRENCIES } from '@/lib/currencies'
import type { GroupFormState } from './actions'

export interface GroupFormLabels {
  name: string
  currency: string
  destination: DestinationLabels
  displayName: string
  submit: string
  cancel: string
}

export function GroupForm({
  action,
  labels,
  defaultDisplayName,
}: {
  action: (prev: GroupFormState, formData: FormData) => Promise<GroupFormState>
  labels: GroupFormLabels
  defaultDisplayName: string
}) {
  const [state, formAction, pending] = useActionState<GroupFormState, FormData>(
    action,
    {},
  )
  return (
    <form action={formAction} className="flex w-72 flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {labels.name}
        <Input name="name" type="text" required className="h-11" />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="currency">{labels.currency}</label>
        <select
          id="currency"
          name="currency"
          defaultValue="KRW"
          className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {CURATED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>
      <DestinationPicker labels={labels.destination} idPrefix="trip" />
      <label className="flex flex-col gap-1 text-sm">
        {labels.displayName}
        <Input
          name="displayName"
          type="text"
          required
          defaultValue={defaultDisplayName}
          className="h-11"
        />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <SubmitButton pending={pending} size="hero">
        {labels.submit}
      </SubmitButton>
      <Link
        href="/groups"
        className={buttonVariants({ variant: 'ghost', size: 'touch' })}
        data-testid="cancel-group"
      >
        {labels.cancel}
      </Link>
    </form>
  )
}
