'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import {
  formatMinor,
  minorToDecimalInput,
  parseAmountToMinor,
} from '@/lib/format'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { getSnapshotRate } from '@/lib/rates/cached'
import {
  computeAvgRate,
  minorUnitDigits,
  rateToDecimalString,
  walletAdjustmentAmount,
  walletCapacity,
  type ExchangeRecordInput,
  type WalletInfo,
  type WalletType,
} from '@/lib/settlement'
import {
  WALLET_SPEND_SELECT,
  toWalletExpenseRows,
  walletSummaries,
} from '@/lib/wallet-view'

export interface TopUpView {
  id: string
  /** Decimal-input value, settlement currency (for the edit prefill). */
  paid: string
  /** Decimal-input value, wallet currency. */
  received: string
  paidDisplay: string
  receivedDisplay: string
  date: string
}

/** One "count this wallet" correction, listed so it can be taken back. */
export interface AdjustmentView {
  id: string
  /** Signed and formatted: negative means the wallet held more than expected. */
  amountDisplay: string
  date: string
}

export interface WalletView {
  id: string
  label: string
  type: WalletType
  currency: string
  /** Always positive; `overdrawn` decides which template wraps it. */
  remainingAmount: string
  overdrawn: boolean
  hasTopUps: boolean
  /** Where the balance came from, all formatted in the wallet's currency. */
  loadedDisplay: string
  spentDisplay: string
  adjustmentsDisplay: string
  /**
   * The computed balance as a decimal-input value, to pre-fill the count
   * form. Never negative: "how much is actually in here" is a count of what
   * is there, and the action refuses anything below zero.
   */
  countedDefault: string
  /**
   * The computed balance in minor units, SIGNED (an overdrawn wallet is
   * negative), as a decimal string — bigint does not cross the RSC boundary.
   * The form needs the sign to know which question to ask.
   */
  computedRemainingMinor: string
  topUps: TopUpView[]
  adjustments: AdjustmentView[]
}

export interface ExchangeFormState {
  error?: string
  saved?: boolean
  /**
   * The acting member's wallets as of just after a successful write. Server
   * actions do not re-render the route they were fired from, so the whole
   * list travels back with the result rather than waiting on revalidation.
   */
  wallets?: WalletView[]
}

/** The acting member's wallets, each with its own top-ups, newest-first. */
export async function loadWalletViews(
  groupId: string,
  memberId: string,
): Promise<WalletView[]> {
  const [group, wallets, records] = await Promise.all([
    prisma.group.findUniqueOrThrow({ where: { id: groupId } }),
    prisma.wallet.findMany({
      where: { memberId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.exchangeRecord.findMany({
      where: { memberId },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    }),
  ])
  const walletIds = wallets.map((wallet) => wallet.id)
  // Funding PORTIONS, not expense totals: a receipt half paid from a card
  // draws down only that half.
  const expenses = walletIds.length
    ? toWalletExpenseRows(
        await prisma.expenseFunding.findMany({
          where: { walletId: { in: walletIds } },
          select: WALLET_SPEND_SELECT,
        }),
      )
    : []

  const walletInfos: WalletInfo[] = wallets.map((wallet) => ({
    id: wallet.id,
    memberId: wallet.memberId,
    type: wallet.type,
    label: wallet.label,
    currency: wallet.currency,
  }))
  const recordInputs: ExchangeRecordInput[] = records.map((record) => ({
    walletId: record.walletId,
    amountPaid: record.amountPaid,
    amountReceived: record.amountReceived,
    currency: record.currency,
  }))
  const summaryById = new Map(
    walletSummaries(walletInfos, recordInputs, expenses).map((summary) => [
      summary.walletId,
      summary,
    ]),
  )
  const topUpsByWallet = new Map<string, typeof records>()
  for (const record of records) {
    const list = topUpsByWallet.get(record.walletId) ?? []
    list.push(record)
    topUpsByWallet.set(record.walletId, list)
  }

  // The corrections themselves, so the screen that makes them can also take
  // one back. They are expenses, but only ever the app's own synthetic ones.
  const corrections = walletIds.length
    ? await prisma.expenseFunding.findMany({
        where: {
          walletId: { in: walletIds },
          expense: { isWalletAdjustment: true, cancelledAt: null },
        },
        select: {
          walletId: true,
          amount: true,
          expense: { select: { id: true, timestamp: true } },
        },
        orderBy: { expense: { timestamp: 'desc' } },
      })
    : []
  const adjustmentsByWallet = new Map<string, AdjustmentView[]>()
  for (const correction of corrections) {
    if (correction.walletId === null) continue
    const wallet = wallets.find((w) => w.id === correction.walletId)
    if (!wallet) continue
    const list = adjustmentsByWallet.get(correction.walletId) ?? []
    list.push({
      id: correction.expense.id,
      amountDisplay: formatMinor(correction.amount, wallet.currency),
      date: correction.expense.timestamp.toISOString().slice(0, 10),
    })
    adjustmentsByWallet.set(correction.walletId, list)
  }

  return wallets.map((wallet) => {
    const summary = summaryById.get(wallet.id)
    const remaining = summary?.remaining ?? 0n
    return {
      id: wallet.id,
      label: wallet.label,
      type: wallet.type,
      currency: wallet.currency,
      remainingAmount: formatMinor(
        remaining < 0n ? -remaining : remaining,
        wallet.currency,
      ),
      overdrawn: summary?.overdrawn ?? false,
      hasTopUps: summary?.hasTopUps ?? false,
      loadedDisplay: formatMinor(summary?.loaded ?? 0n, wallet.currency),
      spentDisplay: formatMinor(summary?.spent ?? 0n, wallet.currency),
      adjustmentsDisplay: formatMinor(
        summary?.adjustments ?? 0n,
        wallet.currency,
      ),
      countedDefault: minorToDecimalInput(
        walletCapacity(remaining),
        wallet.currency,
      ),
      computedRemainingMinor: remaining.toString(),
      adjustments: adjustmentsByWallet.get(wallet.id) ?? [],
      topUps: (topUpsByWallet.get(wallet.id) ?? []).map((record) => ({
        id: record.id,
        paid: minorToDecimalInput(record.amountPaid, group.settlementCurrency),
        received: minorToDecimalInput(record.amountReceived, record.currency),
        paidDisplay: formatMinor(record.amountPaid, group.settlementCurrency),
        receivedDisplay: formatMinor(record.amountReceived, record.currency),
        date: record.timestamp.toISOString().slice(0, 10),
      })),
    }
  })
}

const walletSchema = z.object({
  walletId: z.string().optional(),
  label: z.string().trim().min(1),
  type: z.enum(['CASH', 'TRAVEL_CARD', 'OTHER_PREPAID']).optional(),
  currency: z.string().optional(),
})

/**
 * Create a wallet, or rename one of the acting member's own. Currency and
 * type are fixed once a wallet exists (its records' currency depends on it),
 * so a rename may only change the label.
 */
export async function saveWallet(
  _prev: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('groups.errors')

  const parsed = walletSchema.safeParse({
    walletId: formData.get('walletId')?.toString() || undefined,
    label: formData.get('label')?.toString(),
    type: formData.get('type')?.toString() || undefined,
    currency: formData.get('currency')?.toString() || undefined,
  })
  if (!parsed.success) {
    return { error: t('invalidInput') }
  }
  const { walletId, label, type, currency } = parsed.data

  if (walletId) {
    const existing = await prisma.wallet.findFirst({
      where: { id: walletId, memberId: member.id },
    })
    if (!existing) {
      return { error: t('invalidInput') }
    }
    await prisma.wallet.update({ where: { id: existing.id }, data: { label } })
  } else {
    if (!type || !currency) {
      return { error: t('invalidInput') }
    }
    try {
      minorUnitDigits(currency)
    } catch {
      return { error: t('invalidInput') }
    }
    await prisma.wallet.create({
      data: { memberId: member.id, label, type, currency },
    })
  }
  revalidatePath(`/groups/${groupId}`, 'layout')
  return { saved: true, wallets: await loadWalletViews(groupId, member.id) }
}

/** Delete one of the acting member's own wallets, only when unused. */
export async function deleteWallet(
  _prev: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  const [t, tWallet] = await Promise.all([
    getTranslations('groups.errors'),
    getTranslations('wallet'),
  ])

  const walletId = formData.get('walletId')?.toString() ?? ''
  const existing = await prisma.wallet.findFirst({
    where: { id: walletId, memberId: member.id },
  })
  if (!existing) {
    return { error: t('invalidInput') }
  }
  const usedByExpenses = await prisma.expenseFunding.count({
    where: { walletId },
  })
  if (usedByExpenses > 0) {
    return { error: tWallet('deleteBlocked') }
  }
  await prisma.wallet.delete({ where: { id: walletId } })
  revalidatePath(`/groups/${groupId}`, 'layout')
  return { saved: true, wallets: await loadWalletViews(groupId, member.id) }
}

const recordSchema = z.object({
  recordId: z.string().optional(),
  walletId: z.string().min(1),
  amountPaid: z.string(),
  amountReceived: z.string(),
  timestamp: z.string().min(1),
})

/**
 * Create or update ONE of the acting member's own top-ups. Member-scoped by
 * construction: the wallet must belong to the session member, and the
 * currency is always taken from the wallet — never trusted from the client.
 */
export async function saveExchangeRecord(
  _prev: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('groups.errors')

  const parsed = recordSchema.safeParse({
    recordId: formData.get('recordId')?.toString() || undefined,
    walletId: formData.get('walletId')?.toString(),
    amountPaid: formData.get('amountPaid')?.toString(),
    amountReceived: formData.get('amountReceived')?.toString(),
    timestamp: formData.get('timestamp')?.toString(),
  })
  if (!parsed.success) {
    return { error: t('invalidInput') }
  }
  const { recordId, walletId } = parsed.data
  const wallet = await prisma.wallet.findFirst({
    where: { id: walletId, memberId: member.id },
  })
  if (!wallet) {
    return { error: t('invalidInput') }
  }

  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } })
  const amountPaid = parseAmountToMinor(
    parsed.data.amountPaid,
    group.settlementCurrency,
  )
  const amountReceived = parseAmountToMinor(
    parsed.data.amountReceived,
    wallet.currency,
  )
  const timestamp = new Date(parsed.data.timestamp)
  if (
    amountPaid === null ||
    amountPaid <= 0n ||
    amountReceived === null ||
    amountReceived <= 0n ||
    Number.isNaN(timestamp.getTime())
  ) {
    return { error: t('invalidInput') }
  }

  if (recordId) {
    const existing = await prisma.exchangeRecord.findFirst({
      where: { id: recordId, memberId: member.id, walletId: wallet.id },
    })
    if (!existing) {
      return { error: t('invalidInput') }
    }
    await prisma.exchangeRecord.update({
      where: { id: existing.id },
      data: {
        amountPaid,
        amountReceived,
        currency: wallet.currency,
        timestamp,
      },
    })
  } else {
    await prisma.exchangeRecord.create({
      data: {
        memberId: member.id,
        walletId: wallet.id,
        amountPaid,
        amountReceived,
        currency: wallet.currency,
        timestamp,
      },
    })
  }
  revalidatePath(`/groups/${groupId}`, 'layout')
  return { saved: true, wallets: await loadWalletViews(groupId, member.id) }
}

/** Delete one of the acting member's OWN top-ups. */
export async function deleteExchangeRecord(
  _prev: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('groups.errors')

  const recordId = formData.get('recordId')?.toString() ?? ''
  const existing = await prisma.exchangeRecord.findFirst({
    where: { id: recordId, memberId: member.id },
  })
  if (!existing) {
    return { error: t('invalidInput') }
  }
  await prisma.exchangeRecord.delete({ where: { id: existing.id } })
  revalidatePath(`/groups/${groupId}`, 'layout')
  return { saved: true, wallets: await loadWalletViews(groupId, member.id) }
}

const adjustSchema = z.object({
  walletId: z.string().min(1),
  counted: z.string(),
  /** Only read on the surplus branch: what the missing top-up cost. */
  paid: z.string().optional(),
})

/**
 * "What's really on it?" — the wallet's balance reconciled against reality.
 *
 * THE SIGN OF THE DIFFERENCE DECIDES WHAT HAPPENED, and the two answers are
 * not variations of one thing:
 *
 *  - LESS than the app expected: money left the wallet that was never
 *    recorded. That is spending, and it is logged as a personal expense
 *    funded from the wallet (flagged `isWalletAdjustment`), so "My spending"
 *    and the wallet agree.
 *  - MORE than the app expected: money ARRIVED that was never recorded, and
 *    money only arrives in a prepaid wallet one way — a top-up. So it is
 *    logged as an exchange record, and the caller must say what it cost,
 *    because that price is the wallet's average cost and therefore the rate
 *    every expense paid from it settles at.
 *
 * The second case used to be recorded as NEGATIVE spending. That balanced
 * the wallet and quietly lied about everything else: an overdrawn card means
 * "you topped up and did not log it" — the app even said so in its own
 * warning — and treating the shortfall as un-logged spending threw away the
 * exchange rate the trip's settlement figures depend on.
 *
 * The diff is recomputed here from the stored records; the client's own
 * arithmetic is only ever used to decide which fields to show.
 */
export async function saveWalletAdjustment(
  _prev: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  const [t, tWallet] = await Promise.all([
    getTranslations('groups.errors'),
    getTranslations('wallet'),
  ])

  const parsed = adjustSchema.safeParse({
    walletId: formData.get('walletId')?.toString(),
    counted: formData.get('counted')?.toString(),
    paid: formData.get('paid')?.toString(),
  })
  if (!parsed.success) {
    return { error: t('invalidInput') }
  }
  const wallet = await prisma.wallet.findFirst({
    where: { id: parsed.data.walletId, memberId: member.id },
  })
  if (!wallet) {
    return { error: t('invalidInput') }
  }
  const counted = parseAmountToMinor(parsed.data.counted, wallet.currency)
  if (counted === null || counted < 0n) {
    return { error: t('invalidInput') }
  }

  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } })
  const [records, walletExpenses] = await Promise.all([
    prisma.exchangeRecord.findMany({ where: { walletId: wallet.id } }),
    prisma.expenseFunding.findMany({
      where: { walletId: wallet.id, expense: { cancelledAt: null } },
      select: WALLET_SPEND_SELECT,
    }),
  ])
  const recordInputs: ExchangeRecordInput[] = records.map((record) => ({
    walletId: record.walletId,
    amountPaid: record.amountPaid,
    amountReceived: record.amountReceived,
    currency: record.currency,
  }))
  const summary = walletSummaries(
    [
      {
        id: wallet.id,
        memberId: wallet.memberId,
        type: wallet.type,
        label: wallet.label,
        currency: wallet.currency,
      },
    ],
    recordInputs,
    toWalletExpenseRows(walletExpenses),
  )[0]
  const diff = walletAdjustmentAmount(summary.remaining, counted)
  if (diff === 0n) {
    return { saved: true, wallets: await loadWalletViews(groupId, member.id) }
  }

  // More money than the records explain: a top-up nobody logged. What it
  // cost is not optional — it IS this wallet's average cost from here on.
  if (diff < 0n) {
    const paid = parseAmountToMinor(
      parsed.data.paid ?? '',
      group.settlementCurrency,
    )
    if (paid === null || paid <= 0n) {
      return { error: tWallet('topUpCostRequired') }
    }
    await prisma.exchangeRecord.create({
      data: {
        memberId: member.id,
        walletId: wallet.id,
        amountPaid: paid,
        amountReceived: -diff,
        currency: wallet.currency,
        timestamp: new Date(),
      },
    })
    revalidatePath(`/groups/${groupId}`, 'layout')
    return { saved: true, wallets: await loadWalletViews(groupId, member.id) }
  }

  let marketRateSnapshot = '1'
  if (wallet.currency !== group.settlementCurrency) {
    const fetched = await getSnapshotRate(
      new Date(),
      wallet.currency,
      group.settlementCurrency,
    )
    if (fetched !== null) {
      marketRateSnapshot = fetched.rate
    } else {
      // Provider unreachable: fall back to this wallet's own average cost.
      const { rate, usedFallback } = computeAvgRate(recordInputs, {
        numerator: 1n,
        denominator: 1n,
      })
      marketRateSnapshot = usedFallback
        ? '1'
        : rateToDecimalString(
            rate,
            group.settlementCurrency,
            wallet.currency,
            10,
          )
    }
  }

  await prisma.expense.create({
    data: {
      groupId,
      title: tWallet('adjustmentTitle'),
      payerId: member.id,
      amount: diff,
      currency: wallet.currency,
      timestamp: new Date(),
      marketRateSnapshot,
      isPersonal: true,
      isWalletAdjustment: true,
      enteredById: member.id,
      participants: { create: [{ memberId: member.id }] },
      funding: { create: [{ position: 0, amount: diff, walletId: wallet.id }] },
    },
  })
  revalidatePath(`/groups/${groupId}`, 'layout')
  return { saved: true, wallets: await loadWalletViews(groupId, member.id) }
}

/**
 * Take back a "count this wallet" correction.
 *
 * A HARD delete, unlike every other expense in this app. A correction is not
 * something the group bought — it is a note the app wrote about one member's
 * own wallet — so leaving a cancelled one behind would put a purchase nobody
 * made in the ledger forever, which is the confusion this whole change is
 * removing. The guard is narrow on purpose: the row must be flagged
 * `isWalletAdjustment`, in this group, and paid by the acting member, so no
 * ordinary expense can ever reach this path.
 */
export async function deleteWalletAdjustment(
  _prev: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('groups.errors')

  const expenseId = formData.get('expenseId')?.toString() ?? ''
  const existing = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      groupId,
      payerId: member.id,
      isWalletAdjustment: true,
    },
  })
  if (!existing) {
    return { error: t('invalidInput') }
  }
  await prisma.expense.delete({ where: { id: existing.id } })
  revalidatePath(`/groups/${groupId}`, 'layout')
  return { saved: true, wallets: await loadWalletViews(groupId, member.id) }
}

/**
 * Onboarding "log your exchanges" prompt skipped — never auto-ask again.
 * Redirects rather than relying on revalidation alone: a void form action
 * has no client hook to refresh the route it just changed, and dropping
 * `?created=1` is what actually retires the prompt.
 */
export async function dismissExchangePrompt(formData: FormData): Promise<void> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const expenseId = formData.get('expenseId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  await prisma.member.update({
    where: { id: member.id },
    data: { exchangePromptDismissedAt: new Date() },
  })
  revalidatePath(`/groups/${groupId}`, 'layout')
  redirect(`/groups/${groupId}/expenses/${expenseId}`)
}

/** Dismiss the "balances updated" recalc banner for the acting member. */
export async function markRecalcSeen(formData: FormData): Promise<void> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  await prisma.member.update({
    where: { id: member.id },
    data: { lastSeenRecalcAt: new Date() },
  })
  revalidatePath(`/groups/${groupId}`, 'layout')
}
