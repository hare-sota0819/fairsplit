import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/BackLink'
import { BalanceAmount, directionOf } from '@/components/Money'
import { LocalTime } from '@/components/LocalTime'
import { NavLink } from '@/components/NavLoader'
import { formatMinor } from '@/lib/format'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { toEngineExpense } from '@/lib/engine-map'
import { pairwiseContribution } from '@/lib/settlement'

/**
 * Every expense that moves money between two members, newest first.
 *
 * Each row's amount comes from the same function the header total is folded
 * from (`pairwiseContribution`), so the rows cannot add up to something other
 * than the figure above them.
 */
export default async function WithMemberPage({
  params,
}: {
  params: Promise<{ groupId: string; memberId: string }>
}) {
  const { groupId, memberId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const { group, members, expenses, mode, context } =
    await loadGroupData(groupId)

  const them = members.find((m) => m.id === memberId)
  if (!them || them.id === me.id) notFound()

  const [t, tBalance, tLoading, tCommon, format] = await Promise.all([
    getTranslations('withMember'),
    getTranslations('balance'),
    getTranslations('loading'),
    getTranslations('common'),
    getFormatter(),
  ])
  const balanceLabels = {
    owed: tBalance('receivable'),
    owing: tBalance('payable'),
    even: tBalance('even'),
  }
  const currency = group.settlementCurrency

  // This filter is load-bearing, not a defensive extra: `toEngineExpense`
  // never carries `cancelledAt` into `ExpenseInput`, and neither
  // `consumerDebits` nor `pairwiseContribution` looks at cancellation — a
  // cancelled expense produces the exact same non-zero contribution as a
  // live one. Dropping this filter would put cancelled money back on screen.
  const rows = expenses
    .filter((expense) => expense.cancelledAt === null)
    .map((expense) => ({
      expense,
      between: pairwiseContribution(
        me.id,
        them.id,
        toEngineExpense(expense),
        mode,
        context,
      ),
    }))
    .filter((row) => row.between !== 0n)

  const net = rows.reduce((sum, row) => sum + row.between, 0n)
  // pairwiseContribution's sign convention is "positive = I owe them" — flip
  // it for display, the same way home's per-person rows do (home's own
  // header is different: it shows computeNetBalances's payer-positive value
  // unflipped).
  const netDirection = directionOf(-net)

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-6">
      <BackLink
        href={`/groups/${groupId}`}
        caption={tLoading('group')}
        label={tCommon('back')}
        testId="back-link"
      />
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">{t('title', { name: them.name })}</h1>
        {netDirection === 'even' ? (
          <p className="text-sm text-muted-foreground">
            {t('settled', { name: them.name })}
          </p>
        ) : (
          <BalanceAmount
            direction={netDirection}
            label={balanceLabels[netDirection]}
            amount={formatMinor(net > 0n ? net : -net, currency)}
            size="hero"
          />
        )}
      </header>

      {rows.length === 0 ? (
        <p
          className="px-5 py-10 text-center text-sm text-muted-foreground"
          data-testid="with-empty"
        >
          {t('empty', { name: them.name })}
        </p>
      ) : (
        <ul className="-mx-5 divide-y divide-border">
          {rows.map(({ expense, between }) => {
            const direction = directionOf(-between)
            return (
              <li key={expense.id}>
                <NavLink
                  href={`/groups/${groupId}/expenses/${expense.id}`}
                  caption={tLoading('expense')}
                  className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:translate-y-px active:bg-muted"
                  testId="with-row"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">
                      {expense.title || expense.payer.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {
                        // format.list() (Intl.ListFormat) supplies the
                        // locale's own separator — never hard-code list
                        // punctuation, it is not always " · ".
                        format.list(
                          [
                            <LocalTime
                              key="time"
                              iso={expense.timestamp.toISOString()}
                            />,
                            <span key="amount">
                              {t('expenseTotal', {
                                amount: formatMinor(
                                  expense.amount,
                                  expense.currency,
                                ),
                              })}
                            </span>,
                          ],
                          { type: 'unit', style: 'short' },
                        )
                      }
                    </span>
                  </span>
                  <BalanceAmount
                    direction={direction}
                    label={balanceLabels[direction]}
                    amount={formatMinor(
                      between > 0n ? between : -between,
                      currency,
                    )}
                  />
                </NavLink>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
