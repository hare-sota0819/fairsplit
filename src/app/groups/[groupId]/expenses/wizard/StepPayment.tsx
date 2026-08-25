'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { NavLink } from '@/components/NavLoader'
import type { FundingSource } from '@/lib/schemas/expense'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckRow } from '@/components/ui/CheckRow'
import { CreditCard, Landmark, Plus, Wallet } from 'lucide-react'
import {
  deviatesBeyond,
  displayRateToStorage,
  quoteUnitFor,
  storageRateToDisplay,
} from '@/lib/rate-units'
import type { FormWallet } from '../form-props'
import { fundingKey } from './math'
import { NumberField } from './NumberField'
import { RatePreview } from './RatePreview'
import { SplitFunding } from './SplitFunding'
import type { StepProps } from './StepProps'
import { SELECT_FIELD } from '@/components/ui/input'

export { fundingKey }

/** One tappable choice card; the same skin for both questions. */
const CHOICE_CLASS = (selected: boolean): string =>
  `flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition-[background-color,color,border-color,transform] duration-fast ease-swift active:translate-y-px ${
    selected
      ? 'border-primary bg-primary/8 ring-1 ring-primary'
      : 'border-border hover:bg-muted/60'
  }`

const KIND_ICON = {
  CASH: Landmark,
  TRAVEL_CARD: Wallet,
  OTHER_PREPAID: Wallet,
} as const

/**
 * The wallets a member could have paid this expense from: theirs, in this
 * currency. Money in a JPY wallet cannot have bought a KRW dinner.
 */
export function walletsFor(
  wallets: FormWallet[],
  payerId: string,
  currency: string,
): FormWallet[] {
  return wallets.filter(
    (wallet) => wallet.memberId === payerId && wallet.currency === currency,
  )
}

/**
 * The payer's wallets that this expense CANNOT use, because they hold a
 * different currency.
 *
 * Filtering them out of the funding list is right — money in a JPY wallet did
 * not buy a KRW dinner — but silently is not: a user whose travel card
 * vanished concluded the feature was broken. Naming the wallet and offering
 * the switch is the whole fix.
 */
export function walletsInOtherCurrencies(
  wallets: FormWallet[],
  payerId: string,
  currency: string,
): FormWallet[] {
  return wallets.filter(
    (wallet) => wallet.memberId === payerId && wallet.currency !== currency,
  )
}

/**
 * Step 2 — who paid, and out of which pot.
 *
 * This replaces "Cash or Card", which was the wrong question: a Korean
 * traveller who loads a Travel Wallet card has exchanged the money in
 * advance, so it converts at what THAT card cost them — not at the market
 * rate a credit card would get. Every option therefore states its own
 * consequence: the rate it implies and what is left on it.
 */
export function StepPayment({
  groupId,
  state,
  patch,
  data,
  math,
  market,
  parkDraft,
}: StepProps) {
  const t = useTranslations('expenses.form')
  const tWallet = useTranslations('wallet')
  const format = useFormatter()
  const settlement = data.defaults.settlementCurrency
  const members = data.members
  const mine = walletsFor(data.wallets, state.payerId, state.currency)
  // Grouped by currency, not one row per wallet: a payer with both a cash
  // and a card wallet in the same foreign currency must see ONE line and one
  // switch button for it, not two identical-looking offers.
  const elsewhereByCurrency = new Map<string, FormWallet[]>()
  for (const wallet of walletsInOtherCurrencies(
    data.wallets,
    state.payerId,
    state.currency,
  )) {
    const group = elsewhereByCurrency.get(wallet.currency)
    if (group) {
      group.push(wallet)
    } else {
      elsewhereByCurrency.set(wallet.currency, [wallet])
    }
  }
  const quoteUnit = quoteUnitFor(state.currency)
  const unit = quoteUnit === 1 ? '' : quoteUnit.toLocaleString('en')
  const marketMode = data.defaults.rateMode === 'MARKET'

  // QUESTION 2, and only for prepaid: which of this member's pots. The
  // phantom "Cash (JPY)" entry that used to sit in this list is gone — it
  // was the "why does it keep offering me a wallet I don't have?" complaint,
  // and a member with no wallet now answers with their own rate instead and
  // is OFFERED a wallet after saving.
  const options: {
    key: string
    source: FundingSource
    node: React.ReactNode
  }[] = []
  for (const wallet of mine) {
    const Icon = KIND_ICON[wallet.type]
    options.push({
      key: fundingKey({ kind: 'WALLET', walletId: wallet.id }),
      source: { kind: 'WALLET', walletId: wallet.id },
      node: (
        <>
          {/* Name AND kind, never the rate alone: two wallets can carry the
              same rate by coincidence and become indistinguishable. */}
          <span className="flex items-center gap-2 font-medium">
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {wallet.label}
            <span className="text-xs font-normal text-muted-foreground">
              {tWallet(`type.${wallet.type}`)}
            </span>
          </span>
          {/* Nothing to say about a rate when the wallet already holds the
              settlement currency — there is no conversion to explain. */}
          {math.foreign ? (
            <span className="text-xs text-muted-foreground">
              {marketMode
                ? t('noteMarketMode')
                : wallet.avgRate
                  ? tWallet('yourRate', {
                      unit,
                      currency: wallet.currency,
                      rate:
                        storageRateToDisplay(wallet.avgRate, wallet.currency) ??
                        '?',
                      settlement,
                    })
                  : tWallet('noTopUps')}
            </span>
          ) : null}
          <span
            className={`text-xs ${wallet.overdrawn ? 'text-negative' : 'text-muted-foreground'}`}
          >
            {wallet.overdrawn
              ? tWallet('overdrawn', { amount: wallet.balance })
              : tWallet('remaining', { amount: wallet.balance })}
          </span>
        </>
      ),
    })
  }

  const selectedKey = fundingKey(state.funding)
  const walletsHref = (walletId?: string): string =>
    `/groups/${groupId}/exchange?${walletId ? `wallet=${walletId}&` : ''}returnTo=${encodeURIComponent(
      `/groups/${groupId}/expenses/new`,
    )}`

  // The sanity guard compares a hand-typed rate against the LOOKED-UP market
  // rate — never against itself, which is what `math.effectiveRate` becomes
  // the moment the override is on.
  const manualStorage =
    state.manualOpen && state.manualRate
      ? displayRateToStorage(state.manualRate, state.currency)
      : null
  const lookedUp = market?.rate ?? null
  const unusual =
    manualStorage !== null &&
    lookedUp !== null &&
    deviatesBeyond(manualStorage, lookedUp, 30)

  // QUESTION 1's answer, read back off the funding source rather than held
  // as its own state — there is exactly one truth about how this was paid.
  const prepaid = state.funding.kind !== 'PAY_AS_YOU_GO'
  // A member with no pot in this currency can still say "I prepaid this":
  // they tell us the rate they exchanged at, which is the one number the app
  // has no way to look up. NOT a market-rate override. A same-currency
  // expense has nothing to convert, so it is told the same thing minus the
  // question — never an empty list of wallets to choose from.
  const noWallets = prepaid && mine.length === 0
  const needsOwnRate = noWallets && math.foreign

  // QUESTION 3 lives in its own component now: it is only asked when the
  // arithmetic forces it, and its fields live in a dialog. See SplitFunding.
  const amountMinor = math.amountMinor
  const splitAllowed = amountMinor !== null && amountMinor > 0n
  const chosen = state.funding
  const selectedWallet =
    chosen.kind === 'WALLET'
      ? (mine.find((w) => w.id === chosen.walletId) ?? null)
      : null
  const primaryLabel =
    selectedWallet?.label ??
    (state.funding.kind === 'PREPAID_NO_WALLET'
      ? t('sourceOwnRate')
      : t('sourceOnTheSpot'))

  const answerQuestionOne = (choosePrepaid: boolean) => {
    if (!choosePrepaid) {
      patch({ funding: { kind: 'PAY_AS_YOU_GO' } })
      return
    }
    if (state.funding.kind !== 'PAY_AS_YOU_GO') {
      return // already a prepaid answer; keep whichever one it is
    }
    patch({
      funding:
        mine.length > 0
          ? { kind: 'WALLET', walletId: mine[0].id }
          : { kind: 'PREPAID_NO_WALLET' },
    })
  }

  return (
    <div className="flex flex-col gap-7">
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1.5 font-medium">{t('payer')}</legend>
        {/* A dropdown, not a row of chips. Chips grew with the group and
            wrapped onto three lines, pushing the question that follows off
            the screen — and the answer is now nearly always the one already
            selected, since the form opens on whoever is entering it. */}
        <select
          aria-label={t('payer')}
          value={state.payerId}
          // Switching payer switches to THEIR usual source: one member's
          // travel card is not a funding source the next member has. Picking
          // the payer already selected is NOT a switch, though, and must
          // leave the source alone — a chip could only be re-clicked into
          // deselection, so this guard had nothing to protect until now.
          onChange={(event) => {
            const payerId = event.target.value
            if (payerId === state.payerId) return
            patch({
              payerId,
              funding: data.defaults.lastFundingByPayer[payerId] ?? {
                kind: 'PAY_AS_YOU_GO',
              },
            })
          }}
          className={SELECT_FIELD}
          data-testid="payer-select"
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {/* Naming the acting member is what makes an unchanged default
                  readable: "Sota" alone does not say whose form this is. */}
              {m.id === data.defaults.meId
                ? t('payerMe', { name: m.name })
                : m.name}
            </option>
          ))}
        </select>
      </fieldset>

      {/* TWO questions, asked in order. The old single flat list mixed real
          wallets, a wallet that did not exist yet, and a card, and read as
          noise. "Was this prepaid?" is the only thing that changes the rate,
          so it is asked on its own first. */}
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">{t('paidFromQuestion')}</legend>
        <div
          role="radiogroup"
          aria-label={t('paidFromQuestion')}
          className="flex flex-col gap-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={prepaid}
            onClick={() => answerQuestionOne(true)}
            data-testid="paid-prepaid"
            className={CHOICE_CLASS(prepaid)}
          >
            <span className="flex items-center gap-2 font-medium">
              <Wallet aria-hidden="true" className="size-4 shrink-0" />
              {t('prepaidOption')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('prepaidOptionNote')}
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!prepaid}
            onClick={() => answerQuestionOne(false)}
            data-testid="paid-on-the-spot"
            className={CHOICE_CLASS(!prepaid)}
          >
            <span className="flex items-center gap-2 font-medium">
              <CreditCard aria-hidden="true" className="size-4 shrink-0" />
              {t('onTheSpotOption')}
            </span>
            <span className="text-xs text-muted-foreground">
              {marketMode ? t('noteMarketMode') : t('onTheSpotOptionNote')}
            </span>
          </button>
        </div>
      </fieldset>

      {/* QUESTION 2 — only when the answer to the first one needs one. Paid
          on the spot converts at the market rate and has nothing more to
          ask. */}
      {prepaid ? (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">
            {noWallets ? t('ownRateLabel') : t('whichWallet')}
          </legend>
          {noWallets ? (
            <div className="flex flex-col gap-1.5">
              <p
                className="text-xs leading-relaxed text-muted-foreground"
                data-testid="no-wallets-note"
              >
                {t('noWalletsYet')}
              </p>
              {needsOwnRate ? (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className="shrink-0 font-semibold"
                      data-testid="own-rate-anchor"
                    >
                      {t('ownRateAnchor', { unit, currency: state.currency })}
                    </span>
                    <NumberField
                      value={state.ownRate}
                      onChange={(ownRate) => patch({ ownRate })}
                      ariaLabel={`${unit} ${state.currency} = ? ${settlement}`}
                      inputClassName="h-11 w-32"
                      testId="own-rate"
                    />
                    <span className="shrink-0 font-semibold">{settlement}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('ownRateHint')}
                  </p>
                </>
              ) : null}
            </div>
          ) : (
            <div
              role="radiogroup"
              aria-label={t('whichWallet')}
              className="flex flex-col gap-2"
            >
              {options.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selectedKey === option.key}
                  onClick={() => patch({ funding: option.source })}
                  data-testid={`funding-${option.key}`}
                  className={CHOICE_CLASS(selectedKey === option.key)}
                >
                  {option.node}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      ) : null}

      {/* QUESTION 3 — how much of it came from there. The funding source
          decides the RATE, so a receipt half paid another way that is
          recorded as if it all came off one card converts money at a rate it
          never touched. That is a wrong settlement figure, not an untidy
          wallet balance. It asks nothing until the arithmetic makes it. */}
      {splitAllowed ? (
        <SplitFunding
          state={state}
          patch={patch}
          math={math}
          wallets={data.wallets}
          mine={mine}
          members={members}
          selectedWallet={selectedWallet}
          primaryLabel={primaryLabel}
          settlement={settlement}
          market={market}
        />
      ) : null}

      <fieldset className="flex flex-col gap-2 text-sm">
        {/* The conversion, restated here so choosing a wallet visibly moves
            the number. Step 1 quoted the market rate; this is where the
            answer to "what did you pay with?" changes it, in front of the
            user rather than silently between screens. */}
        <RatePreview
          math={math}
          market={market}
          marketLoading={false}
          settlementCurrency={settlement}
          currency={state.currency}
        />

        {elsewhereByCurrency.size > 0 ? (
          <div
            className="flex flex-col gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm"
            data-testid="other-currency-wallets"
          >
            {Array.from(elsewhereByCurrency.entries()).map(
              ([currency, currencyWallets]) => (
                <div key={currency} className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">
                    {t('otherCurrencyWallet', {
                      count: currencyWallets.length,
                      currency,
                      // format.list() (Intl.ListFormat) supplies the
                      // locale's own separators and conjunction — never
                      // hard-code list punctuation, it is not always ", ".
                      wallets: format.list(
                        currencyWallets.map((wallet) =>
                          t('otherCurrencyWalletItem', {
                            label: wallet.label,
                            balance: wallet.balance,
                          }),
                        ),
                      ),
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    className="w-fit"
                    onClick={() => patch({ currency })}
                    data-testid={`switch-currency-${currency}`}
                  >
                    {t('switchCurrency', { currency })}
                  </Button>
                </div>
              ),
            )}
          </div>
        ) : null}

        <Card size="sm" className="mt-1">
          <CardContent className="flex flex-col items-start gap-1.5 text-xs">
            <span className="text-muted-foreground">{t('topUpQuestion')}</span>
            <div className="flex flex-wrap items-center gap-3">
              <NavLink
                href={walletsHref(
                  state.funding.kind === 'WALLET'
                    ? state.funding.walletId
                    : undefined,
                )}
                caption={tWallet('title')}
                onClick={parkDraft}
                className="font-semibold text-primary underline"
                testId="log-top-up"
              >
                {t('topUpLink')}
              </NavLink>
              <NavLink
                href={walletsHref()}
                caption={tWallet('title')}
                onClick={parkDraft}
                className="inline-flex items-center gap-1 font-medium text-muted-foreground underline"
                testId="add-wallet-link"
              >
                <Plus aria-hidden="true" className="size-3" />
                {t('addWalletLink')}
              </NavLink>
            </div>
          </CardContent>
        </Card>

        {math.foreign ? (
          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() =>
                patch({ manualOpen: !state.manualOpen, manualRate: '' })
              }
              className="w-fit text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
              data-testid="manual-rate-toggle"
            >
              {state.manualOpen ? t('manualToggleOff') : t('manualToggleOn')}
            </button>
            {state.manualOpen ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="shrink-0 font-semibold"
                    data-testid="rate-anchor"
                  >
                    {unit} {state.currency} =
                  </span>
                  <NumberField
                    value={state.manualRate}
                    onChange={(manualRate) => patch({ manualRate })}
                    ariaLabel={`${unit} ${state.currency} = ? ${settlement}`}
                    inputClassName="h-11 w-32"
                    testId="market-rate"
                  />
                  <span className="shrink-0 font-semibold">{settlement}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('manualHint')}
                </p>
                {unusual ? (
                  <p className="text-xs text-notice" data-testid="rate-unusual">
                    {t('rateUnusual', {
                      unit,
                      currency: state.currency,
                      rate:
                        storageRateToDisplay(lookedUp!, state.currency) ?? '?',
                      settlement,
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      {/* §5 — picking who was in on it is a list of rows, not a row of
          chips: the whole row is the tap target and anyone left out greys
          at once. The closing hairline is the list's own bottom rule. */}
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1.5 font-medium">{t('participants')}</legend>
        <div className="flex flex-col border-b border-[#e4e4e4]">
          {members.map((m) => {
            const chosen = state.isPersonal
              ? m.id === state.payerId
              : state.participantIds.includes(m.id)
            return (
              <CheckRow
                key={m.id}
                checked={chosen}
                disabled={state.isPersonal}
                onCheckedChange={(next) =>
                  patch({
                    participantIds: next
                      ? [...state.participantIds, m.id]
                      : state.participantIds.filter((id) => id !== m.id),
                  })
                }
                label={m.name}
              />
            )
          })}
        </div>
        <CheckRow
          className="mt-1 border-t-0"
          checked={state.isPersonal}
          onCheckedChange={(isPersonal) => patch({ isPersonal })}
          label={t('personal')}
          testId="personal-toggle"
        />
      </fieldset>
    </div>
  )
}
