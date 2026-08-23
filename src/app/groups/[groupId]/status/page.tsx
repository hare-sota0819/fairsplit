import { getTranslations } from 'next-intl/server'
import { FreshnessLabel } from '@/components/FreshnessLabel'
import { NavLink } from '@/components/NavLoader'
import { directionOf } from '@/components/Money'
import { TotalsGrid } from '@/components/TotalsGrid'
import { formatMinor } from '@/lib/format'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { computeNetBalances, pairwiseNetFor } from '@/lib/settlement'
import { buildTotalCards } from '@/lib/total-cards'
import { fundingRowsOf, walletSummaries } from '@/lib/wallet-view'
import { StatusRow, type PairwiseLine } from './StatusRow'

export default async function GroupStatusPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const data = await loadGroupData(groupId)
  const { group, members, expenses, engineExpenses, context, mode } = data
  const [t, tHome, tEmpty, tBalance, tWallet, tNav, tLoading] =
    await Promise.all([
      getTranslations('status'),
      getTranslations('home'),
      getTranslations('empty'),
      getTranslations('balance'),
      getTranslations('wallet'),
      getTranslations('nav'),
      getTranslations('loading'),
    ])
  const balanceLabels = {
    owed: tBalance('receivable'),
    owing: tBalance('payable'),
    even: tBalance('even'),
  }

  const balances = computeNetBalances(engineExpenses, mode, context)
  const currency = group.settlementCurrency
  const allWallets = [...context.walletsById.values()]
  const allRecords = [...context.recordsByWallet.values()].flat()
  // A wallet is drawn down by the PORTIONS funded from it, not by the totals
  // of the expenses it part-paid.
  const walletRows = fundingRowsOf(expenses)

  // A member who left is still listed while their balance is unsettled —
  // hiding it would hide who owes whom — and drops off once it is square.
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
  const alone = rows.length <= 1

  const hasExpenses = expenses.some((expense) => expense.cancelledAt === null)
  // The two headline totals ("you fronted" / "your share") — built with the
  // same `buildTotalCards` home used before it went chat-only (Task 5,
  // app-shell restructure), so the copy never had to be reworded here.
  const totals = buildTotalCards(data, me.id, members, tHome)
  // The note below claims the two totals "roughly match the sum of the
  // amounts above" — true only when a row actually shows a number (home's
  // `hasPairwiseAmounts`, moved here since the totals did — Task 5,
  // app-shell restructure).
  const hasPairwiseAmounts = rows.some(({ net }) => net !== 0n)

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <FreshnessLabel
          renderedAt={new Date().toISOString()}
          updatedTemplate={t('updated', { ago: '{ago}' })}
          refreshLabel={t('refresh')}
        />
        {/* Checkpoints left the navigation index when it was cut to four
            reading destinations (owner, 2026-08-22). They belong to these
            numbers — freezing them is what a checkpoint IS — so this is the
            screen that carries the way in. */}
        <NavLink
          href={`/groups/${groupId}/checkpoints`}
          caption={tLoading('general')}
          testId="status-checkpoints-link"
          className="w-fit text-sm font-medium text-primary underline"
        >
          {tNav('sidebar.checkpoints')}
        </NavLink>
      </header>

      {hasExpenses ? (
        <section className="flex flex-col gap-2">
          <TotalsGrid fronted={totals.fronted} consumed={totals.consumed} />
          {hasPairwiseAmounts ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="summary-note"
            >
              {tHome('summaryNote')}
            </p>
          ) : null}
          {/* User-facing honesty about the two figures above: nothing here
              is final until checkpoint settlement. Home carried this note
              until Task 5 made it chat-only; the totals moved here, so the
              qualifier that belongs to them does too (review fix,
              2026-08-10) — `home.estimates` is reused rather than
              duplicated, same as `summaryNote` just above it. */}
          <p className="text-xs text-muted-foreground">{tHome('estimates')}</p>
        </section>
      ) : null}

      {/* One member means one row saying "settled" with nobody — the notice
          replaces the list rather than sitting above it. */}
      {alone ? (
        <p
          className="px-5 py-12 text-center text-sm text-muted-foreground"
          data-testid="status-alone"
        >
          {tEmpty('statusAlone')}
        </p>
      ) : (
        <ul className="-mx-5 divide-y divide-border">
          {rows.map(({ member, net }) => {
            const hidden = member.walletHidden && member.id !== me.id
            const wallets = hidden
              ? []
              : walletSummaries(
                  allWallets.filter((wallet) => wallet.memberId === member.id),
                  allRecords,
                  walletRows,
                )
            // Positive = this member owes that other member. EVERY other
            // current member gets a line here, settled ones included — not
            // just the ones with a nonzero balance. This breakdown is the
            // ONLY entry point into /with/[memberId] anywhere in the app
            // (on the viewer's own row, via `href` below); filtering out
            // settled pairs made that screen unreachable for anyone whose
            // balance nets to zero (review fix, 2026-08-10). A member who
            // left still gets a line only while a balance with them is
            // still open, mirroring the top-level `rows` filter above.
            const netByOther = pairwiseNetFor(
              member.id,
              engineExpenses,
              mode,
              context,
            )
            const lines: PairwiseLine[] = members
              .filter((other) => other.id !== member.id)
              .map((other) => ({
                other,
                value: netByOther.get(other.id) ?? 0n,
              }))
              .filter(
                ({ other, value }) => other.leftAt === null || value !== 0n,
              )
              .sort((a, b) =>
                b.value > a.value ? 1 : b.value < a.value ? -1 : 0,
              )
              .map(({ other, value }) => {
                const direction =
                  value > 0n
                    ? ('owing' as const)
                    : value < 0n
                      ? ('owed' as const)
                      : ('even' as const)
                return {
                  id: other.id,
                  direction,
                  // The row's own name is not repeated here, so the verb is
                  // load-bearing: without it this line would read as if the
                  // COUNTERPARTY named here were the one owing — see F1.
                  text:
                    direction === 'owing'
                      ? t('pairOwes', { other: other.name })
                      : direction === 'owed'
                        ? t('pairOwed', { other: other.name })
                        : t('pairSettled', { other: other.name }),
                  amount:
                    direction === 'even'
                      ? ''
                      : formatMinor(value > 0n ? value : -value, currency),
                  // Only the viewer's own row can open a two-person shared
                  // history — see the `href` doc comment on `PairwiseLine`.
                  href:
                    member.id === me.id
                      ? `/groups/${groupId}/with/${other.id}`
                      : undefined,
                }
              })

            // T7 intake: a row settled with everyone used to render N
            // identical "Settled with X" lines back to back — glanceable for
            // one or two people, noise for a bigger group. Only the
            // VIEWER'S OWN row needs those lines kept individually (each
            // one is the only entry point into /with/[memberId], see the
            // `href` doc comment above); another member's row has no hrefs
            // on any of its lines, so collapsing an all-settled breakdown
            // down to the single `pairNone` note loses no navigation and
            // reads as one clean state instead of a repeated list.
            const allSettled =
              member.id !== me.id &&
              lines.length > 0 &&
              lines.every((line) => line.direction === 'even')

            return (
              <StatusRow
                key={member.id}
                name={member.name}
                leftLabel={member.leftAt === null ? null : t('left')}
                netDirection={directionOf(net)}
                netAmount={
                  net === 0n
                    ? t('even')
                    : formatMinor(net > 0n ? net : -net, currency)
                }
                settledLabel={t('pairNone')}
                expandLabel={t('expand', { name: member.name })}
                lines={allSettled ? [] : lines}
                balanceLabels={balanceLabels}
                cashCell={
                  <span
                    data-testid="cash-cell"
                    className="flex min-w-10 flex-col text-right text-xs tabular-nums text-muted-foreground"
                    title={t('cashColumn')}
                  >
                    {hidden
                      ? t('cashHidden')
                      : wallets.length === 0
                        ? t('cashNone')
                        : wallets.map((wallet) => (
                            /*
                             * Say "left". The column header only ever
                             * existed as a `title` attribute, which a phone
                             * never shows, so this cell read as an
                             * unexplained number next to a balance — "what
                             * is Travel card ¥38,000 doing here?".
                             */
                            <span key={wallet.walletId}>
                              {wallet.label}{' '}
                              {tWallet('remaining', {
                                amount: formatMinor(
                                  wallet.remaining,
                                  wallet.currency,
                                ),
                              })}
                            </span>
                          ))}
                  </span>
                }
              />
            )
          })}
        </ul>
      )}
    </main>
  )
}
