'use server'

import { revalidatePath } from 'next/cache'
import { cancelledFields } from '@/lib/expense-cancel'
import { expenseCreateData } from '@/lib/expense-create'
import { resolveSnapshotRate } from '@/lib/expense-snapshot-rate'
import { currencySwapBlockedKey } from '@/lib/expense-swap'
import { parseAmountToMinor } from '@/lib/format'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

/**
 * The four in-chat edits a context command can ask for on an ALREADY-SAVED
 * expense ("아까 그 술값에 유나도 껴줘") — Task 10 of the goat-parser plan.
 *
 * Shape rules, each inherited rather than invented here:
 *  - `requireGroupMember` gates EVERY action (src/lib/membership.ts). The
 *    expense is then re-fetched scoped to that same `groupId`, so an id from
 *    another group resolves to "not found" rather than to somebody else's
 *    receipt.
 *  - Each returns FRESH STATE (`EditResult`), never a redirect and never a
 *    `revalidatePath` of the route it was fired from: a server action does not
 *    re-render the route it was called from, and this Next version's client
 *    intermittently drops the follow-up `router.refresh()` (docs/SOLVED.md
 *    2026-08-09 — the Phase 3C lesson). The chat bubble the user is watching
 *    for is built from THIS return value. The routes we are NOT on (the
 *    group's history feed and the expense's own detail page) are revalidated,
 *    the same reason `setExpenseCancelled` revalidates its siblings: a later
 *    client-side navigation there must not be answered from the Client Router
 *    Cache's pre-edit copy.
 *  - Errors are i18n KEYS, not resolved strings: the caller renders them as an
 *    ordinary assistant answer line, and answer lines persist to chat history
 *    by key (`src/lib/chat-history.ts`), so a resolved string would freeze one
 *    locale into the transcript.
 *
 * DEVIATION from the task brief, deliberate and load-bearing: the brief said
 * "cancel reuses `setExpenseCancelled` — no new action." It cannot. That action
 * ends in `redirect(...)` to the expense detail page, which would throw the
 * user out of the chat mid-conversation and leave the flow with no result to
 * build a reply from. `applyCancel` below writes exactly the same three fields
 * that action writes (`cancelledAt`/`cancelledById`/`updatedById`) and adds
 * nothing else, so the soft-delete contract still has one shape; only the
 * navigation differs.
 */

/** One expense, as much of it as the chat needs to describe or re-resolve it.
 *  Amounts are decimal-string minor units and the timestamp is an ISO string:
 *  this crosses the server → client boundary (as an action result AND as
 *  `page.tsx`'s `recentExpenses` prop), and this app's convention is that
 *  `bigint`/`Date` never do (see `assistant-data.ts`'s own doc comment). */
export interface RecentExpenseView {
  id: string
  /** What the user would call it — the same text the feed shows. */
  note: string
  amountMinor: string
  currency: string
  timestampIso: string
  participantIds: string[]
  payerId: string
  cancelled: boolean
  /**
   * How many receipt LINES this expense has. Zero for the ordinary
   * single-amount expense; non-zero changes what an edit even means, which is
   * why it travels with the row rather than being discovered only on the
   * server (see `blockedForItems` below, and `editBlockedKey`'s client-side
   * mirror in `chat-composer-logic.ts` — the user is told before they tap).
   */
  itemCount: number
}

export type EditResult =
  | {
      ok: true
      expense: RecentExpenseView
      /**
       * The row this edit CANCELLED, when it cancelled one — only the currency
       * swap does (`applyCurrencyChange`), where `expense` above is the newly
       * created replacement. The caller keys both into its session override map
       * so the very next sentence resolves against what is actually stored: the
       * old row must stop being offered as a candidate immediately, exactly as
       * it does after `applyCancel`.
       */
      replaced?: RecentExpenseView
    }
  /** An `errorKey` is a fully-qualified i18n key under `chat.edit.*`. */
  | { ok: false; errorKey: string }

const ERROR = {
  notFound: 'chat.edit.notFound',
  cancelled: 'chat.edit.cancelledAlready',
  notMember: 'chat.edit.notMember',
  lastParticipant: 'chat.edit.lastParticipant',
  badAmount: 'chat.edit.badAmount',
  currencyBlocked: 'chat.edit.currencyBlocked',
  tooComplex: 'chat.edit.tooComplex',
  swapRateUnavailable: 'chat.edit.currencySwap.rateUnavailable',
} as const

const EXPENSE_SELECT = {
  id: true,
  title: true,
  note: true,
  amount: true,
  currency: true,
  timestamp: true,
  payerId: true,
  cancelledAt: true,
  // The three columns only the currency swap reads: it re-creates the expense
  // (`applyCurrencyChange`), so everything the row IS has to travel with it —
  // and `isWalletAdjustment` is the shape it refuses outright.
  isPersonal: true,
  isWalletAdjustment: true,
  receiptImagePath: true,
  participants: { select: { memberId: true } },
  _count: { select: { items: true } },
} as const

interface LoadedExpense {
  id: string
  title: string
  note: string | null
  amount: bigint
  currency: string
  timestamp: Date
  payerId: string
  cancelledAt: Date | null
  isPersonal: boolean
  isWalletAdjustment: boolean
  receiptImagePath: string | null
  participants: { memberId: string }[]
  _count: { items: number }
}

/**
 * Whether this expense is one the chat must not edit PIECEMEAL, because its
 * shares do not come from the fields the chat would change.
 *
 * An itemised expense is split by its ITEM ASSIGNMENTS, not by `participants`:
 * `explainShares`/`consumedShares` read the assignment rows. So a chat
 * participant edit on one would be silently ineffective in the direction that
 * looks harmless (adding someone changes nobody's share, while the reply says
 * it worked) and actively wrong in the other (removing someone hides them from
 * every screen while their assigned lines still charge them — a state the
 * wizard cannot even produce, since it rebuilds items and participants
 * together). Changing the TOTAL is refused for the neighbouring reason: the
 * line totals ARE the receipt, and a grand total that contradicts them is a
 * money bug.
 *
 * The full form edits items, assignments and participants as one thing, which
 * is where these belong — `chat.edit.tooComplex` says so.
 */
function blockedForItems(expense: LoadedExpense): boolean {
  return expense._count.items > 0
}

/** The DB row as the chat describes it. `title` is what the feed and the
 *  confirm card show (and what `resolveReference` matches a keyword against);
 *  `note` only stands in for a row saved without one. */
function viewOf(expense: LoadedExpense): RecentExpenseView {
  return {
    id: expense.id,
    note: expense.title || expense.note || '',
    amountMinor: expense.amount.toString(),
    currency: expense.currency,
    timestampIso: expense.timestamp.toISOString(),
    participantIds: expense.participants.map((p) => p.memberId),
    payerId: expense.payerId,
    cancelled: expense.cancelledAt !== null,
    itemCount: expense._count.items,
  }
}

/** Re-reads the row after a write, so the caller's fresh state is the DB's
 *  own answer rather than a locally-patched guess. */
async function freshResult(expenseId: string): Promise<EditResult> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: EXPENSE_SELECT,
  })
  if (!expense) {
    return { ok: false, errorKey: ERROR.notFound }
  }
  return { ok: true, expense: viewOf(expense) }
}

function revalidateSiblings(groupId: string, expenseId: string): void {
  // Deliberately NOT `/groups/${groupId}` — that is the route the chat itself
  // is mounted on, and revalidating the route an action fired from is the
  // documented way to lose the action's own state (docs/SOLVED.md 2026-08-01,
  // 2026-08-03). The caller refreshes that one itself.
  revalidatePath(`/groups/${groupId}/history`)
  revalidatePath(`/groups/${groupId}/expenses/${expenseId}`)
}

/**
 * The gate every action below starts with: session + membership, then the
 * expense re-fetched scoped to the same group.
 */
async function openEdit(
  groupId: string,
  expenseId: string,
): Promise<
  | { ok: true; memberId: string; expense: LoadedExpense }
  | { ok: false; errorKey: string }
> {
  const { member } = await requireGroupMember(groupId)
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId },
    select: EXPENSE_SELECT,
  })
  if (!expense) {
    return { ok: false, errorKey: ERROR.notFound }
  }
  return { ok: true, memberId: member.id, expense }
}

/** Whether this id is a member of THIS group. `active` additionally requires
 *  they have not left — you may take a departed member OUT of an expense
 *  (their balance still matters to the people they owe), but never add one
 *  back IN. */
async function isGroupMember(
  groupId: string,
  memberId: string,
  active: boolean,
): Promise<boolean> {
  const found = await prisma.member.findFirst({
    where: { id: memberId, groupId, ...(active ? { leftAt: null } : {}) },
    select: { id: true },
  })
  return found !== null
}

export async function applyAddParticipant(
  groupId: string,
  expenseId: string,
  memberId: string,
): Promise<EditResult> {
  const opened = await openEdit(groupId, expenseId)
  if (!opened.ok) return opened
  const { expense } = opened
  if (expense.cancelledAt !== null) {
    return { ok: false, errorKey: ERROR.cancelled }
  }
  // An itemised expense splits by its assignments, so writing a participant
  // row here would report a change that changes nobody's share (see
  // `blockedForItems`).
  if (blockedForItems(expense)) {
    return { ok: false, errorKey: ERROR.tooComplex }
  }
  if (!(await isGroupMember(groupId, memberId, true))) {
    return { ok: false, errorKey: ERROR.notMember }
  }
  // Already sharing it: nothing to write, but still a success — the user asked
  // for a state, not for a diff, and that state already holds.
  if (!expense.participants.some((p) => p.memberId === memberId)) {
    await prisma.expense.update({
      where: { id: expense.id },
      data: {
        updatedById: opened.memberId,
        participants: { create: { memberId } },
      },
    })
    revalidateSiblings(groupId, expense.id)
  }
  return freshResult(expense.id)
}

export async function applyRemoveParticipant(
  groupId: string,
  expenseId: string,
  memberId: string,
): Promise<EditResult> {
  const opened = await openEdit(groupId, expenseId)
  if (!opened.ok) return opened
  const { expense } = opened
  if (expense.cancelledAt !== null) {
    return { ok: false, errorKey: ERROR.cancelled }
  }
  // The dangerous direction of the same rule: dropping the participant row
  // would hide this member from every screen while their assigned lines still
  // charge them.
  if (blockedForItems(expense)) {
    return { ok: false, errorKey: ERROR.tooComplex }
  }
  if (!(await isGroupMember(groupId, memberId, false))) {
    return { ok: false, errorKey: ERROR.notMember }
  }
  if (!expense.participants.some((p) => p.memberId === memberId)) {
    return freshResult(expense.id)
  }
  // An expense must always be shared between at least one person — the same
  // "never empty" rule the confirm card's own participant pills enforce
  // (`toggleParticipants`). Removing the PAYER is allowed and needs no guard
  // of its own: the engine prices a payer who is not a participant correctly
  // (they fronted it, they just did not consume it).
  if (expense.participants.length <= 1) {
    return { ok: false, errorKey: ERROR.lastParticipant }
  }
  await prisma.$transaction([
    prisma.expenseParticipant.delete({
      where: { expenseId_memberId: { expenseId: expense.id, memberId } },
    }),
    prisma.expense.update({
      where: { id: expense.id },
      data: { updatedById: opened.memberId },
    }),
  ])
  revalidateSiblings(groupId, expense.id)
  return freshResult(expense.id)
}

/**
 * Change what the expense cost.
 *
 * `currency` is NOT optional and is never assumed to be the group's: `그거
 * 30달러로 바꿔줘` in a KRW group carries USD, and an applier that ignored it
 * would book 30 USD as ₩30 (T9's own ruling).
 *
 * What it does with a currency that differs from the expense's own is REFUSE:
 * an expense's `currency` and `marketRateSnapshot` are immutable after
 * creation ANYWHERE in this app — the wizard's own edit path states it
 * outright ("Update never touches marketRateSnapshot, currency, or
 * enteredById", expenses/actions.ts) because the snapshot is the rate that
 * priced this receipt and re-pricing it silently would move every balance
 * derived from it. That is still true, so this action still refuses
 * (`chat.edit.currencyBlocked`).
 *
 * F-T4 changed WHO REACHES that refusal, not the refusal. The chat no longer
 * sends a currency change here at all: `applyCurrencyChange` below answers it
 * by cancelling the expense and re-creating it, which mutates neither field.
 * This branch is now the guard against a caller that skipped that routing —
 * never something a user is expected to see.
 *
 * Two more shapes are refused rather than half-applied, both money-affecting:
 *  - an ITEMISED expense (its line totals are the receipt; a new grand total
 *    would contradict them);
 *  - anything but exactly one plain funding portion (split funding, or a
 *    portion already corrected against a bank statement — the portions must
 *    sum to the total by construction, and there is no single row to move).
 * Both point at the full form via `chat.edit.tooComplex`.
 */
export async function applyChangeAmount(
  groupId: string,
  expenseId: string,
  amount: string,
  currency: string,
): Promise<EditResult> {
  const opened = await openEdit(groupId, expenseId)
  if (!opened.ok) return opened
  const { expense } = opened
  if (expense.cancelledAt !== null) {
    return { ok: false, errorKey: ERROR.cancelled }
  }
  if (currency !== expense.currency) {
    return { ok: false, errorKey: ERROR.currencyBlocked }
  }
  const minor = parseAmountToMinor(amount, currency)
  if (minor === null || minor <= 0n) {
    return { ok: false, errorKey: ERROR.badAmount }
  }
  const funding = await prisma.expenseFunding.findMany({
    where: { expenseId: expense.id },
    select: { id: true, actualChargedAmount: true },
  })
  if (
    blockedForItems(expense) ||
    funding.length !== 1 ||
    funding[0].actualChargedAmount !== null
  ) {
    return { ok: false, errorKey: ERROR.tooComplex }
  }
  await prisma.$transaction([
    prisma.expense.update({
      where: { id: expense.id },
      data: { amount: minor, updatedById: opened.memberId },
    }),
    // The one portion covers the whole receipt, so it moves with it — the
    // portions summing to the total is an invariant of the stored data, not a
    // promise about the caller.
    prisma.expenseFunding.update({
      where: { id: funding[0].id },
      data: { amount: minor },
    }),
  ])
  revalidateSiblings(groupId, expense.id)
  return freshResult(expense.id)
}

/**
 * Change what the expense cost AND which currency it is in — the owner's
 * resolution for the saved half of docs/PROMPT.md [2026-08-14] decision 2.
 *
 * A stored expense's `currency` and `marketRateSnapshot` are immutable, and
 * this does not touch either: it CANCELS the expense and CREATES a new one in
 * the currency the sentence named, keeping the payer, the participants, the
 * timestamp and the note. Both halves are operations this app already
 * performs safely (`cancelledFields`, the save path's own create); what is new
 * is that the user agrees to them ONCE, on a card that names both sides — the
 * chat never does either half on its own.
 *
 * The new expense is priced exactly as a fresh entry at the ORIGINAL instant
 * would be: `resolveSnapshotRate` for that timestamp, no rate carried over
 * from the cancelled row (a rate for the old currency prices the old money).
 * Its funding is the on-the-spot default with no wallet, because a wallet
 * holds ONE currency — the wallet that paid the old row cannot have paid this
 * one, and picking a different one is a question this single confirm card
 * deliberately does not ask (the full form does).
 *
 * What it refuses is `currencySwapBlockedKey` (src/lib/expense-swap.ts) — the
 * whole set in one pure function, so each refusal is pinned by a test rather
 * than asserted in this comment. It is the set `applyChangeAmount` refuses
 * plus the shapes only RE-CREATION could damage: a wallet adjustment, and any
 * portion that drew on a wallet or carries the payer's own rate (that money
 * cannot follow the expense into another currency, and this card has nowhere
 * to ask where the new money came from).
 *
 * A sentence that names the currency the expense is ALREADY in is not a swap
 * at all and must not cancel anything — it is delegated to
 * `applyChangeAmount`, the ordinary in-place edit. The caller decides the same
 * way (`isCurrencySwap`, chat-composer-logic.ts); this is the guard, not a
 * second opinion.
 */
export async function applyCurrencyChange(
  groupId: string,
  expenseId: string,
  amount: string,
  currency: string,
): Promise<EditResult> {
  const opened = await openEdit(groupId, expenseId)
  if (!opened.ok) return opened
  const { expense } = opened
  if (expense.cancelledAt !== null) {
    return { ok: false, errorKey: ERROR.cancelled }
  }
  if (currency === expense.currency) {
    return applyChangeAmount(groupId, expenseId, amount, currency)
  }
  const funding = await prisma.expenseFunding.findMany({
    where: { expenseId: expense.id },
    select: {
      actualChargedAmount: true,
      walletId: true,
      ownRateSnapshot: true,
      funderId: true,
    },
  })
  // Before `parseAmountToMinor`, deliberately: that reads the currency's ISO
  // exponent and THROWS on a code the table does not know, which would reach
  // the user as a generic failure rather than as the reason.
  const blockedKey = currencySwapBlockedKey(
    { itemCount: expense._count.items, isWalletAdjustment: expense.isWalletAdjustment },
    funding.map((row) => ({
      actualChargedAmount: row.actualChargedAmount,
      walletId: row.walletId,
      ownRateSnapshot: row.ownRateSnapshot?.toString() ?? null,
      funderId: row.funderId,
    })),
    currency,
  )
  if (blockedKey !== null) {
    return { ok: false, errorKey: blockedKey }
  }
  const minor = parseAmountToMinor(amount, currency)
  if (minor === null || minor <= 0n) {
    return { ok: false, errorKey: ERROR.badAmount }
  }
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { settlementCurrency: true },
  })
  const newFunding = [
    {
      position: 0,
      amount: minor,
      walletId: null,
      ownRateSnapshot: null,
      funderId: null,
    },
  ]
  const rate = await resolveSnapshotRate({
    timestamp: expense.timestamp,
    currency,
    settlementCurrency: group.settlementCurrency,
    funding: newFunding,
  })
  if (rate === null) {
    // Nothing has been written yet, and nothing will be: without a rate the
    // new expense could not be priced, and cancelling the old one would leave
    // the user with neither. Said as its own reason — unlike the save path's,
    // this one cannot be finished in the full form (no screen there changes a
    // currency), so the copy asks for a retry instead.
    return { ok: false, errorKey: ERROR.swapRateUnavailable }
  }
  const [, created] = await prisma.$transaction([
    prisma.expense.update({
      where: { id: expense.id },
      data: cancelledFields(true, opened.memberId, new Date()),
    }),
    prisma.expense.create({
      data: expenseCreateData({
        groupId,
        title: expense.title,
        payerId: expense.payerId,
        amount: minor,
        currency,
        timestamp: expense.timestamp,
        marketRateSnapshot: rate.rate,
        marketRateProvisional: rate.provisional,
        note: expense.note,
        isPersonal: expense.isPersonal,
        receiptImagePath: expense.receiptImagePath,
        // Who made the change, matching how the save path records whoever
        // typed an expense in — the payer is preserved above, and the two are
        // routinely different people.
        enteredById: opened.memberId,
        participantIds: expense.participants.map((p) => p.memberId),
        // Refused above, so there are none to copy.
        items: [],
        funding: newFunding,
      }),
      select: { id: true },
    }),
  ])
  revalidateSiblings(groupId, expense.id)
  revalidatePath(`/groups/${groupId}/expenses/${created.id}`)
  const fresh = await freshResult(created.id)
  if (!fresh.ok) {
    return fresh
  }
  const old = await freshResult(expense.id)
  return old.ok ? { ...fresh, replaced: old.expense } : fresh
}

/**
 * Soft delete. The WRITE is `cancelledFields` — the SAME helper
 * `setExpenseCancelled` calls (src/lib/expense-cancel.ts), so "these two write
 * the same fields" is a shared function with a pinned test rather than a
 * promise in a comment; only the navigation differs (see this file's header
 * for why that action itself cannot be reused from chat).
 *
 * Cancelling is allowed on an itemised expense, unlike every other edit here:
 * it does not touch shares at all, it removes the whole receipt from
 * settlement — nothing can end up half-applied.
 *
 * Cancelling an already-cancelled expense is a success with nothing written —
 * `resolveReference` never offers a cancelled row as a candidate, so this only
 * happens if the row was cancelled elsewhere between the card opening and the
 * tap.
 */
export async function applyCancel(
  groupId: string,
  expenseId: string,
): Promise<EditResult> {
  const opened = await openEdit(groupId, expenseId)
  if (!opened.ok) return opened
  const { expense } = opened
  if (expense.cancelledAt === null) {
    await prisma.expense.update({
      where: { id: expense.id },
      data: cancelledFields(true, opened.memberId, new Date()),
    })
    revalidateSiblings(groupId, expense.id)
  }
  return freshResult(expense.id)
}
