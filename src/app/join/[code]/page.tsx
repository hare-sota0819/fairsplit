import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { buttonVariants } from '@/components/ui/button'
import { prisma } from '@/lib/prisma'
import { joinGroup } from './actions'
import { JoinForm } from './JoinForm'

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const t = await getTranslations('join')

  // Session first: a bad code has to offer the right exit, and that depends
  // on whether there is an account to go back to.
  const session = await auth()

  const group = await prisma.group.findUnique({
    where: { inviteCode: code },
    include: {
      members: { where: { userId: null } },
      createdBy: { select: { name: true } },
    },
  })
  if (!group) {
    return (
      <main
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
        data-testid="invite-invalid"
      >
        <h1 className="text-xl font-bold">{t('errors.unknownInvite')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('errors.unknownInviteHelp')}
        </p>
        {session?.user?.id ? (
          <Link href="/groups" className={buttonVariants({ size: 'touch' })}>
            {t('errors.backToGroups')}
          </Link>
        ) : (
          <Link href="/signin" className={buttonVariants({ size: 'touch' })}>
            {t('errors.signIn')}
          </Link>
        )}
      </main>
    )
  }

  if (!session?.user?.id) {
    /* This used to redirect straight to the sign-in form, so an invited
       friend was asked for an email and a password before being told what
       the app was or who had invited them. The account is still required —
       joining writes a member row — but the ask now comes after the reason
       for it. */
    const inviter = group.createdBy?.name?.trim()
    const back = encodeURIComponent(`/join/${code}`)
    return (
      <main
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-5 py-10"
        data-testid="invite-preview"
      >
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">
            {inviter
              ? t('preview.invited', { name: inviter, groupName: group.name })
              : t('preview.invitedNoName', { groupName: group.name })}
          </h1>
          <p className="text-sm text-muted-foreground">{t('preview.what')}</p>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            href={`/signup?callbackUrl=${back}`}
            className={buttonVariants({ size: 'hero' })}
            data-testid="invite-signup"
          >
            {t('preview.signUp')}
          </Link>
          <p className="text-center text-sm text-muted-foreground">
            {t('preview.haveAccount')}{' '}
            <Link className="underline" href={`/signin?callbackUrl=${back}`}>
              {t('preview.signIn')}
            </Link>
          </p>
        </div>
      </main>
    )
  }

  // Someone who left sees the join form again; only a current member is
  // bounced straight through.
  const member = await prisma.member.findFirst({
    where: { groupId: group.id, userId: session.user.id, leftAt: null },
  })
  if (member) {
    redirect(`/groups/${group.id}`)
  }

  const email = session.user.email?.toLowerCase()
  const slot = email
    ? group.members.find(
        (unclaimed) => unclaimed.invitedEmail?.toLowerCase() === email,
      )
    : undefined

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">
        {t('title', { groupName: group.name })}
      </h1>
      <JoinForm
        action={joinGroup}
        code={code}
        defaultName={slot?.name ?? session.user.name ?? ''}
        label={t('displayName')}
        submitLabel={t('submit')}
      />
    </main>
  )
}
