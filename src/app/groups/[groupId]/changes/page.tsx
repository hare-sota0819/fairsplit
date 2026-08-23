import { getTranslations } from 'next-intl/server'
import { LocalTime } from '@/components/LocalTime'
import { formatMinor } from '@/lib/format'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import type { RetroAuditEntry } from '@/lib/retro-apply'
import {
  loadChangeHistory,
  loadPendingRequest,
  respondToChange,
} from './actions'
import { RespondForm } from './RespondForm'

/**
 * Retroactive changes: the one that is open, and everything that has been
 * decided.
 *
 * The diff shown here is the diff STORED with the request, not one computed
 * now — it is what the approvers were shown when they were asked, and what
 * gets applied if they say yes. Recomputing it on every render would let a
 * top-up logged in the meantime move the question out from under them.
 *
 * Visible to every member, whether or not they were asked. Being told what the
 * group decided about the numbers is not the same as having a say in it, and
 * the spec asks for the first for everyone.
 */
export default async function ChangesPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const [group, members, pending, history, t] = await Promise.all([
    prisma.group.findUniqueOrThrow({ where: { id: groupId } }),
    prisma.member.findMany({ where: { groupId } }),
    loadPendingRequest(groupId),
    loadChangeHistory(groupId),
    getTranslations('changes'),
  ])

  const currency = group.settlementCurrency
  const nameOf = (id: string): string =>
    members.find((member) => member.id === id)?.name ?? '?'
  const iAmStakeholder =
    pending?.responses.some((row) => row.memberId === me.id) ?? false
  const myAnswer = pending?.responses.find((row) => row.memberId === me.id)

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('pendingHeading')}</h2>
        {pending === null ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="changes-none-pending"
          >
            {t('nonePending')}
          </p>
        ) : (
          <div
            className="flex flex-col gap-3 rounded-xl border border-border p-4"
            data-testid="pending-request"
          >
            <p className="text-sm font-medium">
              {t(`kind.${pending.kind}`, {
                name: pending.requestedBy.name,
                expense: pending.expense.title,
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              <LocalTime iso={pending.createdAt.toISOString()} />
              {pending.reminderSentAt ? ` · ${t('reminded')}` : ''}
            </p>

            {/* The whole point of the screen: what this would do to whom. */}
            <ul className="flex flex-col gap-1" data-testid="pending-diff">
              {[...pending.diff.entries()]
                .filter(([, delta]) => delta !== 0n)
                .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
                .map(([memberId, delta]) => (
                  <li key={memberId} className="flex justify-between text-sm">
                    <span>{nameOf(memberId)}</span>
                    <span className="tabular-nums">
                      {t(delta < 0n ? 'worseBy' : 'betterBy', {
                        amount: formatMinor(
                          delta < 0n ? -delta : delta,
                          currency,
                        ),
                      })}
                    </span>
                  </li>
                ))}
            </ul>

            <ul
              className="flex flex-col gap-1 text-xs text-muted-foreground"
              data-testid="pending-stakeholders"
            >
              {pending.responses.map((row) => (
                <li key={row.memberId}>
                  {t(
                    row.response === 'APPROVED'
                      ? 'answerApproved'
                      : row.response === 'REJECTED'
                        ? 'answerRejected'
                        : 'answerWaiting',
                    { name: row.member.name },
                  )}
                </li>
              ))}
            </ul>

            {iAmStakeholder && myAnswer?.response == null ? (
              <RespondForm
                action={respondToChange}
                groupId={groupId}
                requestId={pending.id}
              />
            ) : (
              <p
                className="text-xs text-muted-foreground"
                data-testid="pending-readonly"
              >
                {iAmStakeholder ? t('youAnswered') : t('notAsked')}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('historyHeading')}</h2>
        {history.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="changes-history-empty"
          >
            {t('historyEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="changes-history">
            {history.map((event) => {
              const entry = event.payload as unknown as RetroAuditEntry
              return (
                <li
                  key={event.id}
                  className="flex flex-col gap-1 border-b border-border pb-3 text-sm"
                >
                  <span data-testid={`audit-${entry.kind}`}>
                    {t(`outcome.${entry.kind}`, {
                      name: nameOf(entry.requestedById),
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <LocalTime iso={event.at.toISOString()} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('auditCheckpoints', {
                      count: entry.checkpointIds.length,
                    })}
                    {entry.stakeholders.length === 0
                      ? ` · ${t('auditNoStakeholders')}`
                      : ` · ${entry.stakeholders
                          .map((row) =>
                            t(
                              row.response === 'APPROVED'
                                ? 'answerApproved'
                                : row.response === 'REJECTED'
                                  ? 'answerRejected'
                                  : 'answerNoResponse',
                              { name: nameOf(row.memberId) },
                            ),
                          )
                          .join(', ')}`}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
