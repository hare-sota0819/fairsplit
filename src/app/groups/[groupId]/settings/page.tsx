import { getTranslations } from 'next-intl/server'
import { NavLink } from '@/components/NavLoader'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import {
  addMember,
  deleteGroup,
  leaveGroup,
  setWalletHidden,
  updateGroupSettings,
  updateMember,
} from './actions'
import { DangerZone } from './DangerZone'
import {
  AddMemberForm,
  GroupSettingsForm,
  MemberRow,
  WalletPrivacyForm,
} from './SettingsForms'

export default async function GroupSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const [group, members, expenseCount, t, tGroups, tDetail, tLoading, tDanger] =
    await Promise.all([
      prisma.group.findUniqueOrThrow({ where: { id: groupId } }),
      prisma.member.findMany({
        where: { groupId },
        orderBy: { name: 'asc' },
      }),
      prisma.expense.count({ where: { groupId } }),
      getTranslations('settings'),
      getTranslations('groups.new'),
      getTranslations('groups.detail'),
      getTranslations('loading'),
      getTranslations('settings.danger'),
    ])

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <h1 className="text-xl font-bold">{t('title')}</h1>
      <GroupSettingsForm
        action={updateGroupSettings}
        groupId={groupId}
        initial={{
          name: group.name,
          currency: group.settlementCurrency,
          tripCountry: group.tripCountry,
          tripCity: group.tripCity,
          rateMode: group.rateMode,
        }}
        currencyLocked={expenseCount > 0}
        labels={{
          groupName: t('groupName'),
          currency: tGroups('currency'),
          currencyLocked: t('currencyLocked'),
          destination: {
            country: tGroups('tripCountry'),
            countryNone: tGroups('tripCountryNone'),
            city: tGroups('tripCity'),
            cityNone: tGroups('tripCityNone'),
            help: tGroups('tripHelp'),
            currencyNote: tGroups('tripCurrencyNote', {
              currency: '{currency}',
            }),
          },
          rateMode: t('rateMode'),
          rateModeAvg: tGroups('rateModeAvg'),
          rateModeMarket: tGroups('rateModeMarket'),
          save: t('save'),
          saving: t('saving'),
          saved: t('saved'),
        }}
      />
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t('myWallet')}</h2>
        <p className="text-xs text-muted-foreground">
          {t('walletPrivacyDesc')}
        </p>
        <WalletPrivacyForm
          action={setWalletHidden}
          groupId={groupId}
          hidden={me.walletHidden}
          labels={{
            hideWallet: t('hideWallet'),
            showWallet: t('showWallet'),
            saved: t('saved'),
          }}
        />
        <NavLink
          href={`/groups/${groupId}/exchange`}
          caption={tLoading('exchange')}
          className="w-fit text-sm font-medium text-primary underline"
          testId="settings-exchange-link"
        >
          {t('exchangeRecords')}
        </NavLink>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t('members')}</h2>
        <div className="-mx-4 divide-y divide-border">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              action={updateMember}
              groupId={groupId}
              member={{
                id: member.id,
                name: member.name,
                left: member.leftAt !== null,
              }}
              labels={{
                rename: t('rename'),
                leftBadge: t('leftBadge'),
              }}
            />
          ))}
        </div>
        {/* Adding a person is a group-management act, so it lives on the
            group-management screen — the one the account menu's "Manage
            group" opens (owner, 2026-08-22). */}
        <h3 className="mt-2 text-sm font-medium">{t('addMember')}</h3>
        <AddMemberForm
          action={addMember}
          groupId={groupId}
          labels={{
            name: t('addMemberName'),
            submit: t('addMemberSubmit'),
            hint: t('addMemberHint'),
          }}
        />
      </section>
      <DangerZone
        leaveAction={leaveGroup}
        deleteAction={deleteGroup}
        groupId={groupId}
        groupName={group.name}
        isCreator={group.createdById === me.userId}
        isLastMember={
          members.filter((m) => m.leftAt === null && m.userId !== null)
            .length <= 1
        }
        labels={{
          title: tDanger('title'),
          leave: tDanger('leave'),
          leaveConfirm: tDanger('leaveConfirm'),
          leaveLast: tDanger('leaveLast'),
          leaveLastConfirm: tDanger('leaveLastConfirm'),
          confirm: tDanger('confirm'),
          cancel: tDanger('cancel'),
          delete: tDanger('delete'),
          deleteDesc: tDanger('deleteDesc'),
          deletePrompt: tDanger('deletePrompt'),
          deleteConfirm: tDanger('deleteConfirm'),
        }}
      />
      <section className="flex flex-col gap-2">
        {/* The dedicated /invite screen (reached from the sidebar menu) is
            the invite flow's home — it owns the full link+copy block, the
            title and the explanatory body copy. Settings used to render
            that same block a second time; T7 intake dedupes it down to a
            single link out, same pattern as the exchange-records link
            above. */}
        <NavLink
          href={`/groups/${groupId}/invite`}
          caption={tLoading('general')}
          className="w-fit text-sm font-medium text-primary underline"
          testId="settings-invite-link"
        >
          {tDetail('inviteLink')}
        </NavLink>
      </section>
    </main>
  )
}
