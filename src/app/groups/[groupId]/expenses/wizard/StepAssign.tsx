'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown } from 'lucide-react'
import { formatMinor, parseAmountToMinor } from '@/lib/format'
import { uniqueInitials } from '@/lib/initials'
import { allocateEveryone, assignmentStatus, lineTotal } from '@/lib/settlement'
import { QtyStepper } from './NumberField'
import type { ItemState } from './math'
import type { StepProps } from './StepProps'

/**
 * Step 4 — who had what.
 *
 * ONE control per item, not two: the old screen showed avatar chips AND a
 * row of buttons for the same choice. Rows are collapsed to their assignees
 * until tapped.
 *
 * "Split into units" is gone. It exploded a line into N unassigned rows, was
 * irreversible and one mis-tap away, and left the user worse off than before
 * they touched it. In its place each participant gets a tick, and — only
 * when the line has more than one unit — a stepper for how many they had.
 * On a single-unit line the ticks mean "we shared this", which is what a
 * checkbox has always meant.
 */
export function StepAssign({ state, patch, data }: StepProps) {
  const t = useTranslations('expenses.form')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState('')

  const nameOf = (id: string): string =>
    data.members.find((m) => m.id === id)?.name ?? '?'
  const participants = state.isPersonal ? [state.payerId] : state.participantIds
  const initials = uniqueInitials(participants.map(nameOf))
  const initialOf = (id: string): string =>
    initials.get(nameOf(id)) ?? nameOf(id)

  const patchItem = (key: number, change: Partial<ItemState>) =>
    patch({
      items: state.items.map((item) =>
        item.key === key ? { ...item, ...change } : item,
      ),
    })

  // One row open at a time. Two expanded rows put two identical rosters of
  // the same names on screen at once, and the tick you are about to make
  // belongs to whichever heading you have already scrolled past — the Done
  // button has always closed as it advanced for exactly that reason, and
  // tapping a heading was the one path that did not.
  //
  // Every path that changes which row is open also clears the name filter.
  // `participants` is one shared list, so a carried-over filter would still
  // match the same names on the next item — it isn't stale in that sense —
  // but each newly opened row starts from a full roster on purpose: a filter
  // left over from a row the user is no longer looking at is an easy thing
  // to forget about, and forgetting it makes the next row's list look
  // shorter than it really is.
  const toggleOpen = (key: number) => {
    setOpen((previous) => (previous.has(key) ? new Set() : new Set([key])))
    setFilter('')
  }

  /**
   * Close this row and open the next item nobody has been assigned to.
   * Ticking a name for every line of a receipt is the common case, and
   * hunting for the next unassigned row between each one is the tedious part.
   *
   * The search wraps around: items opened out of order (the user jumps ahead
   * to item 4, finishes it, presses Done) must still surface an unassigned
   * item sitting earlier in the list, not just later. Looking forward only
   * would leave the accordion fully closed with unassigned rows still above,
   * which is exactly the scrolling this button exists to avoid.
   */
  const closeAndAdvance = (key: number) => {
    const index = state.items.findIndex((item) => item.key === key)
    const next =
      state.items
        .slice(index + 1)
        .find((item) => item.assignees.length === 0) ??
      state.items.slice(0, index).find((item) => item.assignees.length === 0)
    setOpen(next ? new Set([next.key]) : new Set())
    setFilter('')
  }

  // Any hand assignment is a per-person statement of who took what, so it
  // always means BY_QUANTITY — including when it lands on a line "Everyone"
  // had just divided by money.
  const toggleMember = (item: ItemState, memberId: string) => {
    const has = item.assignees.some((a) => a.memberId === memberId)
    patchItem(item.key, {
      splitMode: 'BY_QUANTITY',
      assignees: has
        ? item.assignees.filter((a) => a.memberId !== memberId)
        : [...item.assignees, { memberId, quantity: 1 }],
    })
  }

  const setMemberQty = (item: ItemState, memberId: string, quantity: number) =>
    patchItem(item.key, {
      splitMode: 'BY_QUANTITY',
      assignees: item.assignees.map((a) =>
        a.memberId === memberId ? { ...a, quantity } : a,
      ),
    })

  /**
   * "Everyone" means the line was SHARED, so it divides the line rather than
   * handing out one unit each and leaving the rest dangling. Whole units
   * where they go round (4 between 2 is 2 each); the line's money where they
   * do not (5 between 2), which is what BY_AMOUNT records.
   */
  const assignEveryone = (item: ItemState) => {
    const all = item.assignees.length === participants.length
    if (all) {
      patchItem(item.key, { splitMode: 'BY_QUANTITY', assignees: [] })
      return
    }
    const unit = parseAmountToMinor(item.unitAmount, state.currency)
    const divided = allocateEveryone(
      { quantity: item.quantity, unitAmount: unit ?? 0n },
      participants,
      state.payerId,
    )
    patchItem(item.key, {
      splitMode: divided.splitMode,
      assignees: divided.assignees.map((a) => ({
        memberId: a.memberId,
        quantity: a.quantity,
      })),
    })
  }

  if (state.items.length === 0) {
    return (
      <p
        className="px-5 py-10 text-center text-sm text-muted-foreground"
        data-testid="nothing-to-assign"
      >
        {t('noItemsToAssign')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="-mx-5 divide-y divide-border">
        {state.items.map((item) => {
          const unit = parseAmountToMinor(item.unitAmount, state.currency)
          const total =
            unit === null
              ? null
              : lineTotal({ unitAmount: unit, quantity: item.quantity })
          const assigned = item.assignees.reduce(
            (sum, a) => sum + a.quantity,
            0,
          )
          const status = assignmentStatus({
            name: item.name,
            unitAmount: unit ?? 0n,
            quantity: item.quantity,
            splitMode: item.splitMode,
            assignees: item.assignees.map((a) => ({
              ...a,
              // Under BY_AMOUNT a claim is a money share, and the amounts
              // are derived on demand rather than held in form state; any
              // non-zero stand-in says the same thing to `assignmentStatus`.
              ...(item.splitMode === 'BY_AMOUNT' ? { amount: 1n } : {}),
            })),
          })
          const splitByAmount = item.splitMode === 'BY_AMOUNT'
          const expanded = open.has(item.key)
          return (
            <li key={item.key} data-testid="assign-row">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleOpen(item.key)}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted"
                data-testid="assign-toggle"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-medium">
                    {item.name || t('itemName')}
                    {item.quantity > 1 ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ×{item.quantity}
                      </span>
                    ) : null}
                  </span>
                  {item.assignees.length === 0 ? (
                    <span
                      className="w-fit rounded-full bg-negative-soft px-2 py-0.5 text-xs font-semibold text-negative"
                      data-testid="unassigned-badge"
                    >
                      {t('unassigned')}
                    </span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {item.assignees.map((assignee) => (
                        <span
                          key={assignee.memberId}
                          className="flex h-6 items-center gap-0.5 rounded-full bg-primary/12 px-2 text-xs font-semibold text-primary"
                        >
                          {initialOf(assignee.memberId)}
                          {item.quantity > 1 ? `×${assignee.quantity}` : null}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {total === null ? null : (
                    <span className="text-sm tabular-nums">
                      {formatMinor(total, state.currency)}
                    </span>
                  )}
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 text-chevron transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </span>
              </button>

              {expanded ? (
                <div className="flex flex-col gap-2 border-t border-border bg-muted/40 px-5 py-3">
                  <Button
                    type="button"
                    variant={
                      item.assignees.length === participants.length &&
                      participants.length > 0
                        ? 'default'
                        : 'outline'
                    }
                    size="touch"
                    className="w-fit"
                    onClick={() => assignEveryone(item)}
                    data-testid="assign-everyone"
                  >
                    {t('everyone')}
                  </Button>
                  {participants.length > 10 ? (
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder={t('filterMembers')}
                      aria-label={t('filterMembers')}
                      className="h-11"
                      data-testid="member-filter"
                    />
                  ) : null}
                  <ul
                    className={`flex flex-col ${
                      participants.length > 10 ? 'max-h-72 overflow-y-auto' : ''
                    }`}
                  >
                    {participants
                      .filter(
                        (memberId) =>
                          participants.length <= 10 ||
                          filter.trim() === '' ||
                          nameOf(memberId)
                            .toLowerCase()
                            .includes(filter.trim().toLowerCase()),
                      )
                      .map((memberId) => {
                        const assignee = item.assignees.find(
                          (a) => a.memberId === memberId,
                        )
                        return (
                          <li
                            key={memberId}
                            className="flex items-center justify-between gap-3 py-1.5"
                          >
                            <label className="flex flex-1 items-center gap-2.5 text-sm">
                              <input
                                type="checkbox"
                                checked={Boolean(assignee)}
                                onChange={() => toggleMember(item, memberId)}
                                className="size-5 accent-[var(--primary)]"
                                data-testid={`assign-${memberId}`}
                              />
                              {nameOf(memberId)}
                            </label>
                            {assignee && item.quantity > 1 && !splitByAmount ? (
                              <QtyStepper
                                value={assignee.quantity}
                                onChange={(quantity) =>
                                  setMemberQty(item, memberId, quantity)
                                }
                                max={item.quantity}
                                ariaLabel={`${nameOf(memberId)} ${t('itemQty')}`}
                                testId={`assign-qty-${memberId}`}
                              />
                            ) : null}
                          </li>
                        )
                      })}
                  </ul>

                  {splitByAmount ? (
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="assign-status"
                    >
                      {t('assignSplitByAmount', {
                        quantity: item.quantity,
                        count: item.assignees.length,
                      })}
                    </p>
                  ) : item.quantity > 1 ? (
                    <p
                      className={`text-xs ${status === 'over' ? 'text-negative' : 'text-muted-foreground'}`}
                      data-testid="assign-status"
                    >
                      {status === 'over'
                        ? t('assignOver', {
                            assigned,
                            quantity: item.quantity,
                          })
                        : status === 'partial'
                          ? t('assignPartial', {
                              remaining: item.quantity - assigned,
                            })
                          : t('assignedOf', {
                              assigned,
                              quantity: item.quantity,
                            })}
                    </p>
                  ) : item.assignees.length > 1 ? (
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="assign-status"
                    >
                      {t('assignShared', { count: item.assignees.length })}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    className="w-full justify-center"
                    onClick={() => closeAndAdvance(item.key)}
                    data-testid="assign-done"
                  >
                    {t('assignDone')}
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t('unassignedNotice')}</p>
    </div>
  )
}
