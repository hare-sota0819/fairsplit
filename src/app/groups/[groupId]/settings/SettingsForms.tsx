'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useRef, useState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/Segmented'
import {
  DestinationPicker,
  type DestinationLabels,
} from '@/components/DestinationPicker'
import { CURATED_CURRENCIES } from '@/lib/currencies'
import type { SettingsFormState } from './actions'

type Action = (
  prev: SettingsFormState,
  formData: FormData,
) => Promise<SettingsFormState>

export function GroupSettingsForm({
  action,
  groupId,
  initial,
  currencyLocked,
  labels,
}: {
  action: Action
  groupId: string
  initial: {
    name: string
    currency: string
    tripCountry: string | null
    tripCity: string | null
    rateMode: 'AVG_COST' | 'MARKET'
  }
  currencyLocked: boolean
  labels: {
    groupName: string
    currency: string
    currencyLocked: string
    destination: DestinationLabels
    rateMode: string
    rateModeAvg: string
    rateModeMarket: string
    save: string
    saving: string
    saved: string
  }
}) {
  // No router.refresh() here, unlike the two forms below. Every input on this
  // form is uncontrolled, so it already shows what the user just picked; the
  // refresh only re-rendered the "Saved." line — and in doing so destroyed
  // the very confirmation it was supposed to deliver, so a save that worked
  // looked like a save that did nothing. The action's revalidatePath still
  // gives the rest of the app fresh data on its next navigation.
  const [state, formAction, pending] = useActionState<
    SettingsFormState,
    FormData
  >(action, {})
  const [rateMode, setRateMode] = useState<'AVG_COST' | 'MARKET'>(
    initial.rateMode,
  )
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="groupId" value={groupId} />
      <label className="flex flex-col gap-1 text-sm">
        {labels.groupName}
        <Input
          name="name"
          defaultValue={initial.name}
          required
          className="h-11"
        />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="settings-currency">{labels.currency}</label>
        <select
          id="settings-currency"
          name="currency"
          defaultValue={initial.currency}
          disabled={currencyLocked}
          className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {CURATED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        {currencyLocked ? (
          <span className="text-xs text-muted-foreground">
            {labels.currencyLocked}
          </span>
        ) : null}
      </div>
      {currencyLocked ? (
        <input type="hidden" name="currency" value={initial.currency} />
      ) : null}
      <DestinationPicker
        labels={labels.destination}
        defaultCountry={initial.tripCountry}
        defaultCity={initial.tripCity}
        idPrefix="settings-trip"
      />
      {/* §7 — the rate mode is a segmented control: no boxes, one 1px ink
          underline sliding to whichever option is selected. The form still
          posts a plain `rateMode` field. */}
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1">{labels.rateMode}</legend>
        <Segmented
          value={rateMode}
          onValueChange={setRateMode}
          ariaLabel={labels.rateMode}
          options={[
            { value: 'AVG_COST', label: labels.rateModeAvg },
            { value: 'MARKET', label: labels.rateModeMarket },
          ]}
        />
        <input type="hidden" name="rateMode" value={rateMode} />
      </fieldset>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p className="text-sm text-positive">{labels.saved}</p>
      ) : null}
      <SubmitButton pending={pending} busyLabel={labels.saving} size="hero">
        {labels.save}
      </SubmitButton>
    </form>
  )
}

/**
 * Self-service wallet privacy: one button toggling the acting member's
 * walletHidden flag (the action ignores any posted memberId by design).
 */
export function WalletPrivacyForm({
  action,
  groupId,
  hidden,
  labels,
}: {
  action: Action
  groupId: string
  hidden: boolean
  labels: { hideWallet: string; showWallet: string; saved: string }
}) {
  // The toggle owns its own state once pressed: a server action does not
  // re-render the route it was fired from, and this button IS the readout.
  const [isHidden, setIsHidden] = useState(hidden)
  const router = useRouter()
  const [state, formAction, pending] = useActionState<
    SettingsFormState,
    FormData
  >(async (prev, formData) => {
    const result = await action(prev, formData)
    if (result.saved) {
      setIsHidden(formData.get('hidden') === 'true')
      // Other screens (group status) read this flag too.
      router.refresh()
    }
    return result
  }, {})
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="hidden" value={isHidden ? 'false' : 'true'} />
      <SubmitButton
        pending={pending}
        variant="outline"
        className="w-full"
        testId="wallet-privacy-toggle"
      >
        {isHidden ? labels.showWallet : labels.hideWallet}
      </SubmitButton>
      {state.saved ? (
        <span className="text-sm text-positive">{labels.saved}</span>
      ) : null}
      {state.error ? (
        <span role="alert" className="text-sm text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}

export function MemberRow({
  action,
  groupId,
  member,
  labels,
}: {
  action: Action
  groupId: string
  member: { id: string; name: string; left: boolean }
  labels: {
    rename: string
    leftBadge: string
  }
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<
    SettingsFormState,
    FormData
  >(async (prev, formData) => {
    const result = await action(prev, formData)
    // Server actions must refresh the route they mutate; revalidatePath on
    // its own leaves the current segment showing pre-mutation data.
    if (result.saved) router.refresh()
    return result
  }, {})
  return (
    <form
      action={formAction}
      className="flex min-h-14 w-full items-center gap-2 px-4 py-3 text-sm"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="memberId" value={member.id} />
      <Input
        name="name"
        defaultValue={member.name}
        className="h-11 min-w-0 flex-1"
      />
      {member.left ? (
        <span className="border border-[#e4e4e4] px-2 py-0.5 text-xs text-[#8a8a8a]">
          {labels.leftBadge}
        </span>
      ) : null}
      <SubmitButton pending={pending} size="sm">
        {labels.rename}
      </SubmitButton>
      {state.error ? (
        <span role="alert" className="text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}

/**
 * "Add someone" — one name field. Deliberately a separate form from the
 * per-member rename rows above it: a rename posts a `memberId`, this posts
 * none, and merging them would make an empty field mean two things.
 */
export function AddMemberForm({
  action,
  groupId,
  labels,
}: {
  action: Action
  groupId: string
  labels: { name: string; submit: string; hint: string }
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, pending] = useActionState<
    SettingsFormState,
    FormData
  >(async (prev, formData) => {
    const result = await action(prev, formData)
    if (result.saved) {
      // Empty the field again: the name that was just added is now a row in
      // the list above, and leaving it sitting in the box is how you add
      // the same person twice.
      formRef.current?.reset()
      router.refresh()
    }
    return result
  }, {})
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input type="hidden" name="groupId" value={groupId} />
        <Input
          name="name"
          aria-label={labels.name}
          placeholder={labels.name}
          required
          maxLength={100}
          className="h-11 min-w-0 flex-1"
          data-testid="add-member-name"
        />
        <SubmitButton pending={pending} size="sm" testId="add-member-submit">
          {labels.submit}
        </SubmitButton>
      </div>
      <p className="text-xs text-muted-foreground">{labels.hint}</p>
      {state.error ? (
        <span role="alert" className="text-sm text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}
