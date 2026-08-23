import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/BackLink'
import { NavLink } from '@/components/NavLoader'
import { isFrozenExpense } from '@/lib/checkpoint-freeze'
import { storageRateToDisplay } from '@/lib/rate-units'
import { minorToDecimalInput } from '@/lib/format'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { EXPENSE_INCLUDE } from '@/lib/group-data'
import { proposeExpenseEditFromWizard } from '../../../changes/actions'
import { saveExpense } from '../../actions'
import { ExpenseForm, type ExpenseInitial } from '../../ExpenseForm'
import { buildFormProps } from '../../form-props'

export default async function EditExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; expenseId: string }>
  searchParams: Promise<{ propose?: string }>
}) {
  const { groupId, expenseId } = await params
  const { propose } = await searchParams
  const { member: me } = await requireGroupMember(groupId)
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId },
    include: EXPENSE_INCLUDE,
  })
  if (!expense) {
    notFound()
  }
  const [data, t, tLoading, tCommon, tExpenses] = await Promise.all([
    buildFormProps(groupId, me.id, expenseId),
    getTranslations('expenses.new'),
    getTranslations('loading'),
    getTranslations('common'),
    getTranslations('expenses'),
  ])

  const frozen = isFrozenExpense(expense)
  // A settled expense is edited through the request flow, on the SAME form:
  // `?propose=1` swaps the action underneath and nothing else. The dead end
  // below is only for arriving without that — a link from before the change,
  // or a bookmark — and it offers the way through rather than just refusing.
  if (frozen && propose !== '1') {
    return (
      <main className="flex flex-1 flex-col gap-4 px-5 py-6">
        <BackLink
          href={`/groups/${groupId}/expenses/${expenseId}`}
          caption={tLoading('expense')}
          label={tCommon('back')}
          testId="back-link"
        />
        <h1 className="text-xl font-bold">{t('edit')}</h1>
        <p
          className="text-sm text-muted-foreground"
          data-testid="edit-frozen-notice"
        >
          {tExpenses('frozenNotice')}
        </p>
        <NavLink
          href={`/groups/${groupId}/expenses/${expenseId}/edit?propose=1`}
          caption={tLoading('expense')}
          testId="edit-start-request"
          className="inline-flex h-13 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground"
        >
          {tExpenses('requestChange')}
        </NavLink>
      </main>
    )
  }

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
      <h1 className="px-5 pt-5 text-xl font-bold">
        {frozen ? tExpenses('requestChange') : t('edit')}
      </h1>
      {frozen ? (
        <p
          className="px-5 pt-2 text-sm text-muted-foreground"
          data-testid="propose-notice"
        >
          {tExpenses('proposeNotice')}
        </p>
      ) : null}
      <ExpenseForm
        groupId={groupId}
        expenseId={expenseId}
        action={frozen ? proposeExpenseEditFromWizard : saveExpense}
        data={data}
        initial={initial}
      />
    </main>
  )
}
