'use client'

import { useActionState, useState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SettingsFormState } from './actions'

export interface DangerLabels {
  title: string
  leave: string
  leaveConfirm: string
  leaveLast: string
  leaveLastConfirm: string
  confirm: string
  cancel: string
  delete: string
  deleteDesc: string
  deletePrompt: string
  deleteConfirm: string
}

/**
 * Both destructive actions are two-step: the first press only reveals the
 * consequence, so nothing irreversible is ever one tap away. Delete adds a
 * typed-name gate on top because it takes everyone else's data with it.
 */
export function DangerZone({
  leaveAction,
  deleteAction,
  groupId,
  groupName,
  isCreator,
  isLastMember,
  labels,
}: {
  leaveAction: (formData: FormData) => Promise<void>
  deleteAction: (
    prev: SettingsFormState,
    formData: FormData,
  ) => Promise<SettingsFormState>
  groupId: string
  groupName: string
  isCreator: boolean
  isLastMember: boolean
  labels: DangerLabels
}) {
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteState, deleteFormAction, deletePending] = useActionState<
    SettingsFormState,
    FormData
  >(deleteAction, {})

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-destructive">{labels.title}</h2>

      {leaveOpen ? (
        <form action={leaveAction} className="flex flex-col gap-2">
          <input type="hidden" name="groupId" value={groupId} />
          <p className="text-sm text-muted-foreground">
            {isLastMember ? labels.leaveLastConfirm : labels.leaveConfirm}
          </p>
          <div className="flex items-center gap-2">
            <SubmitButton
              variant="destructive"
              testId="leave-confirm"
              data-fixed-rule=""
            >
              {labels.confirm}
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLeaveOpen(false)}
            >
              {labels.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="touch"
          className="w-full"
          data-testid="leave-group"
          onClick={() => setLeaveOpen(true)}
        >
          {isLastMember ? labels.leaveLast : labels.leave}
        </Button>
      )}

      {isCreator ? (
        deleteOpen ? (
          <form action={deleteFormAction} className="flex flex-col gap-2">
            <input type="hidden" name="groupId" value={groupId} />
            <p className="text-sm text-muted-foreground">{labels.deleteDesc}</p>
            <label className="flex flex-col gap-1 text-sm">
              {labels.deletePrompt}
              <Input
                name="confirmName"
                placeholder={groupName}
                autoComplete="off"
                className="h-11"
                data-testid="delete-confirm-name"
              />
            </label>
            {deleteState.error ? (
              <p role="alert" className="text-sm text-destructive">
                {deleteState.error}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <SubmitButton
                pending={deletePending}
                variant="destructive"
                testId="delete-confirm"
                data-fixed-rule=""
              >
                {labels.deleteConfirm}
              </SubmitButton>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDeleteOpen(false)}
              >
                {labels.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="w-full"
            data-testid="delete-group"
            onClick={() => setDeleteOpen(true)}
          >
            {labels.delete}
          </Button>
        )
      ) : null}
    </section>
  )
}
