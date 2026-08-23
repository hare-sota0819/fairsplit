import { isSettleable, toEngineExpense } from '@/lib/engine-map'
import { prisma } from '@/lib/prisma'
import type {
  ExchangeRecordInput,
  ExpenseInput,
  SettlementContext,
  WalletInfo,
} from '@/lib/settlement'

export const EXPENSE_INCLUDE = {
  participants: true,
  items: { include: { assignments: true } },
  payer: true,
  enteredBy: true,
  updatedBy: true,
  cancelledBy: true,
  // Ordered so position 0 is first everywhere: the primary source screens
  // name first, and the one a bank-statement correction lands on.
  funding: { include: { wallet: true }, orderBy: { position: 'asc' } },
} as const

/**
 * Everything the group screens compute from: the group, its members, their
 * wallets, expense rows (newest first), and the engine-shaped inputs and
 * context.
 *
 * Since Phase 4A the context is WALLET-keyed, not member-keyed: a member who
 * carries cash bought at one rate and a travel card loaded at another has two
 * different costs, and only the wallet says which one an expense used.
 */
export async function loadGroupData(groupId: string) {
  const [group, members, expenses, exchangeRecords, wallets] =
    await Promise.all([
      prisma.group.findUniqueOrThrow({ where: { id: groupId } }),
      prisma.member.findMany({
        where: { groupId },
        orderBy: { name: 'asc' },
      }),
      prisma.expense.findMany({
        where: { groupId },
        include: EXPENSE_INCLUDE,
        // `timestamp` comes from a datetime-local input and so is only
        // MINUTE-precise: two rows entered in the same minute compare equal
        // and Postgres is then free to return them in any order, which it
        // does — differently on different renders. `id` is a cuid, whose
        // leading component is the creation time, so it breaks the tie in
        // entry order and makes the list stable.
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      }),
      prisma.exchangeRecord.findMany({
        where: { member: { groupId } },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      }),
      prisma.wallet.findMany({
        where: { member: { groupId } },
        orderBy: { createdAt: 'asc' },
      }),
    ])

  const engineExpenses: ExpenseInput[] = expenses
    .filter(isSettleable)
    .map(toEngineExpense)

  const walletsById = new Map<string, WalletInfo>(
    wallets.map((wallet) => [
      wallet.id,
      {
        id: wallet.id,
        memberId: wallet.memberId,
        type: wallet.type,
        label: wallet.label,
        currency: wallet.currency,
      },
    ]),
  )
  const recordsByWallet = new Map<string, ExchangeRecordInput[]>()
  for (const record of exchangeRecords) {
    const list = recordsByWallet.get(record.walletId) ?? []
    list.push({
      walletId: record.walletId,
      amountPaid: record.amountPaid,
      amountReceived: record.amountReceived,
      currency: record.currency,
    })
    recordsByWallet.set(record.walletId, list)
  }
  const context: SettlementContext = {
    settlementCurrency: group.settlementCurrency,
    walletsById,
    recordsByWallet,
  }
  return {
    group,
    members,
    wallets,
    expenses,
    exchangeRecords,
    engineExpenses,
    context,
    mode: group.rateMode,
  }
}

/** Everything `loadGroupData` hands back, for callers that pass it around. */
export type GroupData = Awaited<ReturnType<typeof loadGroupData>>
