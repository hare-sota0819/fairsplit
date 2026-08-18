'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { FeedRowView } from '@/components/ExpenseFeed'
import { cancelledFields } from '@/lib/expense-cancel'
import { expenseCreateData } from '@/lib/expense-create'
import { resolveSnapshotRate } from '@/lib/expense-snapshot-rate'
import { feedShareFor } from '@/lib/feed-share'
import { formatMinor, parseAmountToMinor } from '@/lib/format'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { displayRateToStorage } from '@/lib/rate-units'
import {
  expensePayloadSchema,
  type ExpensePayload,
  type FundingSource,
} from '@/lib/schemas/expense'
import {
  allocateEveryone,
  fundingRemainder,
  rateFromDecimalString,
  type ItemSplitMode,
} from '@/lib/settlement'

export interface ExpenseFormState {
  error?: string
  duplicate?: { title: string; amount: string }
  /**
   * Set only on a successful save when the caller opted in via the `stay`
   * form field. The wizard never sends that field, so it always redirects to
   * the expense detail page exactly as before — this is additive, not a
   * replacement. The chat composer sends it because it is mounted in the
   * group's chat transcript: redirecting away from it would break the "stay
   * in the chat, see it land" flow the whole feature exists for. `id` lets a
   * caller tell one success apart from the next (e.g. to reset local state
   * only once per save, not on every re-render).
   *
   * `feedRow` is the saved expense already shaped for `ExpenseFeed`'s
   * `FeedRowView` (`src/lib/feed-rows.ts`'s builder — the same shape
   * `/history` renders), so the caller can show the new row immediately
   * from the action result instead of waiting on a `router.refresh()` —
   * which this Next version can silently drop (docs/SOLVED.md 2026-08-09).
   * `ChatComposer` uses it to build the transcript's `chat.savedSummary`
   * bubble (Task 5, app-shell restructure — home itself has no feed left
   * to show this row in; the bubble is where the invariant is satisfied
   * now). Built with the same helpers `feed-rows.ts` uses (`feedShareFor`,
   * `formatMinor`, the same i18n keys), so it is never out of step with
   * what the next server render of `/history` would produce.
   */
  success?: { id: string; feedRow?: FeedRowView }
}

const THREE_HOURS_MS = 3 * 60 * 60 * 1000

const abs = (x: bigint): bigint => (x < 0n ? -x : x)

/**
 * Turn the chosen funding source into the `walletId` the expense stores.
 *
 * A wallet must belong to the payer and hold the expense's currency —
 * otherwise the money could not have come out of it, and the rate it implies
 * would be nonsense. NEW_CASH_WALLET creates the pot on the spot so that
 * "I paid cash" never requires setting anything up first; it reuses an
 * existing cash wallet if one appeared in the meantime.
 */
async function resolveWalletId(
  source: FundingSource,
  /** Whoever fronted this portion — the payer unless the portion says so. */
  funderId: string,
  currency: string,
): Promise<{ walletId: string | null } | { error: 'invalid' }> {
  // Neither of these draws on a wallet: pay-as-you-go was converted by the
  // bank, and PREPAID_NO_WALLET is money the payer exchanged themselves but
  // keeps no pot for. What tells them apart downstream is `ownRateSnapshot`.
  if (source.kind === 'PAY_AS_YOU_GO' || source.kind === 'PREPAID_NO_WALLET') {
    return { walletId: null }
  }
  if (source.kind === 'WALLET') {
    const wallet = await prisma.wallet.findFirst({
      where: { id: source.walletId, memberId: funderId, currency },
    })
    return wallet ? { walletId: wallet.id } : { error: 'invalid' }
  }
  const existing = await prisma.wallet.findFirst({
    where: { memberId: funderId, currency, type: 'CASH' },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) {
    return { walletId: existing.id }
  }
  const t = await getTranslations('wallet')
  const created = await prisma.wallet.create({
    data: {
      memberId: funderId,
      type: 'CASH',
      label: t('defaultCashLabel'),
      currency,
    },
  })
  return { walletId: created.id }
}

export async function saveExpense(
  _prev: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const expenseId = formData.get('expenseId')?.toString() || null
  // Opt-in, additive: absent for the wizard (every existing call site), set
  // by the chat composer. Read once, up front, mostly to decide the very
  // last step (nothing else before that branches on it) — also used below
  // to swap the rate-unavailable error for chat's own wording, since chat's
  // confirm card has no rate field for the wizard's version to point at.
  const stay = formData.get('stay')?.toString() === '1'
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('expenses.form.errors')
  const tChat = await getTranslations('chat')

  let payload: ExpensePayload
  try {
    payload = expensePayloadSchema.parse(
      JSON.parse(formData.get('payload')?.toString() ?? ''),
    )
  } catch {
    return { error: t('invalidInput') }
  }

  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } })
  const groupMembers = await prisma.member.findMany({ where: { groupId } })
  const memberIds = new Set(groupMembers.map((m) => m.id))

  // Personal expenses never circulate: only the payer shares them.
  const participantIds = payload.isPersonal
    ? [payload.payerId]
    : [...new Set(payload.participantIds)]

  const validMembers =
    memberIds.has(payload.payerId) &&
    participantIds.every((id) => memberIds.has(id)) &&
    payload.items.every((item) =>
      item.assignees.every((a) => participantIds.includes(a.memberId)),
    )
  if (!validMembers) {
    return { error: t('notMember') }
  }

  const amount = parseAmountToMinor(payload.amount, payload.currency)
  if (amount === null || amount === 0n) {
    return { error: t('amountZero') }
  }

  /**
   * One funding portion, resolved: which wallet it drew on, and the payer's
   * own exchange rate when it drew on none.
   *
   * The own rate is anchored by the form to the currency's quote unit
   * ("100 JPY = ___ KRW"); this is the one place that becomes storage units.
   * Same-currency expenses have nothing to convert, so it never applies.
   */
  const resolvePortion = async (
    source: FundingSource,
    ownRateDisplay: string | undefined,
    funderId: string = payload.payerId,
  ): Promise<
    | { walletId: string | null; ownRateSnapshot: string | null }
    | { error: string }
  > => {
    const resolved = await resolveWalletId(source, funderId, payload.currency)
    if ('error' in resolved) {
      return { error: t('invalidInput') }
    }
    if (
      source.kind !== 'PREPAID_NO_WALLET' ||
      payload.currency === group.settlementCurrency
    ) {
      return { walletId: resolved.walletId, ownRateSnapshot: null }
    }
    if (!ownRateDisplay) {
      return { error: t('ownRateRequired') }
    }
    const stored = displayRateToStorage(ownRateDisplay, payload.currency)
    if (stored === null) {
      return { error: t('ownRateRequired') }
    }
    try {
      // Throws on malformed or zero; a rate of 0 would divide by nothing.
      rateFromDecimalString(stored, group.settlementCurrency, payload.currency)
    } catch {
      return { error: t('ownRateRequired') }
    }
    return { walletId: resolved.walletId, ownRateSnapshot: stored }
  }

  // The sources beyond the primary one, each with the amount it covered. A
  // refund goes back where it came from, so splitting one is not offered and
  // is refused here rather than sign-juggled.
  const extras: {
    amount: bigint
    walletId: string | null
    ownRateSnapshot: string | null
    funderId: string | null
  }[] = []
  if (payload.extraFunding.length > 0 && amount < 0n) {
    return { error: t('invalidInput') }
  }
  for (const extra of payload.extraFunding) {
    const extraAmount = parseAmountToMinor(extra.amount, payload.currency)
    if (extraAmount === null || extraAmount <= 0n) {
      return { error: t('fundingAmount') }
    }
    // A portion someone else fronted names them. The id is checked against
    // THIS group's active members: an id from another group would credit a
    // stranger, and one who has left cannot have paid for tonight's dinner.
    const funderId =
      extra.memberId && extra.memberId !== payload.payerId
        ? extra.memberId
        : null
    if (funderId !== null) {
      const funder = await prisma.member.findFirst({
        where: { id: funderId, groupId, leftAt: null },
        select: { id: true },
      })
      if (!funder) {
        return { error: t('invalidInput') }
      }
    }
    const resolved = await resolvePortion(
      extra.source,
      extra.ownRateDisplay,
      funderId ?? payload.payerId,
    )
    if ('error' in resolved) {
      return { error: resolved.error }
    }
    extras.push({ amount: extraAmount, funderId, ...resolved })
  }

  const primary = await resolvePortion(
    payload.fundingSource,
    payload.ownRateDisplay,
  )
  if ('error' in primary) {
    return { error: primary.error }
  }
  // The primary covers what is left, which is what makes the portions add up
  // to the expense by construction. Overshooting them is the one way that can
  // fail, and it must not reach the engine.
  const primaryAmount = fundingRemainder(amount, extras)
  if (primaryAmount < 0n) {
    return { error: t('fundingOver') }
  }
  const fundingRows = [
    // A primary of exactly zero is dropped rather than stored: the extras
    // covered the whole receipt, and a zero portion has no rate to resolve.
    ...(primaryAmount === 0n
      ? []
      : [{ position: 0, amount: primaryAmount, funderId: null, ...primary }]),
    ...extras.map((extra, index) => ({ position: index + 1, ...extra })),
  ]

  const itemRows: {
    name: string
    unitAmount: bigint
    quantity: number
    splitMode: ItemSplitMode
    assignees: { memberId: string; quantity: number; amount?: bigint }[]
  }[] = []
  for (const item of payload.items) {
    const unitAmount = parseAmountToMinor(item.unitAmount, payload.currency)
    if (unitAmount === null) {
      return { error: t('invalidInput') }
    }
    // One row per member; the last quantity for a member wins.
    const assignees = new Map<string, number>()
    for (const assignee of item.assignees) {
      assignees.set(assignee.memberId, assignee.quantity)
    }
    // A line "Everyone" divided by money: the client sends only the mode and
    // who shared it, and the shares are derived HERE. That is what makes
    // "the amounts sum exactly to the line total" an invariant of the stored
    // data rather than a promise about the client. `allocateEveryone` also
    // corrects the mode back to BY_QUANTITY when the units do in fact go
    // round, so a stale flag cannot outlive an edit to the quantity.
    if (item.splitMode === 'BY_AMOUNT' && assignees.size > 0) {
      const divided = allocateEveryone(
        { quantity: item.quantity, unitAmount },
        [...assignees.keys()],
        payload.payerId,
      )
      itemRows.push({
        name: item.name,
        unitAmount,
        quantity: item.quantity,
        splitMode: divided.splitMode,
        assignees: divided.assignees.map((a) => ({
          memberId: a.memberId,
          quantity: a.quantity,
          ...(a.amount === undefined ? {} : { amount: a.amount }),
        })),
      })
      continue
    }
    // Assigning more units than the line holds cannot be satisfied and the
    // wizard blocks it; refuse it here too rather than store a contradiction.
    const assigned = [...assignees.values()].reduce((a, b) => a + b, 0)
    if (item.quantity > 1 && assigned > item.quantity) {
      return { error: t('overAssigned') }
    }
    itemRows.push({
      name: item.name,
      unitAmount,
      quantity: item.quantity,
      splitMode: 'BY_QUANTITY',
      assignees: [...assignees].map(([memberId, quantity]) => ({
        memberId,
        quantity,
      })),
    })
  }

  const timestamp = new Date(payload.timestampIso)
  if (Number.isNaN(timestamp.getTime())) {
    return { error: t('invalidInput') }
  }

  // Snapshot is set exactly once, at creation, and never updated. Manual
  // entry is an override; otherwise the provider fills it (cached). The
  // provider must never block entry: on failure we ask for manual input.
  let marketRateSnapshot: string | undefined
  let marketRateProvisional = false
  if (!expenseId) {
    if (payload.currency === group.settlementCurrency) {
      marketRateSnapshot = '1'
    } else if (payload.marketRateDisplay) {
      // The form anchors the input to the currency's quote unit ("100 JPY =
      // ___ KRW"); this is the one place that unit becomes storage units.
      const stored = displayRateToStorage(
        payload.marketRateDisplay,
        payload.currency,
      )
      if (stored === null) {
        return { error: t('invalidInput') }
      }
      try {
        rateFromDecimalString(
          stored,
          group.settlementCurrency,
          payload.currency,
        )
        marketRateSnapshot = stored
      } catch {
        return { error: t('invalidInput') }
      }
    } else {
      // The provider (cached), with the single-wallet stand-in behind it —
      // shared with the chat's currency swap, which re-creates an expense and
      // must price it exactly as a fresh entry at the same instant would
      // (src/lib/expense-snapshot-rate.ts).
      const resolved = await resolveSnapshotRate({
        timestamp,
        currency: payload.currency,
        settlementCurrency: group.settlementCurrency,
        funding: fundingRows,
      })
      if (resolved === null) {
        // Chat's confirm card has no rate field, unlike the wizard's next
        // step — the wizard's wording ("enter the market rate manually")
        // would send a chat user looking for a field that isn't there.
        // `chat.rateUnavailable` points at the one place that DOES have
        // it: the full form (`chat.openForm`).
        return { error: stay ? tChat('rateUnavailable') : t('rateUnavailable') }
      }
      marketRateSnapshot = resolved.rate
      marketRateProvisional = resolved.provisional
    }
  }

  const title = payload.note?.trim() || itemRows[0]?.name || ''

  if (!expenseId && !payload.force) {
    const nearby = await prisma.expense.findMany({
      where: {
        groupId,
        currency: payload.currency,
        timestamp: {
          gte: new Date(timestamp.getTime() - THREE_HOURS_MS),
          lte: new Date(timestamp.getTime() + THREE_HOURS_MS),
        },
      },
      take: 50,
    })
    const similar = nearby.find(
      (other) => abs(other.amount - amount) * 100n <= abs(other.amount),
    )
    if (similar) {
      return {
        duplicate: {
          title: similar.title || title,
          amount: formatMinor(similar.amount, similar.currency),
        },
      }
    }
  }

  /**
   * MONEY EXCHANGED AT THE TILL, saved before the expense that prompted it.
   *
   * A prepaid card that cannot cover the bill is almost never a receipt paid
   * from two pockets — it is a card that was topped up on the spot. Recording
   * that as a top-up rather than as a "correction" is what keeps the rate:
   * the new money's price joins the wallet's average cost, which is the rate
   * every expense paid from it settles at.
   *
   * It is an ORDINARY exchange record with no link back to this expense. The
   * money really was exchanged, so it stays true however this receipt is
   * later edited or cancelled — and a re-opened expense finds the wallet
   * already funded, so nothing offers to exchange it a second time.
   */
  if (payload.topUp) {
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: payload.topUp.walletId,
        memberId: payload.payerId,
        currency: payload.currency,
      },
    })
    if (!wallet) {
      return { error: t('invalidInput') }
    }
    const received = parseAmountToMinor(payload.topUp.amount, wallet.currency)
    const paid = parseAmountToMinor(
      payload.topUp.paid,
      group.settlementCurrency,
    )
    if (received === null || received <= 0n || paid === null || paid <= 0n) {
      return { error: t('invalidInput') }
    }
    await prisma.exchangeRecord.create({
      data: {
        memberId: payload.payerId,
        walletId: wallet.id,
        amountPaid: paid,
        amountReceived: received,
        currency: wallet.currency,
        timestamp,
      },
    })
  }

  const itemCreates = itemRows.map((item) => ({
    name: item.name,
    unitAmount: item.unitAmount,
    quantity: item.quantity,
    splitMode: item.splitMode,
    assignments: {
      create: item.assignees.map((a) => ({
        memberId: a.memberId,
        quantity: a.quantity,
        amount: a.amount ?? null,
      })),
    },
  }))

  let id: string
  if (expenseId) {
    const existing = await prisma.expense.findFirst({
      where: { id: expenseId, groupId },
      include: { funding: { orderBy: { position: 'asc' } } },
    })
    if (!existing) {
      notFound()
    }
    // The bank-statement figure survives an edit, exactly as it did when it
    // was a column the wizard did not list: it is corrected on the detail
    // screen once a statement posts, and the wizard has never seen it. It
    // only carries over onto a portion that could still have one — a
    // pay-as-you-go portion — because a wallet prices its own money.
    const previousCharged = existing.funding[0]?.actualChargedAmount ?? null
    // Update never touches marketRateSnapshot, currency, or enteredById.
    await prisma.$transaction([
      prisma.expenseParticipant.deleteMany({ where: { expenseId } }),
      prisma.expenseItem.deleteMany({ where: { expenseId } }),
      prisma.expenseFunding.deleteMany({ where: { expenseId } }),
      prisma.expense.update({
        where: { id: expenseId },
        data: {
          title,
          payerId: payload.payerId,
          amount,
          timestamp,
          note: payload.note?.trim() || null,
          isPersonal: payload.isPersonal,
          receiptImagePath: payload.receiptImagePath ?? null,
          updatedById: member.id,
          participants: {
            create: participantIds.map((memberId) => ({ memberId })),
          },
          items: { create: itemCreates },
          funding: {
            create: fundingRows.map((row, index) => ({
              ...row,
              // The bank figure belongs to the portion it billed, and only
              // when that portion could still have one.
              actualChargedAmount:
                index === 0 && row.walletId === null ? previousCharged : null,
            })),
          },
        },
      }),
    ])
    id = expenseId
  } else {
    const created = await prisma.expense.create({
      // The one create shape, shared with the chat's currency swap
      // (src/lib/expense-create.ts) so a re-created expense can never miss a
      // column this path fills.
      data: expenseCreateData({
        groupId,
        title,
        payerId: payload.payerId,
        amount,
        currency: payload.currency,
        timestamp,
        marketRateSnapshot: marketRateSnapshot!,
        marketRateProvisional,
        note: payload.note?.trim() || null,
        isPersonal: payload.isPersonal,
        receiptImagePath: payload.receiptImagePath ?? null,
        enteredById: member.id,
        participantIds,
        items: itemCreates,
        funding: fundingRows,
      }),
    })
    id = created.id
  }
  // The chat composer stays where it is rather than following the wizard to
  // the expense detail page — it is mounted in the group's chat transcript
  // (Task 5, app-shell restructure: home itself has no feed of its own any
  // more), and leaving would defeat the point of entering it there. Server
  // actions do not re-render the route they were fired from (docs/SOLVED.md
  // 2026-08-01, 2026-08-03), so the caller is responsible for refreshing
  // whatever it renders once it sees this — this action does not, and must
  // not, revalidatePath its own route to do that for it.
  //
  // The response also carries the row itself, ready for the transcript's
  // saved-summary bubble: the caller's follow-up refresh is intermittently
  // dropped by this Next version's client (docs/SOLVED.md 2026-08-09 — the
  // data arrives, React loses the re-render), so the one thing the user is
  // watching for must not depend on it — the bubble renders straight from
  // THIS return value and stays put regardless of what the refresh does.
  // Same shapes and same i18n keys as `src/lib/feed-rows.ts`'s builder (what
  // `/history` renders), so nothing here can drift from what a full reload
  // would show. `chip` is hard null: chat only ever submits
  // settlement-currency expenses, which never show a rate chip (history/the
  // expense detail show one only for a foreign currency or a bank-charged
  // correction, neither of which a fresh stay-save can be).
  if (stay) {
    const tHome = await getTranslations('home')
    const payerName =
      groupMembers.find((m) => m.id === payload.payerId)?.name ?? ''
    const share = feedShareFor(
      { amount, items: itemRows, participantIds },
      member.id,
    )
    const feedRow: FeedRowView = {
      id,
      href: `/groups/${groupId}/expenses/${id}`,
      title: title || payerName,
      meta: `${payerName} · ${tHome('itemCount', {
        count: itemRows.length,
      })} · ${tHome('enteredByShort', { name: member.name })}`,
      amount: formatMinor(share?.total ?? 0n, payload.currency),
      receiptTotal: formatMinor(amount, payload.currency),
      none: share === null,
      evenSplit: share?.evenSplitOf
        ? tHome('feedEvenSplit', { count: share.evenSplitOf.among })
        : null,
      cancelled: false,
      chip: null,
      items: (share?.lines ?? []).map((line) => ({
        key: line.key,
        name:
          line.name === null
            ? tHome('feedRest')
            : line.splitMode === 'BY_QUANTITY' && line.units > 1
              ? `${line.name} ×${line.units}`
              : line.name,
        amount: formatMinor(line.amount, payload.currency),
      })),
    }
    return { success: { id, feedRow } }
  }
  // `created=1` lets the detail page show the one-time exchange-records
  // onboarding prompt right after a fresh entry (never after edits). Both
  // flags also tell the detail page the save succeeded, which is the only
  // moment a parked draft may be dropped.
  redirect(
    `/groups/${groupId}/expenses/${id}${expenseId ? '?saved=1' : '?created=1'}`,
  )
}

/**
 * Soft delete / restore. Cancelled expenses leave every settlement and
 * wallet computation but stay in feeds, flagged. Audit-logged via the
 * cancelledBy/updatedBy fields; no hard delete exists.
 *
 * The WRITE itself is `cancelledFields` (src/lib/expense-cancel.ts), shared
 * with the chat's own cancel (`applyCancel`, chat-edit-actions.ts) — the two
 * differ only in where they leave the user afterwards, and a shared helper
 * with a pinned test is what keeps that true.
 */
export async function setExpenseCancelled(formData: FormData): Promise<void> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const expenseId = formData.get('expenseId')?.toString() ?? ''
  const cancelled = formData.get('cancelled')?.toString() === 'true'
  const { member } = await requireGroupMember(groupId)

  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId },
  })
  if (!expense) {
    notFound()
  }
  await prisma.expense.update({
    where: { id: expense.id },
    data: cancelledFields(cancelled, member.id, new Date()),
  })
  // The redirect below goes to the page the user is ALREADY on, so without
  // this the Client Router Cache can answer it with the copy it took before
  // the update and the screen comes back unchanged — the intermittent
  // "cancelled banner never appeared" in docs/BUGS.md. This is not the
  // unreliable use of revalidatePath the project warns about (re-rendering
  // the route an action was fired from); it only drops the cache entry the
  // redirect is about to read. The group page is invalidated too, because the
  // feed row greys out and every balance on it moves.
  revalidatePath(`/groups/${groupId}/expenses/${expenseId}`)
  revalidatePath(`/groups/${groupId}`)
  redirect(`/groups/${groupId}/expenses/${expenseId}`)
}
