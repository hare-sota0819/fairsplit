import { parseAmountToMinor } from '@/lib/format'
import { allocateEveryone, lineTotal, type ItemSplitMode } from '@/lib/settlement'
import type { ParsedItemList } from './chat-parse/items'

/**
 * Pure state helpers for the chat "who had what" card
 * (`ChatAssignCard.tsx`). Mirror StepAssign's inline handlers
 * (`src/app/groups/[groupId]/expenses/wizard/StepAssign.tsx:87-130`) field
 * for field: chat and wizard must never disagree on a resulting assignee
 * array for the same input, so nothing here may diverge from that logic.
 *
 * Same shape as the wizard's `ItemState`
 * (`.../wizard/math.ts:21-37`) minus the wizard-only fields — this module
 * has no notion of adding/removing/editing lines, only assigning them.
 */
export interface ChatItemState {
  key: number
  name: string
  /**
   * Unit price as parsed. NOT the line total. null = the sentence gave no
   * price for this line ("콜라 하나, 우동 3개") — the card must collect it
   * (setUnitAmount) before the expense can save.
   */
  unitAmount: string | null
  quantity: number
  splitMode: ItemSplitMode
  assignees: { memberId: string; quantity: number }[]
}

/**
 * Turns a parser result (Task 1's `parseItems`) into the card's item list:
 * one `ChatItemState` per parsed item, sequential keys, nobody assigned
 * yet.
 *
 * CONTRACT: `parsed.currency` is deliberately dropped — `ChatItemState` has
 * no currency field, since every line in one `ParsedItemList` shares a
 * single, already-resolved sentence currency (`ParsedItemList.currency`,
 * chat-parse/items.ts:12-16; a sentence mixing currencies fails to parse
 * at all). The caller MUST thread that same `parsed.currency` through as
 * the `currency` given back to every helper here (`assignEveryone`) and to
 * `ChatAssignCard`'s `currency` prop — never the group's default/settlement
 * currency. Passing a different currency re-reads every `unitAmount`
 * decimal string at the wrong exponent: a silently wrong total, with
 * nothing here to catch it.
 */
export function toChatItems(
  parsed: ParsedItemList,
  /**
   * Who shares the expense (parse()'s participantIds) — needed only to
   * expand a `shareAll` line ("우유롤은 하나씩 나눠먹음") into per-person
   * assignments. Omitted (receipt path), shareAll lines stay unassigned.
   */
  participants?: string[],
): ChatItemState[] {
  return parsed.items.map((item, index) => {
    let assignees: { memberId: string; quantity: number }[] = []
    if (item.assigneeIds.length > 0) {
      // Named assignees: whole units each when they go round ("우동은 내가
      // 3개 다먹었고" → all 3 to one person), 1 each otherwise — the card's
      // steppers are there for the user to adjust the leftovers.
      const each =
        item.quantity % item.assigneeIds.length === 0
          ? item.quantity / item.assigneeIds.length
          : 1
      assignees = item.assigneeIds.map((memberId) => ({ memberId, quantity: each }))
    } else if (item.shareAll && participants && participants.length > 0) {
      if (item.quantity % participants.length === 0) {
        const each = item.quantity / participants.length
        assignees = participants.map((memberId) => ({ memberId, quantity: each }))
      }
      // Units that do not go round need the line's MONEY to divide
      // (assignEveryone's BY_AMOUNT fallback), which an unpriced line cannot
      // do yet — leave unassigned rather than guess.
    }
    return {
      key: index,
      name: item.name,
      unitAmount: item.unitAmount,
      quantity: item.quantity,
      splitMode: 'BY_QUANTITY' as const,
      assignees,
    }
  })
}

/**
 * Set one line's unit price — the card's price input for an unpriced line
 * (and the conversational "콜라는 500엔" route). The raw string is stored
 * as typed; validation (parseAmountToMinor at the card's currency) happens
 * where every other amount is validated, at save/total time, so a
 * half-typed value never crashes the card.
 */
export function setUnitAmount(
  items: ChatItemState[],
  key: number,
  unitAmount: string,
): ChatItemState[] {
  return patchItem(items, key, { unitAmount: unitAmount.trim() === '' ? null : unitAmount })
}

function patchItem(
  items: ChatItemState[],
  key: number,
  change: Partial<ChatItemState>,
): ChatItemState[] {
  return items.map((item) => (item.key === key ? { ...item, ...change } : item))
}

/**
 * Tick/untick one member on one item. Any hand assignment is a per-person
 * statement of who took what, so it always means BY_QUANTITY — including
 * when it lands on a line "Everyone" had just divided by money (StepAssign
 * 87-95).
 */
export function toggleMember(
  items: ChatItemState[],
  key: number,
  memberId: string,
): ChatItemState[] {
  const item = items.find((i) => i.key === key)
  if (!item) return items
  const has = item.assignees.some((a) => a.memberId === memberId)
  return patchItem(items, key, {
    splitMode: 'BY_QUANTITY',
    assignees: has
      ? item.assignees.filter((a) => a.memberId !== memberId)
      : [...item.assignees, { memberId, quantity: 1 }],
  })
}

/**
 * Set one member's quantity on one item (StepAssign 97-103). Clamped to
 * `[1, item.quantity]` here rather than only at the `QtyStepper` that calls
 * it, so this pure function is safe to call directly (as the test suite
 * does) without relying on the stepper's own `max` prop.
 */
export function setMemberQty(
  items: ChatItemState[],
  key: number,
  memberId: string,
  quantity: number,
): ChatItemState[] {
  const item = items.find((i) => i.key === key)
  if (!item) return items
  const clamped = Math.min(item.quantity, Math.max(1, quantity))
  return patchItem(items, key, {
    splitMode: 'BY_QUANTITY',
    assignees: item.assignees.map((a) =>
      a.memberId === memberId ? { ...a, quantity: clamped } : a,
    ),
  })
}

/**
 * "Everyone" — divide the line among every participant, or clear it if
 * everyone was already assigned (StepAssign 111-130). Whole units first
 * (BY_QUANTITY) when they go round; the line's money (BY_AMOUNT) when they
 * do not, via `allocateEveryone`.
 *
 * Takes `currency` (not part of StepAssign's own handler signature, which
 * closes over `state.currency`) because `unitAmount` here is a decimal
 * string, not minor units, and money policy forbids guessing an exponent —
 * see `docs/DECISIONS.md`.
 */
export function assignEveryone(
  items: ChatItemState[],
  key: number,
  participants: string[],
  payerId: string,
  currency: string,
): ChatItemState[] {
  const item = items.find((i) => i.key === key)
  if (!item) return items
  const all = item.assignees.length === participants.length
  if (all) {
    return patchItem(items, key, { splitMode: 'BY_QUANTITY', assignees: [] })
  }
  const unit = item.unitAmount === null ? null : parseAmountToMinor(item.unitAmount, currency)
  const divided = allocateEveryone(
    { quantity: item.quantity, unitAmount: unit ?? 0n },
    participants,
    payerId,
  )
  return patchItem(items, key, {
    splitMode: divided.splitMode,
    assignees: divided.assignees.map((a) => ({
      memberId: a.memberId,
      quantity: a.quantity,
    })),
  })
}

/**
 * Grand total across every line — Σ `lineTotal`, minor units (Task 3). The
 * ONE place this sum is computed for a save payload's `amount`, so it can
 * never drift from `ChatAssignCard`'s own on-screen total
 * (`ChatAssignCard.tsx`'s `itemsTotal`): both apply the exact same formula
 * (`parseAmountToMinor` at `currency`'s exponent, then `lineTotal`) to the
 * same `items`/`currency` pair, which — being pure functions — makes the two
 * numbers agree by construction, not by coincidence. A line whose
 * `unitAmount` fails to parse contributes nothing, same as the card's own
 * display total.
 */
export function itemsGrandTotal(
  items: ChatItemState[],
  currency: string,
): bigint {
  return items.reduce((sum, item) => {
    const unit = item.unitAmount === null ? null : parseAmountToMinor(item.unitAmount, currency)
    return unit === null
      ? sum
      : sum + lineTotal({ unitAmount: unit, quantity: item.quantity })
  }, 0n)
}
