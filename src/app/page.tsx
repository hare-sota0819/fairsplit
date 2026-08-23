import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { LandingDemo } from '@/components/landing/LandingDemo'
import { LandingNav } from '@/components/landing/LandingNav'
import { LandingReveal } from '@/components/landing/LandingReveal'
import { LocaleToggle } from '@/components/LocaleToggle'
import type { Locale } from '@/i18n/locale'
import { prisma } from '@/lib/prisma'

/**
 * Landing page when signed out — the "statement" landing (handoff
 * reference-landing.html §Hero→05). Signed in, this is never a picker — it
 * opens straight into whichever group you most recently entered an expense
 * in (owner's directive; see git history). The full list moved to /groups.
 *
 * Marketing surface only: forced light, pixel grays from the reference
 * (not theme tokens), so dark mode never inverts it.
 */
export default async function Home() {
  const [session, t, tAccount, locale] = await Promise.all([
    auth(),
    getTranslations('landing'),
    getTranslations('account'),
    getLocale(),
  ])

  if (!session?.user?.id) {
    const sec = 'grid grid-cols-[1fr_minmax(0,1180px)_1fr]'
    const pad = 'px-[clamp(22px,5vw,56px)]'
    const marker =
      'text-[12px] uppercase tracking-[0.14em] text-[#a8a8a8] tabular-nums'
    const h2 =
      'font-heading font-normal text-[clamp(34px,6.6vw,54px)] leading-[1.14] tracking-[-0.01em] text-[#141414]'
    const body = 'text-[clamp(17px,4.4vw,19px)] leading-[1.72]'
    const rule = 'h-px bg-[#e4e4e4] mb-14'
    return (
      <main className="min-h-screen bg-[#fafafa] text-[#565656] antialiased overflow-x-hidden">
        <LandingReveal />
        <LandingNav
          labels={{
            problem: t('nav.problem'),
            method: t('nav.method'),
            rates: t('nav.rates'),
            principle: t('nav.principle'),
            product: t('nav.product'),
          }}
        />

        {/* Hero */}
        <section className={`${sec} min-h-[88vh] content-center pt-24 pb-24`}>
          <div className={`col-start-2 ${pad}`}>
            <p data-reveal className="text-[14px] text-[#9a9a9a]">
              {t('brand')}
            </p>
            <h1
              data-reveal
              data-reveal-delay="60"
              className="mt-9 max-w-[900px] font-heading font-normal text-[clamp(46px,9vw,84px)] leading-[1.04] tracking-[-0.015em] text-[#141414]"
            >
              {t('hero.before')}
              <em className="italic">{t('hero.em')}</em>
            </h1>
            <p
              data-reveal
              data-reveal-delay="120"
              className="mt-10 max-w-[540px] text-[clamp(18px,4.6vw,21px)] leading-[1.62]"
            >
              {t('hero.sub')}
            </p>
            <div
              data-reveal
              data-reveal-delay="200"
              className="mt-20 flex items-center gap-4"
            >
              <span className="landing-cue block h-10 w-px bg-[#c8c8c8]" />
              <span className="text-[13px] text-[#a8a8a8]">{t('scroll')}</span>
            </div>
            <div className="mt-14 flex items-center gap-6 text-[14px]">
              <Link
                href="/signup"
                data-testid="landing-signup"
                className="border-b border-[#141414] pb-0.5 text-[#141414]"
              >
                {t('links.start')}
              </Link>
              <Link
                href="/signin"
                className="text-[#9a9a9a] transition-colors duration-fast hover:text-[#141414]"
              >
                {t('links.signIn')}
              </Link>
              <Link
                href="/guide"
                data-testid="landing-guide"
                className="text-[#9a9a9a] transition-colors duration-fast hover:text-[#141414]"
              >
                {t('links.guide')}
              </Link>
              <LocaleToggle
                current={locale as Locale}
                labels={{ ko: tAccount('localeKo'), en: tAccount('localeEn') }}
              />
            </div>
          </div>
        </section>

        {/* 01 Problem */}
        <section id="problem" className={`${sec} scroll-mt-24 pb-40`}>
          <div className={`col-start-2 ${pad}`}>
            <div data-reveal className={rule} />
            <p data-reveal className={marker}>
              {t('problem.marker')}
            </p>
            <h2 data-reveal data-reveal-delay="60" className={`mt-7 max-w-[780px] ${h2}`}>
              {t('problem.title.before')}
              <em className="italic">{t('problem.title.em')}</em>
            </h2>
            <div data-reveal data-reveal-delay="120" className={`mt-9 max-w-[600px] ${body}`}>
              <p className="mb-6">{t('problem.p1')}</p>
              <p>
                {t('problem.p2.before')}
                <strong className="font-semibold text-[#141414]">1/n</strong>
                {t('problem.p2.after')}
              </p>
            </div>
          </div>
        </section>

        {/* 02 Method */}
        <section id="method" className={`${sec} scroll-mt-24 pb-36`}>
          <div className={`col-start-2 ${pad}`}>
            <div data-reveal className={rule} />
            <p data-reveal className={marker}>
              {t('method.marker')}
            </p>
            <h2 data-reveal data-reveal-delay="60" className={`mt-7 max-w-[820px] ${h2}`}>
              {t('method.title.before')}
              <em className="italic">{t('method.title.em')}</em>
            </h2>
            <p data-reveal data-reveal-delay="120" className={`mt-9 max-w-[600px] ${body}`}>
              {t('method.sub')}
            </p>
            <div className="mt-20 grid max-w-[1000px] gap-12 md:grid-cols-3">
              {(['chat', 'items', 'checkpoint'] as const).map((k, i) => (
                <div key={k} data-reveal data-reveal-delay={String(i * 70)}>
                  <div className="h-px w-7 bg-[#141414]" />
                  <h3 className="mt-5 text-[17px] font-bold leading-6 text-[#141414]">
                    {t(`method.pillars.${k}.title`)}
                  </h3>
                  <p className="mt-3 text-[16px] leading-[1.72] text-[#6f6f6f]">
                    {t(`method.pillars.${k}.body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive demo */}
        <section id="split" className={`${sec} scroll-mt-24 pb-36`}>
          <div className={`col-start-2 ${pad}`}>
            <div data-reveal className={rule} />
            <h2
              data-reveal
              className="font-heading font-normal text-[clamp(28px,5.8vw,38px)] leading-[1.2] text-[#141414]"
            >
              {t('demo.title')}
            </h2>
            <p
              data-reveal
              data-reveal-delay="60"
              className="mt-4 max-w-[560px] text-[16px] leading-[1.7] text-[#8a8a8a]"
            >
              {t('demo.sub')}
            </p>
            <LandingDemo
              locale={locale as Locale}
              labels={{
                item: t('demo.item'),
                paidBy: t('demo.paidBy'),
                peopleL: t('demo.people'),
                rateL: t('demo.rate'),
                payer: t('demo.names.payer'),
                paidTag: t('demo.paidTag'),
                names: [t('demo.names.a'), t('demo.names.b'), t('demo.names.c')],
                rateAvg: t('demo.rateAvg'),
                rateMkt: t('demo.rateMkt'),
                totalL: t('demo.total'),
                perL: t('demo.per'),
                owedL: t('demo.owed'),
                soloNote: t('demo.soloNote'),
                evenNote: t('demo.evenNote'),
                remNoteBefore: t('demo.remNote.before'),
                remNoteAfter: t('demo.remNote.after'),
                personOne: t('demo.personOne'),
                personMany: t('demo.personMany'),
              }}
            />
          </div>
        </section>

        {/* 03 Rates */}
        <section id="rates" className={`${sec} scroll-mt-24 pb-36`}>
          <div className={`col-start-2 ${pad}`}>
            <div data-reveal className={rule} />
            <p data-reveal className={marker}>
              {t('rates.marker')}
            </p>
            <h2 data-reveal data-reveal-delay="60" className={`mt-7 max-w-[820px] ${h2}`}>
              {t('rates.title.before')}
              <em className="italic">{t('rates.title.em')}</em>
            </h2>
            <div data-reveal data-reveal-delay="120" className={`mt-9 max-w-[600px] ${body}`}>
              <p className="mb-6">{t('rates.p1')}</p>
              <p>
                {t('rates.p2.before')}
                <strong className="font-semibold text-[#141414]">
                  {t('rates.p2.strong')}
                </strong>
                {t('rates.p2.after')}
              </p>
            </div>
            <div data-reveal data-reveal-delay="180" className="mt-12 max-w-[640px] tabular-nums">
              <RateRow
                left={t('rates.rows.avg')}
                rate="0.00680"
                value="$80.75"
                strong
              />
              <RateRow
                left={t('rates.rows.market')}
                rate="0.00704"
                value="$83.60"
              />
              <p className="mt-3.5 text-[14px] text-[#9a9a9a]">{t('rates.note')}</p>
            </div>
          </div>
        </section>

        {/* 04 Principle */}
        <section id="principle" className={`${sec} scroll-mt-24 pb-36`}>
          <div className={`col-start-2 ${pad}`}>
            <div data-reveal className={rule} />
            <p data-reveal className={marker}>
              {t('principle.marker')}
            </p>
            <h2 data-reveal data-reveal-delay="60" className={`mt-7 max-w-[900px] ${h2}`}>
              {t('principle.title.before')}
              <em className="italic">{t('principle.title.em')}</em>
            </h2>
            <div data-reveal data-reveal-delay="120" className={`mt-9 max-w-[600px] ${body}`}>
              <p className="mb-6">{t('principle.p1')}</p>
              <p>{t('principle.p2')}</p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className={`${sec} pb-24`}>
          <div className={`col-start-2 ${pad}`}>
            <div className="h-px bg-[#141414]" />
            <div className="mt-0.5 h-px bg-[#141414]" />
            <div className="flex flex-wrap items-start justify-between gap-10 pt-8">
              <div>
                <p className="font-heading text-[18px] text-[#141414]">{t('brand')}</p>
                <p className="mt-2 text-[14px] text-[#9a9a9a]">{t('tagline')}</p>
              </div>
              <nav className="flex gap-8 text-[14px] text-[#9a9a9a]">
                <a href="#problem" className="hover:text-[#141414]">
                  {t('nav.problem')}
                </a>
                <a href="#method" className="hover:text-[#141414]">
                  {t('nav.method')}
                </a>
                <a href="#rates" className="hover:text-[#141414]">
                  {t('nav.rates')}
                </a>
              </nav>
              <p className="text-[13px] text-[#a8a8a8] tabular-nums">{t('copyright')}</p>
            </div>
          </div>
        </footer>
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

/** One comparison row: label … leader … serif figure (statement grammar). */
function RateRow({
  left,
  rate,
  value,
  strong = false,
}: {
  left: string
  rate: string
  value: string
  strong?: boolean
}) {
  const ink = strong ? 'text-[#141414]' : 'text-[#8a8a8a]'
  return (
    <p className={`flex items-baseline border-t border-[#e4e4e4] py-3.5 text-[15px] ${ink}`}>
      <span>
        {left} <span className={strong ? 'text-[#9a9a9a]' : 'text-[#b8b8b8]'}>{rate}</span>
      </span>
      <span
        aria-hidden="true"
        className="mx-3 min-w-4 flex-1 -translate-y-[3px] border-b border-dotted border-[#d8d8d8]"
      />
      <span className={`font-heading text-[20px] ${ink}`}>{value}</span>
    </p>
  )
}
