'use server'

import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isFrozenExpense } from '@/lib/checkpoint-freeze'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { formatMinor, parseAmountToMinor } from '@/lib/format'

export interface BankChargedState {
  error?: string
  saved?: boolean
  /** Formatted current figure after the action ran; '' means cleared. */
  amount?: string
}

/**
 * The bank-statement correction, entered on the expense DETAIL screen once a
 * statement posts (Phase 4D-A moved this out of the wizard, where nobody has
 * their bank app open mid-dinner). Never touches marketRateSnapshot,
 * currency, or ownRateSnapshot — this is a later correction layered on top,
 * not a re-snapshot.
 */
export async function setActualCharged(
  _prev: BankChargedState,
  formData: FormData,
): Promise<BankChargedState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const expenseId = formData.get('expenseId')?.toString() ?? ''
  await requireGroupMember(groupId)

  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId },
    include: { funding: { orderBy: { position: 'asc' } } },
  })
  if (!expense) {
    notFound()
  }
  // The bank figure IS the rate in AVG_COST mode, so writing one onto a
  // settled expense would reprice a period the group has already paid on.
  if (isFrozenExpense(expense)) {
    return { error: (await getTranslations('expenses'))('frozenError') }
  }
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
  })
  // A bank billed a card, not a card AND a pocketful of cash: a receipt paid
  // from several sources has no single figure to correct, and the detail
  // screen does not offer the form for one.
  const funding = expense.funding.length === 1 ? expense.funding[0] : null
  if (!funding || funding.walletId !== null) {
    const t = await getTranslations('expenses.detail.bankCharged')
    return { error: t('invalid', { settlement: group.settlementCurrency }) }
  }

  const raw = formData.get('actualCharged')?.toString() ?? ''
  const trimmed = raw.trim()

  if (trimmed === '') {
    await prisma.expenseFunding.update({
      where: { id: funding.id },
      data: { actualChargedAmount: null },
    })
    return { saved: true, amount: '' }
  }

  const parsed = parseAmountToMinor(trimmed, group.settlementCurrency)
  const sameSign =
    parsed !== null &&
    ((parsed > 0n && expense.amount > 0n) ||
      (parsed < 0n && expense.amount < 0n))
  if (parsed === null || parsed === 0n || !sameSign) {
    const t = await getTranslations('expenses.detail.bankCharged')
    return { error: t('invalid', { settlement: group.settlementCurrency }) }
  }

  await prisma.expenseFunding.update({
    where: { id: funding.id },
    data: { actualChargedAmount: parsed },
  })
  return {
    saved: true,
    amount: formatMinor(parsed, group.settlementCurrency),
  }
}

export interface KeepAsWalletState {
  created?: boolean
}

/**
 * The post-save "keep it as a wallet?" offer. Creates a CASH wallet for the
 * acting member in the given currency, reusing an existing one if it
 * appeared in the meantime (same idempotency as resolveWalletId in
 * ../actions.ts). Never retro-links the just-saved expense to it: that
 * expense's rate is already snapshotted, and snapshots are immutable here.
 */
export async function createWalletForCurrency(
  _prev: KeepAsWalletState,
  formData: FormData,
): Promise<KeepAsWalletState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const currency = formData.get('currency')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)

  const existing = await prisma.wallet.findFirst({
    where: { memberId: member.id, currency, type: 'CASH' },
    orderBy: { createdAt: 'asc' },
  })
  if (!existing) {
    const t = await getTranslations('wallet')
    await prisma.wallet.create({
      data: {
        memberId: member.id,
        type: 'CASH',
        label: t('defaultCashLabel'),
        currency,
      },
    })
  }
  return { created: true }
}
