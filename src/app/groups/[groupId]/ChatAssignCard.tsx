'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronDown } from 'lucide-react'
import { formatMinor, parseAmountToMinor } from '@/lib/format'
import { uniqueInitials } from '@/lib/initials'
import { assignmentStatus, lineTotal } from '@/lib/settlement'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  assignEveryone,
  setMemberQty,
  setUnitAmount,
  toggleMember,
  type ChatItemState,
} from '@/lib/chat-items-state'
import { QtyStepper } from './expenses/wizard/NumberField'

/**
 * The chat card port of the wizard's StepAssign screen
 * (`.../expenses/wizard/StepAssign.tsx`) — "who had what", compact enough
 * to sit inside a transcript bubble. Controlled only: no internal item
 * state, every mutation flows out through `onItemsChange` so the parent
 * (ChatComposer, Task 3) owns the single source of truth.
 *
 * The wizard's >10-participant name filter (`member-filter`,
 * StepAssign.tsx:244-253) is intentionally NOT reproduced here — a chat
 * group roster this large is not the case this card is compact for, and
 * the extra control would just add chrome to every render.
 */
export interface ChatAssignCardProps {
  items: ChatItemState[]
  onItemsChange: (items: ChatItemState[]) => void
  members: { id: string; name: string }[]
  participantIds: string[]
  payerId: string
  /**
   * MUST be the SAME currency the `items` were parsed with — i.e. the
   * `ParsedItemList.currency` (`chat-parse/items.ts`) that `toChatItems`
   * (`@/lib/chat-items-state`) built `items` from, never the group's
   * default/settlement currency. Every `unitAmount` on `items` is a
   * decimal string with no currency of its own; this prop is the sole
   * authority for the exponent it's parsed at (`parseAmountToMinor`), so a
   * mismatched currency silently misreads every amount with no error
   * surface — see `toChatItems`'s doc comment for the full contract.
   */
  currency: string
  disabled?: boolean
}

export function ChatAssignCard({
  items,
  onItemsChange,
  members,
  participantIds,
  payerId,
  currency,
  disabled = false,
}: ChatAssignCardProps) {
  const t = useTranslations('chat.items')
  const tForm = useTranslations('expenses.form')
  // First unpriced line starts expanded: the sentence left its price blank
  // ("콜라 하나, 우동 3개"), so the card opens on the question it must ask.
  const [open, setOpen] = useState<Set<number>>(() => {
    const firstUnpriced = items.find((item) => item.unitAmount === null)
    return firstUnpriced ? new Set([firstUnpriced.key]) : new Set()
  })

  const nameOf = (id: string): string =>
    members.find((m) => m.id === id)?.name ?? '?'
  const initials = uniqueInitials(participantIds.map(nameOf))
  const initialOf = (id: string): string =>
    initials.get(nameOf(id)) ?? nameOf(id)

  // One row open at a time — same reasoning as StepAssign.tsx:48-60: two
  // expanded rows would show two identical rosters at once, and the tick
  // the user is about to make belongs to whichever heading has already
  // scrolled past.
  const toggleOpen = (key: number) => {
    setOpen((previous) => (previous.has(key) ? new Set() : new Set([key])))
  }

  /**
   * Close this row and open the next unassigned item, wrapping around —
   * mirrors `closeAndAdvance` (StepAssign.tsx:77-86).
   */
  const closeAndAdvance = (key: number) => {
    const index = items.findIndex((item) => item.key === key)
    const next =
      items.slice(index + 1).find((item) => item.assignees.length === 0) ??
      items.slice(0, index).find((item) => item.assignees.length === 0)
    setOpen(next ? new Set([next.key]) : new Set())
  }

  const itemsTotal = items.reduce((sum, item) => {
    const unit =
      item.unitAmount === null ? null : parseAmountToMinor(item.unitAmount, currency)
    return unit === null
      ? sum
      : sum + lineTotal({ unitAmount: unit, quantity: item.quantity })
  }, 0n)

  if (items.length === 0) {
    return null
  }

  return (
    <Card
      size="sm"
      data-testid="chat-assign-card"
      className="chat-card-enter max-w-full"
    >
      <CardContent className="flex flex-col gap-3 text-sm">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p
          className="text-xs text-muted-foreground"
          data-testid="chat-assign-summary"
        >
          {t('summary', {
            count: items.length,
            total: formatMinor(itemsTotal, currency),
          })}
        </p>

        <ul className="-mx-4 divide-y divide-border">
          {items.map((item) => {
            const unit =
              item.unitAmount === null
                ? null
                : parseAmountToMinor(item.unitAmount, currency)
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
                // are derived on demand rather than held in state; any
                // non-zero stand-in says the same thing to `assignmentStatus`
                // (mirrors StepAssign.tsx:166-171).
                ...(item.splitMode === 'BY_AMOUNT' ? { amount: 1n } : {}),
              })),
            })
            const splitByAmount = item.splitMode === 'BY_AMOUNT'
            const expanded = open.has(item.key)
            return (
              <li key={item.key} data-testid="chat-assign-row">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggleOpen(item.key)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted"
                  data-testid="chat-assign-toggle"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium">
                      {item.name || tForm('itemName')}
                      {item.quantity > 1 ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ×{item.quantity}
                        </span>
                      ) : null}
                    </span>
                    {item.assignees.length === 0 ? (
                      <span
                        className="w-fit rounded-full bg-negative-soft px-2 py-0.5 text-xs font-semibold text-negative"
                        data-testid="chat-unassigned-badge"
                      >
                        {tForm('unassigned')}
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
                    {item.unitAmount === null ? (
                      <span
                        className="rounded-full bg-notice-soft px-2 py-0.5 text-xs font-semibold text-notice"
                        data-testid="chat-item-unpriced-badge"
                      >
                        {t('priceAsk')}
                      </span>
                    ) : total === null ? null : (
                      <span className="text-sm tabular-nums">
                        {formatMinor(total, currency)}
                      </span>
                    )}
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-4 text-chevron transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>

                {expanded ? (
                  <div className="flex flex-col gap-2 border-t border-border bg-muted/40 px-4 py-2">
                    {/* Always rendered while expanded — a stable input both
                        collects a missing price (the parser's null lines)
                        and lets a wrong one be corrected in place. */}
                    <div className="flex items-center gap-2 py-1">
                      <Label
                        htmlFor={`chat-item-price-${item.key}`}
                        className="shrink-0 text-xs"
                      >
                        {t('priceAsk')}
                      </Label>
                      <Input
                        id={`chat-item-price-${item.key}`}
                        inputMode="decimal"
                        value={item.unitAmount ?? ''}
                        placeholder="0"
                        disabled={disabled}
                        aria-invalid={item.unitAmount !== null && unit === null}
                        onChange={(event) =>
                          onItemsChange(
                            setUnitAmount(items, item.key, event.target.value),
                          )
                        }
                        className="h-9 max-w-32 text-right tabular-nums"
                        data-testid={`chat-item-price-${item.key}`}
                      />
                    </div>
                    <Button
                      type="button"
                      variant={
                        item.assignees.length === participantIds.length &&
                        participantIds.length > 0
                          ? 'default'
                          : 'outline'
                      }
                      size="touch"
                      className="w-fit"
                      disabled={disabled}
                      onClick={() =>
                        onItemsChange(
                          assignEveryone(
                            items,
                            item.key,
                            participantIds,
                            payerId,
                            currency,
                          ),
                        )
                      }
                      data-testid="chat-assign-everyone"
                    >
                      {tForm('everyone')}
                    </Button>
                    <ul className="flex flex-col">
                      {participantIds.map((memberId) => {
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
                                disabled={disabled}
                                onChange={() =>
                                  onItemsChange(
                                    toggleMember(items, item.key, memberId),
                                  )
                                }
                                className="size-5 accent-[var(--primary)]"
                                data-testid={`chat-assign-${memberId}`}
                              />
                              {nameOf(memberId)}
                            </label>
                            {assignee && item.quantity > 1 && !splitByAmount ? (
                              <QtyStepper
                                value={assignee.quantity}
                                onChange={(quantity) => {
                                  if (disabled) return
                                  onItemsChange(
                                    setMemberQty(
                                      items,
                                      item.key,
                                      memberId,
                                      quantity,
                                    ),
                                  )
                                }}
                                max={item.quantity}
                                ariaLabel={`${nameOf(memberId)} ${tForm('itemQty')}`}
                                testId={`chat-assign-qty-${memberId}`}
                              />
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>

                    {splitByAmount ? (
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid="chat-assign-status"
                      >
                        {tForm('assignSplitByAmount', {
                          quantity: item.quantity,
                          count: item.assignees.length,
                        })}
                      </p>
                    ) : item.quantity > 1 ? (
                      <p
                        className={`text-xs ${status === 'over' ? 'text-negative' : 'text-muted-foreground'}`}
                        data-testid="chat-assign-status"
                      >
                        {status === 'over'
                          ? tForm('assignOver', {
                              assigned,
                              quantity: item.quantity,
                            })
                          : status === 'partial'
                            ? tForm('assignPartial', {
                                remaining: item.quantity - assigned,
                              })
                            : tForm('assignedOf', {
                                assigned,
                                quantity: item.quantity,
                              })}
                      </p>
                    ) : item.assignees.length > 1 ? (
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid="chat-assign-status"
                      >
                        {tForm('assignShared', {
                          count: item.assignees.length,
                        })}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="touch"
                      className="w-full justify-center"
                      disabled={disabled}
                      onClick={() => closeAndAdvance(item.key)}
                      data-testid="chat-assign-done"
                    >
                      {tForm('assignDone')}
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          {tForm('unassignedNotice')}
        </p>
      </CardContent>
    </Card>
  )
}
