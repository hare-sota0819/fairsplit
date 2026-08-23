'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isFrozenExpense } from '@/lib/checkpoint-freeze'
import { cancelledFields } from '@/lib/expense-cancel'
import { expenseCreateData } from '@/lib/expense-create'
import { deriveExpenseWrite } from '@/lib/expense-derive'
import { resolveSnapshotRate } from '@/lib/expense-snapshot-rate'
import { formatMinor, parseAmountToMinor } from '@/lib/format'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { displayRateToStorage } from '@/lib/rate-units'
import {
  expensePayloadSchema,
  type ExpensePayload,
} from '@/lib/schemas/expense'
import { rateFromDecimalString } from '@/lib/settlement'

export interface ExpenseFormState {
  error?: string
  duplicate?: { title: string; amount: string }
}

const THREE_HOURS_MS = 3 * 60 * 60 * 1000

const abs = (x: bigint): bigint => (x < 0n ? -x : x)

export async function saveExpense(
  _prev: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const expenseId = formData.get('expenseId')?.toString() || null
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('expenses.form.errors')
  const tExpenses = await getTranslations('expenses')

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

  // Payload -> rows. Shared with the retroactive change flow, which has to
  // derive a proposal before anyone agrees to it and then write those exact
  // rows once they do (src/lib/expense-derive.ts).
  const derived = await deriveExpenseWrite({
    groupId,
    payload,
    settlementCurrency: group.settlementCurrency,
    members: groupMembers,
  })
  if ('error' in derived) {
    return { error: derived.error }
  }
  const { participantIds, amount, timestamp, fundingRows, itemRows } = derived

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
      // The provider (cached), with the single-wallet stand-in behind it
      // (src/lib/expense-snapshot-rate.ts).
      const resolved = await resolveSnapshotRate({
        timestamp,
        currency: payload.currency,
        settlementCurrency: group.settlementCurrency,
        funding: fundingRows,
      })
      if (resolved === null) {
        return { error: t('rateUnavailable') }
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
    // A settled period is not editable in place. The screens do not offer
    // the button, so reaching here means a request that went around them.
    if (isFrozenExpense(existing)) {
      return { error: tExpenses('frozenError') }
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
      // The one create shape (src/lib/expense-create.ts), pinned by a test
      // so a row created anywhere else can never miss a column this path
      // fills.
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
 * The WRITE itself is `cancelledFields` (src/lib/expense-cancel.ts), kept
 * separate and pinned by a test because the retroactive-change flow has to
 * write those same fields once a proposal is agreed to.
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
  // Cancelling a settled expense would move every balance behind the
  // checkpoint, and restoring one would do the same in reverse. Both are
  // retroactive changes; neither happens from this button, which the detail
  // screen stops rendering the moment the expense is frozen. The redirect
  // below lands on that screen, where the frozen notice explains why nothing
  // happened.
  if (!isFrozenExpense(expense)) {
    await prisma.expense.update({
      where: { id: expense.id },
      data: cancelledFields(cancelled, member.id, new Date()),
    })
  }
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
