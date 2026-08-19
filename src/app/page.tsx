import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { LocaleToggle } from '@/components/LocaleToggle'
import type { Locale } from '@/i18n/locale'
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
  const [session, t, tAccount, locale] = await Promise.all([
    auth(),
    getTranslations('landing'),
    getTranslations('account'),
    getLocale(),
  ])

  if (!session?.user?.id) {
    /*
     * The signed-out landing, in the Departure Mono grammar (docs/BRAND.md
     * v2 §2d, departuremono.com): a pixel wordmark in a gray block, a short
     * index of glyph-prefixed links, an olive caption, and then the product
     * shown as the artefacts it produces — a letter from Sem (its voice),
     * a receipt, a table. English first; the language line on this screen
     * is the app's language selector for a stranger (owner, 2026-08-18).
     */
    const rows = ['rate', 'receipt', 'items', 'settle'] as const
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-14 px-5 pt-10 pb-16 md:max-w-5xl md:gap-20 md:px-10 md:pt-16">
        {/* ---- Masthead ---------------------------------------------- */}
        <section className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-6">
            <h1 className="flex flex-wrap items-start gap-x-2">
              <span className="bg-primary-soft px-2 text-[44px] leading-[1.05] tracking-[0.02em] text-primary uppercase md:text-[66px]">
                FairSplit
              </span>
              <span className="pt-1 text-[11px] text-muted-foreground uppercase">
                beta
              </span>
            </h1>
            <p className="max-w-xs text-[11px] leading-[1.5] text-muted-foreground uppercase">
              <span aria-hidden="true">░ </span>
              {t('caption')}
            </p>
          </div>

          <nav
            aria-label={t('links.start')}
            className="flex flex-col gap-2 text-[13px] leading-[1.6] uppercase"
          >
            <Link
              href="/signup"
              data-testid="landing-signup"
              className="text-foreground transition-colors duration-fast hover:text-primary"
            >
              <span aria-hidden="true">{'> '}</span>
              {t('links.start')}
            </Link>
            <Link
              href="/signin"
              className="text-muted-foreground transition-colors duration-fast hover:text-primary"
            >
              <span aria-hidden="true">{'> '}</span>
              {t('links.signIn')}
            </Link>
            <Link
              href="/guide"
              data-testid="landing-guide"
              className="text-muted-foreground transition-colors duration-fast hover:text-primary"
            >
              <span aria-hidden="true">{'> '}</span>
              {t('links.guide')}
            </Link>
            <div className="flex items-center gap-2 pt-2 text-muted-foreground">
              <span aria-hidden="true">{'░ '}</span>
              <span>{t('links.language')}</span>
              <LocaleToggle
                current={locale as Locale}
                labels={{ ko: tAccount('localeKo'), en: tAccount('localeEn') }}
              />
            </div>
          </nav>
        </section>

        {/* ---- The artefacts: a letter from Sem, and a receipt ---------- */}
        <section className="grid gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-start">
          <article
            className="flex flex-col gap-6 border border-border-strong bg-card px-6 py-8 text-[15px] leading-[1.7] text-card-foreground md:px-10 md:py-12"
            data-testid="landing-letter"
          >
            <header className="text-[11px] leading-[1.6] uppercase">
              <p>{t('letter.from')}</p>
              <p>{t('letter.org')}</p>
            </header>
            <p>{t('letter.greeting')}</p>
            <p>
              <Highlight text={t('letter.p1')} phrase={t('letter.p1Highlight')} />
            </p>
            <p>{t('letter.p2')}</p>
            <p>{t('letter.p3')}</p>
            <footer className="flex flex-col gap-1 pt-2">
              <p>{t('letter.signoff')}</p>
              <p className="text-[22px] leading-none text-primary">
                {t('letter.signature')}
              </p>
            </footer>
          </article>

          <aside
            className="mx-auto w-full max-w-[300px] border border-border-strong bg-card px-5 py-6 text-[13px] leading-[1.6] text-card-foreground md:mx-0 md:mt-10"
            aria-hidden="true"
          >
            <p className="text-center uppercase">{t('receipt.title')}</p>
            <p className="text-center text-[11px] text-muted-foreground uppercase">
              {t('receipt.meta')}
            </p>
            <div className="my-4 border-t border-dashed border-border-strong" />
            <ReceiptLine label={t('receipt.items.a')} value="4,800" />
            <ReceiptLine label={t('receipt.items.b')} value="2,400" />
            <ReceiptLine label={t('receipt.items.c')} value="1,650" />
            <div className="my-4 border-t border-dashed border-border-strong" />
            <ReceiptLine label={t('receipt.total')} value="¥8,850" strong />
            <ReceiptLine label={t('receipt.each')} value="¥2,950" />
            <div className="my-4 border-t border-dashed border-border-strong" />
            <p className="text-center text-[11px] text-muted-foreground uppercase">
              <span className="text-sem">■ </span>
              {t('receipt.settled')}
            </p>
          </aside>
        </section>

        {/* ---- What it does, as a table ---------------------------------- */}
        <section className="flex flex-col gap-4">
          <p className="text-[11px] leading-[1.5] text-muted-foreground uppercase">
            <span aria-hidden="true">░ </span>
            {t('table.caption')}
          </p>
          <dl className="border-t border-border-strong text-[15px] leading-[1.6]">
            {rows.map((row) => (
              <div
                key={row}
                className="grid grid-cols-[6.5rem_1fr] gap-4 border-b border-border-strong py-3 md:grid-cols-[10rem_1fr]"
              >
                <dt className="text-primary uppercase">{t(`table.rows.${row}.k`)}</dt>
                <dd className="text-foreground">{t(`table.rows.${row}.v`)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="text-[11px] leading-[1.5] text-muted-foreground uppercase">
          <span aria-hidden="true">░ </span>
          {t('footer')}
        </p>
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

/** One receipt row: label left, amount right, dotted leader between. */
function ReceiptLine({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <p className={`flex items-baseline gap-2 ${strong ? 'text-primary' : ''}`}>
      <span className="shrink-0">{label}</span>
      <span
        aria-hidden="true"
        className="min-w-4 flex-1 border-b border-dotted border-border-strong"
      />
      <span className="shrink-0 tabular-nums">{value}</span>
    </p>
  )
}

/** The letter's one highlighted phrase (a gray block behind the words, the
 *  way departuremono.com marks a line — no hue). */
function Highlight({ text, phrase }: { text: string; phrase: string }) {
  const index = text.toLowerCase().indexOf(phrase.toLowerCase())
  if (index < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-primary-soft text-inherit">
        {text.slice(index, index + phrase.length)}
      </mark>
      {text.slice(index + phrase.length)}
    </>
  )
}
