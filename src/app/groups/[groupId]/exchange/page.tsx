import { getLocale, getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/BackLink'
import { NavLink } from '@/components/NavLoader'
import { CURATED_CURRENCIES } from '@/lib/currencies'
import { countryName } from '@/lib/country-name'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { loadWalletViews } from './actions'
import { ExchangeManager } from './ExchangeManager'

/** Only in-app group paths may be offered as the "back" target. */
function safeReturnTo(
  value: string | undefined,
  groupId: string,
): string | undefined {
  return value?.startsWith(`/groups/${groupId}/`) ? value : undefined
}

/** Only a curated ISO code may preselect the new-wallet currency. */
function safeCurrency(value: string | undefined): string | undefined {
  return value && (CURATED_CURRENCIES as readonly string[]).includes(value)
    ? value
    : undefined
}

export default async function ExchangePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>
  searchParams: Promise<{
    returnTo?: string
    wallet?: string
    newWalletCurrency?: string
  }>
}) {
  const { groupId } = await params
  const { returnTo, wallet, newWalletCurrency } = await searchParams
  const { member: me } = await requireGroupMember(groupId)
  const [group, wallets, t, tLoading, tWallet, locale] = await Promise.all([
    prisma.group.findUniqueOrThrow({ where: { id: groupId } }),
    loadWalletViews(groupId, me.id),
    getTranslations('exchange'),
    getTranslations('loading'),
    getTranslations('wallet'),
    getLocale(),
  ])
  const settlement = group.settlementCurrency
  const currencies = CURATED_CURRENCIES.filter((code) => code !== settlement)
  // Name the country, not the currency code — same reasoning as home's old
  // prompt (docs/BUGS.md 2026-08-07 / the fix note below), which this
  // replaces now that wallets no longer have a home-page slot (Task 5,
  // app-shell restructure: home is chat-only, so this is now the only place
  // a member with no wallet yet is told WHY they might want one).
  const tripPlace = group.tripCountry
    ? countryName(group.tripCountry, locale)
    : null
  // The wallet-create currency list never offers the settlement currency
  // (no exchange rate needed for money already in it), so preselecting it
  // would silently fall back to the first option instead — worse than not
  // preselecting at all.
  const preselectCurrency =
    group.tripCurrency && group.tripCurrency !== settlement
      ? group.tripCurrency
      : null

  const back = safeReturnTo(returnTo, groupId)
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <BackLink
        href={back ?? `/groups/${groupId}`}
        caption={back ? tLoading('expense') : tLoading('group')}
        label={back ? t('backToExpense') : t('backToGroup')}
        testId="back-to-expense"
      />
      <h1 className="text-xl font-bold">{t('title')}</h1>
      {wallets.length === 0 ? (
        <div data-testid="cash-slot" className="text-sm text-muted-foreground">
          <p>
            {tripPlace && group.tripCurrency !== settlement
              ? tWallet('tripPrompt', { place: tripPlace })
              : t('prompt.question')}
          </p>
          {/* No link when there is nothing a link would change: with no
              trip currency to preselect, this NavLink's target would be
              the exact page already open — a no-op click (review fix,
              2026-08-10). The copy stays either way. */}
          {preselectCurrency ? (
            <NavLink
              href={`/groups/${groupId}/exchange?newWalletCurrency=${preselectCurrency}`}
              caption={tLoading('exchange')}
              className="mt-2 inline-block font-semibold text-primary underline"
              testId="wallet-onboarding-link"
            >
              {t('prompt.log')}
            </NavLink>
          ) : null}
        </div>
      ) : null}
      <ExchangeManager
        groupId={groupId}
        settlementCurrency={settlement}
        currencies={currencies}
        wallets={wallets}
        today={new Date().toLocaleDateString('en-CA')}
        initialWalletId={wallet}
        newWalletCurrency={safeCurrency(newWalletCurrency)}
        returnTo={safeReturnTo(returnTo, groupId)}
      />
    </main>
  )
}
