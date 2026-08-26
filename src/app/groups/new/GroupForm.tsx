'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { Input, SELECT_FIELD } from '@/components/ui/input'
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

/**
 * The create form in the statement grammar. Every field is a run of text on
 * a hairline (ui/input.tsx owns that); this file only supplies the rhythm:
 * uppercase micro-labels, 36px between fields, and a submit row where the
 * primary action is the only ink on the line.
 */
const MICRO_LABEL =
  'text-xs uppercase tracking-[0.12em] text-[#a8a8a8]'

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
    <form action={formAction} className="flex w-full flex-col gap-9">
      <label className="flex flex-col gap-1">
        <span className={MICRO_LABEL}>{labels.name}</span>
        <Input name="name" type="text" required className="text-[19px] md:text-[19px]" />
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="currency" className={MICRO_LABEL}>
          {labels.currency}
        </label>
        <select
          id="currency"
          name="currency"
          defaultValue="KRW"
          className={SELECT_FIELD}
        >
          {CURATED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>
      <DestinationPicker labels={labels.destination} idPrefix="trip" />
      <label className="flex flex-col gap-1">
        <span className={MICRO_LABEL}>{labels.displayName}</span>
        <Input name="displayName" type="text" required defaultValue={defaultDisplayName} />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {/* The submit row. On mobile the SubmitButton is the full-width
          ink-framed bar and the cancel link sits under it; on desktop they
          share a baseline, primary first. */}
      <div className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-baseline sm:gap-7">
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
