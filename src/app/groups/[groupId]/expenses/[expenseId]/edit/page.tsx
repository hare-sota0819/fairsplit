import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/BackLink'
import { storageRateToDisplay } from '@/lib/rate-units'
import { minorToDecimalInput } from '@/lib/format'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { EXPENSE_INCLUDE } from '@/lib/group-data'
import { saveExpense } from '../../actions'
import { ExpenseForm, type ExpenseInitial } from '../../ExpenseForm'
import { buildFormProps } from '../../form-props'

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ groupId: string; expenseId: string }>
}) {
  const { groupId, expenseId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId },
    include: EXPENSE_INCLUDE,
  })
  if (!expense) {
    notFound()
  }
  const [data, t, tLoading, tCommon] = await Promise.all([
    buildFormProps(groupId, me.id, expenseId),
    getTranslations('expenses.new'),
    getTranslations('loading'),
    getTranslations('common'),
  ])

  // The primary source (position 0) answers the wizard's two questions; the
  // rest come back as the extra rows they were entered as, with their own
  // amounts, so re-opening a split expense does not quietly collapse it.
  const [primary, ...extras] = expense.funding

  const initial: ExpenseInitial = {
    amount: minorToDecimalInput(expense.amount, expense.currency),
    currency: expense.currency,
    payerId: expense.payerId,
    // No wallet AND an own rate on file means prepaid money this member
    // keeps no pot for — not a pay-as-you-go card.
    funding: primary?.walletId
      ? { kind: 'WALLET', walletId: primary.walletId }
      : primary?.ownRateSnapshot != null
        ? { kind: 'PREPAID_NO_WALLET' }
        : { kind: 'PAY_AS_YOU_GO' },
    extraFunding: extras.map((portion, index) => ({
      key: index,
      amount: minorToDecimalInput(portion.amount, expense.currency),
      source: portion.walletId
        ? ({ kind: 'WALLET', walletId: portion.walletId } as const)
        : portion.ownRateSnapshot != null
          ? ({ kind: 'PREPAID_NO_WALLET' } as const)
          : ({ kind: 'PAY_AS_YOU_GO' } as const),
      ownRate:
        portion.ownRateSnapshot == null
          ? ''
          : (storageRateToDisplay(
              portion.ownRateSnapshot.toString(),
              expense.currency,
            ) ?? ''),
      memberId: portion.funderId ?? '',
    })),
    timestampIso: expense.timestamp.toISOString(),
    note: expense.note ?? '',
    isPersonal: expense.isPersonal,
    ownRate:
      primary?.ownRateSnapshot == null
        ? ''
        : (storageRateToDisplay(
            primary.ownRateSnapshot.toString(),
            expense.currency,
          ) ?? ''),
    participantIds: expense.participants.map((p) => p.memberId),
    items: expense.items.map((item) => ({
      name: item.name,
      unitAmount: minorToDecimalInput(item.unitAmount, expense.currency),
      quantity: item.quantity,
      splitMode: item.splitMode,
      assignees: item.assignments.map((a) => ({
        memberId: a.memberId,
        // Meaningless under BY_AMOUNT — the shares are re-derived from the
        // member set on save — but it keeps one shape for both modes.
        quantity: a.quantity,
      })),
    })),
  }

  return (
    <main className="flex flex-1 flex-col">
      <div className="px-5 pt-5">
        <BackLink
          href={`/groups/${groupId}/expenses/${expenseId}`}
          caption={tLoading('expense')}
          label={tCommon('back')}
          testId="back-link"
        />
      </div>
      <h1 className="px-5 pt-5 text-xl font-bold">{t('edit')}</h1>
      <ExpenseForm
        groupId={groupId}
        expenseId={expenseId}
        action={saveExpense}
        data={data}
        initial={initial}
      />
    </main>
  )
}
