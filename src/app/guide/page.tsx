import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import {
  Camera,
  ClipboardCheck,
  Clock,
  Handshake,
  MessageCircle,
  TrendingUp,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { asPath, safeNext } from '@/lib/next-path'

/**
 * The usage guide. Public on purpose: it is the page you send to someone who
 * has not signed up yet, and it is also where sign-up drops a brand-new
 * account before it continues to wherever it was headed.
 *
 * Two routes land here with two different param names for that destination:
 * the credentials `signUp` action redirects with `?next=`, already a plain
 * path. A brand-new Google account arrives via Auth.js's own `pages.newUser`
 * redirect (wired in `src/auth.ts`) with `?callbackUrl=` instead — and
 * Auth.js's default redirect callback has already turned that into an
 * ABSOLUTE url (`baseUrl` + path) before it got here, so it has to go
 * through `asPath` before `safeNext` will accept it. `next` wins if somehow
 * both are present.
 *
 * There is no "seen it" column. A new account gets here once because one of
 * those two redirects says so, and anyone who wants it again opens it from
 * Account — cheaper than a migration for a screen that costs one tap.
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
  // Both are attacker-controlled and end up in an href. See safeNext/asPath.
  const target =
    next !== undefined ? safeNext(next) : safeNext(asPath(callbackUrl))

  const why = [
    { key: 'rate', Icon: TrendingUp },
    { key: 'receipt', Icon: Camera },
    { key: 'items', Icon: UsersRound },
  ] as const

  const steps = [
    { key: 'group', Icon: UsersRound },
    { key: 'wallet', Icon: Wallet },
    { key: 'chat', Icon: MessageCircle },
    { key: 'assign', Icon: ClipboardCheck },
    { key: 'settle', Icon: Handshake },
  ] as const

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-5 py-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <section className="flex flex-col gap-4">
        {why.map(({ key, Icon }) => (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-2xl bg-card p-4 ring-1 ring-border"
          >
            <h2 className="flex items-center gap-2 font-medium">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
              >
                <Icon className="size-4" />
              </span>
              {t(`why.${key}Title`)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(`why.${key}Body`)}
            </p>
          </div>
        ))}
        {/* One line, not a full why-card (Task 2, chat-indicator-currency):
            documents the pending-persist clock the chat surface can show on
            a message, same icon it uses there. */}
        <div className="flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
          >
            <Clock className="size-4" />
          </span>
          <p className="text-sm text-muted-foreground">{t('persistIcon')}</p>
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="text-xs font-bold">{t('stepsTitle')}</h2>
        <ol className="flex flex-col gap-5">
          {steps.map(({ key, Icon }, index) => (
            <li key={key} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="flex items-center gap-2 font-medium">
                  <Icon aria-hidden="true" className="size-4 text-primary" />
                  {t(`steps.${key}Title`)}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t(`steps.${key}Body`)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('again')}</p>
        <Link
          href={target}
          className={buttonVariants({ size: 'hero' })}
          data-testid="guide-continue"
        >
          {t('cta')}
        </Link>
      </section>
    </main>
  )
}
