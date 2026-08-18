import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Camera, TrendingUp, UsersRound } from 'lucide-react'
import { auth } from '@/auth'
import { buttonVariants } from '@/components/ui/button'
import { prisma } from '@/lib/prisma'

/**
 * Landing page when signed out. Signed in, this is never a picker — it opens
 * straight into whichever group you most recently entered an expense in
 * (owner's directive: "몸이 2개가 아닌데 여행 그룹을 고를 이유가 없잖아" —
 * you only have one body, there's no reason to make you choose a trip). The
 * full list, for onboarding into a new group or juggling more than one trip,
 * moved to `/groups`.
 */
export default async function Home() {
  const [session, tLanding] = await Promise.all([
    auth(),
    getTranslations('landing'),
  ])

  if (!session?.user?.id) {
    /*
     * Signed out, this is the only page a stranger can reach on their own,
     * so it has to answer "what is this" and "how do I start" without a
     * session. It used to be just the app name and the tagline; then the
     * feature points were added; this round rebuilds it on the new visual
     * language — PITCH_TEARDOWN.md's phone-column layout (oversized
     * headline -> supporting line -> feature points -> hero CTA +
     * secondary), the ## Choreography entrance (staggered rise+fade,
     * `.landing-enter`/`.landing-step-*` in globals.css), and
     * <Backdrop /> at full `--art-strength` behind it (this route is in
     * Backdrop.tsx's ART_ROUTES).
     *
     * Copy is fresh, not the app.name/app.tagline pair used for metadata
     * elsewhere — the pitch here is specifically the chat-first entry
     * (owner's product framing), not the generic tagline.
     */
    const points = [
      { key: 'rate', Icon: TrendingUp },
      { key: 'receipt', Icon: Camera },
      { key: 'items', Icon: UsersRound },
    ] as const
    return (
      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-10 px-6 py-12 md:max-w-3xl md:gap-14">
        <div className="flex flex-col gap-4">
          {/* `display-lg` (## Type scale): 40px mobile / 64px desktop,
              line-height ratio 0.90, tracking -0.04em (>=32px rule). */}
          <h1 className="landing-enter text-[40px] leading-[0.9] font-bold tracking-[-0.04em] md:text-[64px]">
            {tLanding('headline')}
          </h1>
          {/* `lead` role: 20px/400, tracking -0.02em, 1.6 line-height. */}
          <p className="landing-enter landing-step-1 text-lg leading-[1.6] tracking-[-0.02em] text-muted-foreground md:text-xl">
            {tLanding('subhead')}
          </p>
        </div>

        <ul className="flex flex-col gap-4">
          {points.map(({ key, Icon }, index) => (
            <li
              key={key}
              className={`landing-enter landing-step-${index + 2} flex items-start gap-3`}
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
              >
                <Icon className="size-4" />
              </span>
              <p className="text-sm">{tLanding(`points.${key}`)}</p>
            </li>
          ))}
        </ul>

        <div className="landing-enter landing-step-5 flex flex-col items-stretch gap-3 md:items-start">
          {/* Row 9 (teardown "what we do differently"): pill is the primary
              app-action shape. `hero` size is `rounded-xl` + `w-full` for
              every other call site (a phone-width control); the landing
              hero CTA is the one place the pill itself is the point AND
              the one screen wide enough to show it as an intrinsically
              sized control rather than a stretched bar, so both are
              overridden here — full-width phone button below `md`,
              self-sized pill from `md` up — rather than in the shared
              component. */}
          <Link
            href="/signup"
            className={buttonVariants({
              size: 'hero',
              className: 'rounded-full md:w-auto md:px-10',
            })}
            data-testid="landing-signup"
          >
            {tLanding('cta')}
          </Link>
          <Link
            href="/guide"
            className={buttonVariants({
              variant: 'outline',
              size: 'hero',
              className: 'md:w-auto md:px-10',
            })}
            data-testid="landing-guide"
          >
            {tLanding('guideLink')}
          </Link>
          <p className="text-center text-sm text-muted-foreground md:text-left">
            {tLanding('haveAccount')}{' '}
            <Link className="underline" href="/signin">
              {tLanding('signIn')}
            </Link>
          </p>
        </div>
      </main>
    )
  }

  const userId = session.user.id

  // The redirect rule (owner's #8): the group whose expenses I most recently
  // ENTERED. `createdAt` is entry time, not the expense's own `timestamp` —
  // a backdated expense must not steer this away from where I'm actually
  // working right now. Scoped to groups I'm still a member of.
  const lastEntered = await prisma.expense.findFirst({
    where: {
      enteredBy: { userId },
      group: { members: { some: { userId, leftAt: null } } },
    },
    orderBy: { createdAt: 'desc' },
    select: { groupId: true },
  })

  if (lastEntered) {
    redirect(`/groups/${lastEntered.groupId}`)
  }

  // No expense entered yet. Exactly one group: skip the picker anyway — a
  // list of one is not a choice. Otherwise (zero, or more than one) the list
  // at /groups decides, offering create in the zero case.
  const groups = await prisma.group.findMany({
    where: { members: { some: { userId, leftAt: null } } },
    select: { id: true },
    take: 2,
  })

  if (groups.length === 1) {
    redirect(`/groups/${groups[0].id}`)
  }

  redirect('/groups')
}
