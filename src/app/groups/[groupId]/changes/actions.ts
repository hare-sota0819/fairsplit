'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Prisma, type RetroChangeKind } from '@prisma/client'
import { deriveExpenseWrite } from '@/lib/expense-derive'
import { loadGroupData } from '@/lib/group-data'
import { isSettleable, toEngineExpense } from '@/lib/engine-map'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import {
  applyRetroPlan,
  type RetroAuditEntry,
  type RetroPlan,
} from '@/lib/retro-apply'
import {
  balanceDiff,
  consentSet,
  expiryOf,
  outcomeOf,
  pendingProgress,
  type StakeholderAnswer,
} from '@/lib/retro-change'
import {
  decodeDiff,
  encodeDiff,
  encodeProposal,
  proposalIsSettleable,
  proposalToEngineExpense,
  type RetroProposal,
  type StoredBalanceDiff,
} from '@/lib/retro-proposal'
import { expensePayloadSchema } from '@/lib/schemas/expense'
import type { ExpenseFormState } from '../expenses/actions'
import {
  computeNetBalances,
  convertFunding,
  type ExpenseInput,
  type MemberId,
  type SettlementContext,
} from '@/lib/settlement'

export interface ChangeFormState {
  error?: string
  /** Set when the change went through with nobody worse off. */
  applied?: boolean
  /** Set when the change is now waiting on the members it would cost. */
  requested?: boolean
}

/** Postgres unique-violation: the partial index on one pending per group. */
const UNIQUE_VIOLATION = 'P2002'

/**
 * Turn 72 hours of silence into a rejection.
 *
 * Called at the top of every path that reads or acts on a request, because
 * this app has no scheduler. The effect is the same as one: nothing can see or
 * act on a request without this having run first, so an expired request can
 * never be approved by someone arriving late.
 */
export async function settleExpiredRequests(groupId: string): Promise<void> {
  const pending = await prisma.retroChangeRequest.findMany({
    where: { groupId, status: 'PENDING' },
    include: { responses: true },
  })
  if (pending.length === 0) {
    return
  }
  const now = new Date()
  for (const request of pending) {
    const progress = pendingProgress(
      request.createdAt,
      now,
      request.reminderSentAt,
    )
    if (progress === 'REMIND') {
      await prisma.retroChangeRequest.update({
        where: { id: request.id },
        data: { reminderSentAt: now },
      })
      continue
    }
    if (progress !== 'EXPIRED') {
      continue
    }
    const audit: RetroAuditEntry = {
      kind: 'RETRO_CHANGE_EXPIRED',
      requestId: request.id,
      expenseId: request.expenseId,
      changeKind: request.kind,
      requestedById: request.requestedById,
      checkpointIds: request.checkpointIds,
      stakeholders: request.responses.map((row) => ({
        memberId: row.memberId,
        response: row.response,
      })),
      balanceDiff: request.balanceDiff as unknown as StoredBalanceDiff,
      proposal: (request.proposal as unknown as RetroProposal | null) ?? null,
    }
    await prisma.$transaction(async (tx) => {
      const { prismaRetroWriter } = await import('./writer')
      await applyRetroPlan(prismaRetroWriter(tx, groupId), {
        requestId: request.id,
        expenseId: request.expenseId,
        // Nobody performed an expiry; it is the absence of an act.
        actorId: null,
        decision: 'EXPIRED',
        decidedAt: now,
        // Silence never moves money: an expiry applies nothing at all.
        effect: null,
        audit,
      })
    })
  }
}

/** The balances a set of expense rows produces, keyed by member. */
function balancesOf(
  expenses: ExpenseInput[],
  mode: 'AVG_COST' | 'MARKET',
  context: SettlementContext,
): Map<MemberId, bigint> {
  return computeNetBalances(expenses, mode, context)
}

/**
 * The checkpoint an expense at `timestamp` belongs to: the nearest one at or
 * after it (the membership rule the schema has documented since Phase 1).
 * Null means it lands after every barrier and is not settled at all — which an
 * edit can genuinely do by moving a date forward.
 */
async function checkpointCovering(
  groupId: string,
  timestamp: Date,
): Promise<string | null> {
  const checkpoint = await prisma.checkpoint.findFirst({
    where: { groupId, timestamp: { gte: timestamp } },
    orderBy: { timestamp: 'asc' },
    select: { id: true },
  })
  return checkpoint?.id ?? null
}

interface ProposalOutcome {
  proposal: RetroProposal | null
  diff: Map<string, bigint>
  checkpointIds: string[]
}

/**
 * What a proposed change would do, priced once and for all.
 *
 * "Before" is the group's balances as they stand; "after" is the same
 * computation over the same expenses with this one change made. Both come out
 * of `computeNetBalances`, so the diff is a difference between two things the
 * settlement screen would actually show — not an estimate of one.
 */
async function priceProposal(
  groupId: string,
  expenseId: string,
  kind: RetroChangeKind,
  payload: unknown,
): Promise<ProposalOutcome | { error: string }> {
  const t = await getTranslations('changes.errors')
  const data = await loadGroupData(groupId)
  const { group, mode, context } = data

  const target = data.expenses.find((expense) => expense.id === expenseId)
  if (!target) {
    notFound()
  }

  const others = data.expenses
    .filter((expense) => expense.id !== expenseId && isSettleable(expense))
    .map(toEngineExpense)
  const targetSettleable = isSettleable(target)
  const before = balancesOf(
    targetSettleable ? [...others, toEngineExpense(target)] : others,
    mode,
    context,
  )

  if (kind === 'CANCEL' || kind === 'RESTORE') {
    // Neither reprices anything: the expense leaves the balance or comes back
    // to it carrying the rates it was already frozen at.
    const after = balancesOf(
      kind === 'CANCEL' ? others : [...others, toEngineExpense(target)],
      mode,
      context,
    )
    return {
      proposal: null,
      diff: balanceDiff(before, after),
      checkpointIds: target.frozenAtCheckpointId
        ? [target.frozenAtCheckpointId]
        : [],
    }
  }

  const parsed = expensePayloadSchema.safeParse(payload)
  if (!parsed.success) {
    return { error: t('invalidInput') }
  }
  const members = await prisma.member.findMany({ where: { groupId } })
  const derived = await deriveExpenseWrite({
    groupId,
    payload: parsed.data,
    settlementCurrency: group.settlementCurrency,
    members,
  })
  if ('error' in derived) {
    return { error: derived.error }
  }

  // Where the edited expense ends up. An edit may move its date, and moving it
  // past the last checkpoint takes it out of settled money altogether.
  const nextCheckpointId = await checkpointCovering(groupId, derived.timestamp)

  const draft: RetroProposal = {
    // The same rule the save path uses: the note, else the first line's name.
    title: parsed.data.note?.trim() || derived.itemRows[0]?.name || '',
    payerId: parsed.data.payerId,
    note: parsed.data.note?.trim() || null,
    isPersonal: parsed.data.isPersonal,
    receiptImagePath: parsed.data.receiptImagePath ?? null,
    amount: derived.amount.toString(),
    timestampIso: derived.timestamp.toISOString(),
    participantIds: derived.participantIds,
    items: [],
    funding: [],
    frozenAtCheckpointId: nextCheckpointId,
  }

  // Price the proposal at the rates that apply RIGHT NOW — the same call the
  // ordinary save path would make — and keep them. They are both what the
  // approvers are shown and what gets written, which is the only way the two
  // can be guaranteed equal.
  const priced = convertFunding(
    {
      payerId: parsed.data.payerId,
      amount: derived.amount,
      currency: target.currency,
      marketRateSnapshot: target.marketRateSnapshot.toString(),
      funding: derived.fundingRows.map((row) => ({
        amount: row.amount,
        walletId: row.walletId,
        ...(row.ownRateSnapshot === null
          ? {}
          : { ownRateSnapshot: row.ownRateSnapshot }),
        ...(row.funderId === null ? {} : { memberId: row.funderId }),
      })),
    },
    mode,
    context,
  )

  const proposal = encodeProposal({
    title: draft.title,
    payerId: draft.payerId,
    note: draft.note,
    isPersonal: draft.isPersonal,
    receiptImagePath: draft.receiptImagePath,
    amount: derived.amount,
    timestamp: derived.timestamp,
    participantIds: derived.participantIds,
    items: derived.itemRows,
    funding: derived.fundingRows,
    priced: priced.portions.map((portion) => ({
      rateNum: portion.resolution.rate.numerator,
      rateDen: portion.resolution.rate.denominator,
      source: portion.resolution.source,
      settlement: portion.settlement,
    })),
    frozenAtCheckpointId: nextCheckpointId,
  })

  const proposedExpense = proposalToEngineExpense(proposal, {
    currency: target.currency,
    marketRateSnapshot: target.marketRateSnapshot.toString(),
  })
  const after = balancesOf(
    proposalIsSettleable(proposal) ? [...others, proposedExpense] : others,
    mode,
    context,
  )

  const checkpointIds = [
    ...new Set(
      [target.frozenAtCheckpointId, nextCheckpointId].filter(
        (id): id is string => id !== null,
      ),
    ),
  ]
  return { proposal, diff: balanceDiff(before, after), checkpointIds }
}

/**
 * Open a retroactive change — or, when nobody would be worse off, just make it.
 *
 * The auto-approval shortcut is not an exception to the stakeholder rule, it
 * is that rule with an empty consent set: there is nobody to ask, so there is
 * nothing to wait for.
 */
async function propose(
  groupId: string,
  expenseId: string,
  kind: RetroChangeKind,
  payload: unknown,
): Promise<ChangeFormState> {
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('changes.errors')

  // Before anything else: a request whose 72 hours ran out is already
  // rejected, and must not go on blocking the group.
  await settleExpiredRequests(groupId)

  const priced = await priceProposal(groupId, expenseId, kind, payload)
  if ('error' in priced) {
    return { error: priced.error }
  }
  const stakeholders = consentSet(priced.diff, member.id)
  const now = new Date()
  const auditBase = {
    expenseId,
    changeKind: kind,
    requestedById: member.id,
    checkpointIds: priced.checkpointIds,
    balanceDiff: encodeDiff(priced.diff),
    proposal: priced.proposal,
  }
  const effect =
    kind === 'EDIT'
      ? { kind: 'EDIT' as const, proposal: priced.proposal! }
      : kind === 'CANCEL'
        ? { kind: 'CANCEL' as const }
        : { kind: 'RESTORE' as const }

  try {
    await prisma.$transaction(async (tx) => {
      // The row is created PENDING even when it is about to be auto-approved,
      // in the same statement the partial unique index guards. That is
      // deliberate: an immediate change moves balances too, and letting one
      // through while a request is pending would invalidate the very diff its
      // approvers are looking at. Serialization covers every change, not only
      // the ones that wait.
      const request = await tx.retroChangeRequest.create({
        data: {
          groupId,
          expenseId,
          kind,
          requestedById: member.id,
          proposal: (priced.proposal ??
            Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
          balanceDiff: encodeDiff(
            priced.diff,
          ) as unknown as Prisma.InputJsonValue,
          checkpointIds: priced.checkpointIds,
          expiresAt: expiryOf(now),
          responses: {
            create: stakeholders.map((memberId) => ({ memberId })),
          },
        },
      })
      if (stakeholders.length > 0) {
        return
      }
      const { prismaRetroWriter } = await import('./writer')
      const plan: RetroPlan = {
        requestId: request.id,
        expenseId,
        actorId: member.id,
        decision: 'AUTO_APPROVED',
        decidedAt: now,
        effect,
        audit: {
          kind: 'RETRO_CHANGE_AUTO_APPROVED',
          requestId: request.id,
          // Nobody was asked, so the stakeholder list is empty — and that
          // emptiness IS the reason it went straight through.
          stakeholders: [],
          ...auditBase,
        },
      }
      await applyRetroPlan(prismaRetroWriter(tx, groupId), plan)
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      return { error: t('anotherPending') }
    }
    throw error
  }

  revalidatePath(`/groups/${groupId}`, 'layout')
  return stakeholders.length === 0 ? { applied: true } : { requested: true }
}

export async function proposeExpenseEdit(
  _prev: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const expenseId = formData.get('expenseId')?.toString() ?? ''
  let payload: unknown
  try {
    payload = JSON.parse(formData.get('payload')?.toString() ?? '')
  } catch {
    const t = await getTranslations('changes.errors')
    return { error: t('invalidInput') }
  }
  return propose(groupId, expenseId, 'EDIT', payload)
}

/**
 * The wizard's action when it is editing a SETTLED expense.
 *
 * Same form, same payload, same validation — only the destination differs, and
 * that is the point of the seam: a member correcting a settled receipt fills
 * in exactly what they always fill in, and the app turns it into a request
 * rather than refusing them.
 *
 * Shaped as `ExpenseFormState` so `ExpenseForm` needs no knowledge of any of
 * this; success is a redirect, so the only value that ever comes back is an
 * error the form already knows how to show.
 */
export async function proposeExpenseEditFromWizard(
  _prev: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const expenseId = formData.get('expenseId')?.toString() ?? ''
  const result = await proposeExpenseEdit({}, formData)
  if (result.error) {
    return { error: result.error }
  }
  // Applied outright (nobody worse off) lands back on the expense, which now
  // shows the new figures; a request lands on the request, which is the only
  // place the numbers it proposes are allowed to be seen.
  redirect(
    result.applied
      ? `/groups/${groupId}/expenses/${expenseId}?saved=1`
      : `/groups/${groupId}/changes?requested=1`,
  )
}

export async function proposeExpenseCancel(
  _prev: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const expenseId = formData.get('expenseId')?.toString() ?? ''
  const restore = formData.get('restore')?.toString() === 'true'
  return propose(groupId, expenseId, restore ? 'RESTORE' : 'CANCEL', null)
}

/**
 * A stakeholder answers.
 *
 * One refusal ends the request outright — a balance is owed to a person, not
 * to a majority — and the change lands only once everyone asked has said yes.
 */
export async function respondToChange(
  _prev: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const requestId = formData.get('requestId')?.toString() ?? ''
  const approve = formData.get('approve')?.toString() === 'true'
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('changes.errors')

  await settleExpiredRequests(groupId)

  const request = await prisma.retroChangeRequest.findFirst({
    where: { id: requestId, groupId, status: 'PENDING' },
    include: { responses: true },
  })
  if (!request) {
    return { error: t('notPending') }
  }
  if (!request.responses.some((row) => row.memberId === member.id)) {
    // Not in the consent set: this change does not cost them anything, so
    // there is nothing for them to agree to.
    return { error: t('notStakeholder') }
  }

  const now = new Date()
  await prisma.retroChangeResponse.update({
    where: { requestId_memberId: { requestId, memberId: member.id } },
    data: { response: approve ? 'APPROVED' : 'REJECTED', respondedAt: now },
  })

  const answers: StakeholderAnswer[] = request.responses.map((row) =>
    row.memberId === member.id
      ? approve
        ? 'APPROVED'
        : 'REJECTED'
      : row.response,
  )
  const outcome = outcomeOf(answers)
  if (outcome === 'PENDING') {
    // Answering changes this whole screen — the request either goes away or
    // starts waiting on somebody else — and a server action does not re-render
    // the route it was fired from (docs/SOLVED.md 2026-08-01). Redirect back
    // onto it so the render that follows is a fresh one.
    revalidatePath(`/groups/${groupId}`, 'layout')
    redirect(`/groups/${groupId}/changes`)
  }

  const audit: RetroAuditEntry = {
    kind:
      outcome === 'APPROVED'
        ? 'RETRO_CHANGE_APPROVED'
        : 'RETRO_CHANGE_REJECTED',
    requestId,
    expenseId: request.expenseId,
    changeKind: request.kind,
    requestedById: request.requestedById,
    checkpointIds: request.checkpointIds,
    stakeholders: request.responses.map((row) => ({
      memberId: row.memberId,
      response:
        row.memberId === member.id
          ? approve
            ? 'APPROVED'
            : 'REJECTED'
          : row.response,
    })),
    balanceDiff: request.balanceDiff as unknown as StoredBalanceDiff,
    proposal: (request.proposal as RetroProposal | null) ?? null,
  }

  await prisma.$transaction(async (tx) => {
    const { prismaRetroWriter } = await import('./writer')
    await applyRetroPlan(prismaRetroWriter(tx, groupId), {
      requestId,
      expenseId: request.expenseId,
      actorId: member.id,
      decision: outcome,
      decidedAt: now,
      effect:
        outcome === 'REJECTED'
          ? null
          : request.kind === 'EDIT'
            ? {
                kind: 'EDIT',
                proposal: request.proposal as unknown as RetroProposal,
              }
            : { kind: request.kind },
      audit,
    })
  })

  revalidatePath(`/groups/${groupId}`, 'layout')
  redirect(`/groups/${groupId}/changes`)
}

/** The open request, if there is one — the badge and the detail both read it. */
export async function loadPendingRequest(groupId: string) {
  await settleExpiredRequests(groupId)
  const request = await prisma.retroChangeRequest.findFirst({
    where: { groupId, status: 'PENDING' },
    include: {
      requestedBy: { select: { id: true, name: true } },
      expense: { select: { id: true, title: true, currency: true } },
      responses: { include: { member: { select: { id: true, name: true } } } },
    },
  })
  if (!request) {
    return null
  }
  return {
    ...request,
    diff: decodeDiff(request.balanceDiff as unknown as StoredBalanceDiff),
  }
}

/** Everything the change screen shows: the open request plus what happened before. */
export async function loadChangeHistory(groupId: string) {
  await settleExpiredRequests(groupId)
  return prisma.auditEvent.findMany({
    where: { groupId },
    orderBy: { at: 'desc' },
    take: 50,
    include: { actor: { select: { name: true } } },
  })
}
