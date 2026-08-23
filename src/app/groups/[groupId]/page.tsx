import { getTranslations } from 'next-intl/server'
import { loadPendingRequest } from './changes/actions'
import { markRecalcSeen } from './exchange/actions'
import { RecalcBanner } from './RecalcBanner'
import { saveExpense } from './expenses/actions'
import { ExpenseForm } from './expenses/ExpenseForm'
import { buildFormProps } from './expenses/form-props'
import { BalanceAmount, directionOf } from '@/components/Money'
import { MySpendingCard } from '@/components/MySpendingCard'
import { NavLink } from '@/components/NavLoader'
import { formatMinor } from '@/lib/format'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { mySpending } from '@/lib/my-spending'
import { prisma } from '@/lib/prisma'
import { computeNetBalances } from '@/lib/settlement'

/**
 * Home: add an expense, see what you have spent, see who owes whom — in
 * that order, top to bottom (owner sketch, 2026-08-22).
 *
 * The expense wizard is MOUNTED HERE rather than linked to. Adding an
 * expense is the thing this app is for, and every step of it now happens
 * without leaving this screen; the only navigation is the one at the end,
 * onto the receipt that was just saved.
 *
 * Below it, the two readings: "my spending" folded into one number that
 * opens into the expenses behind it, and the settlement standings under
 * that, reached by scrolling rather than by a menu. Everything else this
 * group can do is either in the text index on the left (three reading
 * screens) or the account menu on the right (everything that CHANGES the
 * group or the account).
 *
 * The pending-change badge stays: it is the one thing that qualifies the
 * numbers below it, and a reader has to see that a proposal exists without
 * going looking for it.
 */
export default async function GroupHomePage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const [data, formData] = await Promise.all([
    loadGroupData(groupId),
    buildFormProps(groupId, me.id),
  ])
  const { group, members, engineExpenses, context, mode } = data
  const [t, tHome, tEmpty, tBalance, tLoading, tExpenses, tChanges, tDetail] =
    await Promise.all([
      getTranslations('status'),
      getTranslations('home'),
      getTranslations('empty'),
      getTranslations('balance'),
      getTranslations('loading'),
      getTranslations('expenses'),
      getTranslations('changes'),
      getTranslations('expenses.detail'),
    ])

  const currency = group.settlementCurrency
  const balances = computeNetBalances(engineExpenses, mode, context)
  const spending = mySpending(data, me.id)

  // A member who left is still listed while their balance is unsettled —
  // hiding it would hide who owes whom — and drops off once it is square.
  // Same rule as the status screen, which shows the pairwise detail behind
  // these same figures.
  const rows = members
    .map((member) => ({ member, net: balances.get(member.id) ?? 0n }))
    .filter(({ member, net }) => member.leftAt === null || net !== 0n)
    .sort((a, b) =>
      a.net === b.net
        ? a.member.name.localeCompare(b.member.name)
        : b.net > a.net
          ? 1
          : -1,
    )

  const pending = await loadPendingRequest(groupId)

  // Recalc notice: someone else's exchange records landed after my cursor
  // (AVG_COST only — records don't move MARKET-mode numbers).
  const recalcRecord =
    mode === 'AVG_COST'
      ? await prisma.exchangeRecord.findFirst({
          where: {
            member: { groupId },
            memberId: { not: me.id },
            ...(me.lastSeenRecalcAt
              ? { createdAt: { gt: me.lastSeenRecalcAt } }
              : {}),
          },
          orderBy: { createdAt: 'desc' },
          include: { member: true },
        })
      : null

  return (
    <main className="flex flex-1 flex-col gap-8 py-6" data-testid="home">
      <header className="flex flex-col gap-4 px-5">
        <h1 className="text-2xl font-bold">{group.name}</h1>

        {recalcRecord ? (
          <RecalcBanner
            groupId={groupId}
            action={markRecalcSeen}
            message={tHome('recalcBanner', { name: recalcRecord.member.name })}
            dismissLabel={tHome('recalcDismiss')}
          />
        ) : null}

        {pending ? (
          <NavLink
            href={`/groups/${groupId}/changes`}
            caption={tLoading('general')}
            testId="pending-change-badge"
            className="inline-flex w-fit items-center border border-border-strong px-3 py-1 text-xs"
          >
            {tChanges('badge', { count: 1 })}
          </NavLink>
        ) : null}
      </header>

      <section className="flex flex-col" data-testid="home-add-expense">
        <h2 className="px-5 text-sm font-semibold">{tExpenses('new.title')}</h2>
        {/* The wizard itself carries the page gutter, so this section adds
            none of its own. `embedded` drops its "Cancel" link: on home
            there is nothing to go back to. */}
        <ExpenseForm
          groupId={groupId}
          action={saveExpense}
          data={formData}
          embedded
        />
      </section>

      <div className="flex flex-col gap-8 px-5">
        <MySpendingCard
          groupId={groupId}
          title={tHome('mySpendingTitle')}
          total={formatMinor(spending.total, currency)}
          rows={spending.rows}
          labels={{
            toggle: tHome('spendingToggle'),
            more: tHome('spendingMore'),
            personal: tDetail('personalBadge'),
            empty: tEmpty('noSpending'),
          }}
        />

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">{t('title')}</h2>
            <NavLink
              href={`/groups/${groupId}/status`}
              caption={tLoading('status')}
              testId="home-status-detail"
              className="text-xs font-medium text-primary transition-colors duration-fast hover:underline"
            >
              {tHome('statusDetail')}
            </NavLink>
          </div>
          {rows.length <= 1 ? (
            <p
              className="px-5 py-12 text-center text-sm text-muted-foreground"
              data-testid="home-empty"
            >
              {tEmpty('statusAlone')}
            </p>
          ) : (
            <ul
              className="-mx-5 divide-y divide-border"
              data-testid="home-balances"
            >
              {rows.map(({ member, net }) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <span className="text-sm">{member.name}</span>
                  <BalanceAmount
                    direction={directionOf(net)}
                    amount={
                      net === 0n
                        ? ''
                        : formatMinor(net > 0n ? net : -net, currency)
                    }
                    label={
                      net > 0n
                        ? tBalance('receivable')
                        : net < 0n
                          ? tBalance('payable')
                          : tBalance('even')
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{tHome('estimates')}</p>
        </section>
      </div>
    </main>
  )
}
