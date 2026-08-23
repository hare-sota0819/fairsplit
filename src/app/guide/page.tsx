import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { asPath, safeNext } from '@/lib/next-path'

/**
 * The usage guide, in the statement grammar: hairline rows instead of icon
 * cards, serif tabular numerals instead of number badges, a text-link CTA.
 * Public on purpose — it is the page you send to someone who has not signed
 * up yet, and where sign-up drops a brand-new account before continuing.
 *
 * Destination params: credentials signUp redirects with ?next= (a plain
 * path); a first-time Google account arrives via Auth.js pages.newUser with
 * ?callbackUrl= (already absolute, so it goes through asPath). next wins if
 * both are present. Both are attacker-controlled and end up in an href —
 * see safeNext/asPath.
 */
export default async function GuidePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; callbackUrl?: string }>
}) {
  const [{ next, callbackUrl }, t] = await Promise.all([
    searchParams,
    getTranslations('guide'),
  ])
  const target =
    next !== undefined ? safeNext(next) : safeNext(asPath(callbackUrl))

  const why = ['rate', 'receipt', 'items'] as const
  const steps = ['group', 'wallet', 'entry', 'assign', 'settle'] as const

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-12">
      <h1 className="font-heading text-[32px] leading-[1.25] font-normal tracking-[-0.01em] text-foreground">
        {t('title')}
      </h1>
      <p className="mt-3 text-[15px] leading-[1.7] text-muted-foreground">
        {t('intro')}
      </p>

      <section className="mt-10 flex flex-col">
        {why.map((key, index) => (
          <div
            key={key}
            className={`border-t border-border py-5 ${index === why.length - 1 ? 'border-b' : ''}`}
          >
            <h2 className="text-base font-bold text-foreground">
              {t(`why.${key}Title`)}
            </h2>
            <p className="mt-2 text-sm leading-[1.65] text-muted-foreground">
              {t(`why.${key}Body`)}
            </p>
          </div>
        ))}
      </section>

      <h2 className="mt-10 text-[12px] tracking-[0.14em] text-muted-foreground uppercase">
        {t('stepsTitle')}
      </h2>
      <ol className="mt-3 flex flex-col">
        {steps.map((key, index) => (
          <li
            key={key}
            className={`flex items-start gap-5 border-t border-border py-4.5 ${index === steps.length - 1 ? 'border-b' : ''}`}
          >
            <span
              aria-hidden="true"
              className="shrink-0 pt-px font-heading text-[15px] text-muted-foreground tabular-nums"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h3 className="text-[15px] font-bold text-foreground">
                {t(`steps.${key}Title`)}
              </h3>
              <p className="text-sm leading-[1.65] text-muted-foreground">
                {t(`steps.${key}Body`)}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-9 flex items-baseline justify-between gap-6">
        <Link
          href={target}
          data-testid="guide-continue"
          className="shrink-0 text-base text-foreground underline decoration-1 underline-offset-[6px] transition-colors duration-fast hover:text-muted-foreground"
        >
          {t('cta')} <span aria-hidden="true">&rarr;</span>
        </Link>
        <p className="text-right text-[13px] text-muted-foreground">
          {t('again')}
        </p>
      </div>
    </main>
  )
}
