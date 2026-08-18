import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { NavLink } from '@/components/NavLoader'
import { buttonVariants } from '@/components/ui/button'
import { prisma } from '@/lib/prisma'

/**
 * THE list of every group you're in, reachable from the sidebar's "All
 * groups" item. `/` used to be this list, but it now redirects straight into
 * whichever group you last entered an expense in (see `src/app/page.tsx`) —
 * nobody has to pick a group just to open the app. This is where a picker
 * still lives: onboarding into a new group, or anyone juggling more than one
 * trip at once.
 *
 * Membership is resolved from the session user id alone
 * (`members.some.userId`), never from the email or anything else the browser
 * carries, so one account sees the same groups on every device.
 */
export default async function GroupsPage() {
  const [session, tList, tLoading] = await Promise.all([
    auth(),
    getTranslations('groups.list'),
    getTranslations('loading'),
  ])

  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/groups')
  }

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: session.user.id, leftAt: null } } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      settlementCurrency: true,
      _count: { select: { members: true } },
    },
  })

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{tList('title')}</h1>
        {groups.length > 0 ? (
          // The empty state below already has its own "Create a group" CTA;
          // a populated list had no way back into `/groups/new` at all
          // (T7 intake) other than the account-menu's "New group" item —
          // easy to miss. Same key, same destination, sized for a header
          // rather than an empty-state centerpiece.
          <NavLink
            href="/groups/new"
            caption={tLoading('general')}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            testId="group-list-create"
          >
            {tList('create')}
          </NavLink>
        ) : null}
      </div>
      {groups.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-5 px-5 py-10 text-center text-sm text-muted-foreground"
          data-testid="group-list-empty"
        >
          <p>{tList('empty')}</p>
          <NavLink
            href="/groups/new"
            caption={tLoading('general')}
            className={buttonVariants({ size: 'touch' })}
          >
            {tList('create')}
          </NavLink>
        </div>
      ) : (
        /* Flat list on the page, one full-bleed hairline between rows: the
           reference has no card layer on a list (docs/DESIGN_SPEC.md §3.11).
           `-mx-4` cancels this screen's `p-4` gutter so the rule reaches
           both edges. */
        <ul className="-mx-4 divide-y divide-border border-y border-border">
          {groups.map((group) => (
            <li key={group.id}>
              <NavLink
                href={`/groups/${group.id}`}
                caption={tLoading('group')}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted"
                testId="group-list-row"
              >
                <span className="min-w-0 truncate font-medium">
                  {group.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {group.settlementCurrency} ·{' '}
                  {tList('memberCount', { count: group._count.members })}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
