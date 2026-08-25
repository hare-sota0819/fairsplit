'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CreditCard, Landmark, Users, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { formatMinor, minorToDecimalInput } from '@/lib/format'
import type { FundingSource } from '@/lib/schemas/expense'
import { quoteUnitFor, storageRateToDisplay } from '@/lib/rate-units'
import type { FormMember, FormWallet } from '../form-props'
import {
  fundingKey,
  pendingTopUp,
  sourceFromKey,
  type ExpenseMath,
  type ExtraFunding,
  type MarketQuote,
  type WizardState,
} from './math'
import { NumberField } from './NumberField'
import { SELECT_FIELD } from '@/components/ui/input'

const KIND_ICON = {
  CASH: Landmark,
  TRAVEL_CARD: Wallet,
  OTHER_PREPAID: Wallet,
} as const

/** Which editor the dialog is currently showing, and what it is editing. */
type Editing =
  | { kind: 'TILL' }
  /** An extra portion, by its key. The row exists before the dialog opens. */
  | { kind: 'EXTRA'; key: number }
  | null

const DIALOG_SELECT_CLASS = SELECT_FIELD

const ANSWER_CLASS =
  'flex flex-col gap-0.5 rounded-xl border border-border px-4 py-3 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted/60 active:translate-y-px active:bg-muted/60'

/**
 * "How much of this came from where", asked only when it has to be.
 *
 * The old version showed five things at once — a shortfall notice, a top-up
 * offer, the portion list, and two buttons — whatever the numbers said. The
 * owner's report was that there was simply too much on screen to read, and
 * that is what this is for: nothing at all when the arithmetic asks nothing,
 * ONE question when it does, and the fields for the answer inside a dialog
 * rather than laid out permanently beside it.
 */
export function SplitFunding({
  state,
  patch,
  math,
  wallets,
  mine,
  members,
  selectedWallet,
  primaryLabel,
  settlement,
  market,
}: {
  state: WizardState
  patch: (patch: Partial<WizardState>) => void
  math: ExpenseMath
  /** Every wallet in the group: a co-funder spends from their own. */
  wallets: FormWallet[]
  /** The payer's own wallets in this expense's currency. */
  mine: FormWallet[]
  members: FormMember[]
  selectedWallet: FormWallet | null
  primaryLabel: string
  settlement: string
  market: MarketQuote | null
}) {
  const t = useTranslations('expenses.form')
  const tWallet = useTranslations('wallet')
  const tCommon = useTranslations('common')
  const [editing, setEditing] = useState<Editing>(null)

  const currency = state.currency
  const quoteUnit = quoteUnitFor(currency)
  const unit = quoteUnit === 1 ? '' : quoteUnit.toLocaleString('en')
  /**
   * What the chosen source is left covering: the total minus every portion
   * already named. Measuring the gap against the TOTAL is what made the old
   * notice stay on screen after it had been answered — it had to be hidden by
   * hand once any extra existed, which is not the same as being answered.
   */
  const primaryNeeds = math.primaryAmount

  const tillTopUp = pendingTopUp(state, wallets, settlement)
  const capacity =
    selectedWallet === null
      ? null
      : bigMax(BigInt(selectedWallet.balanceMinor), 0n) +
        (tillTopUp !== null && tillTopUp.walletId === selectedWallet.id
          ? tillTopUp.received
          : 0n)
  const shortfall =
    capacity !== null && primaryNeeds !== null && primaryNeeds > capacity
      ? primaryNeeds - capacity
      : null
  /** The shortfall BEFORE any till top-up: what an offer is sized against. */
  const bareShortfall =
    selectedWallet !== null && primaryNeeds !== null
      ? bigMax(
          primaryNeeds - bigMax(BigInt(selectedWallet.balanceMinor), 0n),
          0n,
        )
      : 0n

  /**
   * The market rate in the units the rate fields speak, or null when there is
   * none to offer. Money changed at a till was changed TODAY, so today's rate
   * is the only sensible thing to open with — a booth takes a margin on top,
   * which is why the figure stays editable and says so.
   */
  const marketDisplay = market?.rate
    ? storageRateToDisplay(market.rate, currency)
    : null

  const hasTill = state.topUpAmount !== ''
  const answered = hasTill || state.extraFunding.length > 0

  const openTill = () => {
    if (!hasTill) {
      patch({
        topUpAmount: minorToDecimalInput(bareShortfall, currency),
        topUpRate: marketDisplay ?? '',
        topUpPaid: '',
      })
    }
    setEditing({ kind: 'TILL' })
  }
  const clearTill = () =>
    patch({ topUpAmount: '', topUpRate: '', topUpPaid: '' })

  const openExtra = (source: FundingSource, amount: bigint, memberId = '') => {
    const key = state.nextKey
    patch({
      nextKey: key + 1,
      extraFunding: [
        ...state.extraFunding,
        {
          key,
          amount: amount > 0n ? minorToDecimalInput(amount, currency) : '',
          source,
          ownRate: '',
          memberId,
        },
      ],
    })
    setEditing({ kind: 'EXTRA', key })
  }

  const patchExtra = (key: number, change: Partial<ExtraFunding>) =>
    patch({
      extraFunding: state.extraFunding.map((extra) =>
        extra.key === key ? { ...extra, ...change } : extra,
      ),
    })

  const removeExtra = (key: number) =>
    patch({
      extraFunding: state.extraFunding.filter((extra) => extra.key !== key),
    })

  /**
   * The wallets an EXTRA portion may name: not the primary source (naming it
   * twice is two portions that are one), and not one with nothing left — that
   * is not an answer to "where did the rest come from", it is the question.
   * The row's own current choice always stays listed, or the select would
   * show a value it has no option for.
   */
  const extraWalletOptions = (current: FundingSource): FormWallet[] =>
    mine.filter(
      (w) =>
        (current.kind === 'WALLET' && current.walletId === w.id) ||
        (w.id !== selectedWallet?.id && BigInt(w.balanceMinor) > 0n),
    )
  const spareWallets = mine.filter(
    (w) => w.id !== selectedWallet?.id && BigInt(w.balanceMinor) > 0n,
  )

  const nameOf = (memberId: string): string =>
    members.find((m) => m.id === memberId)?.name ?? '—'

  /** Everyone but the payer: the people who could have covered the rest. */
  const others = members.filter((m) => m.id !== state.payerId)

  /**
   * The wallets a CO-FUNDER's portion may name — theirs, in this currency.
   * A friend's money did not come out of the payer's card, and offering it
   * would credit the friend at a rate their money never bought.
   */
  const walletsOfFunder = (memberId: string): FormWallet[] =>
    wallets.filter((w) => w.memberId === memberId && w.currency === currency)

  const sourceLabel = (extra: ExtraFunding): string => {
    const source = extra.source
    const base =
      source.kind === 'WALLET'
        ? ((extra.memberId ? walletsOfFunder(extra.memberId) : mine).find(
            (w) => w.id === source.walletId,
          )?.label ?? '—')
        : source.kind === 'PREPAID_NO_WALLET'
          ? t('sourceOwnRate')
          : t('sourceOnTheSpot')
    return extra.memberId
      ? t('portionBy', { name: nameOf(extra.memberId), source: base })
      : base
  }

  const editingExtra =
    editing?.kind === 'EXTRA'
      ? (state.extraFunding.find((extra) => extra.key === editing.key) ?? null)
      : null

  const tillPaidShown =
    state.topUpPaid ||
    (tillTopUp === null ? '' : minorToDecimalInput(tillTopUp.paid, settlement))

  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="sr-only">{t('splitQuestion')}</legend>

      {/* The portions, once there is more than one. A single source needs no
          list: the question above already named it. */}
      {answered ? (
        <div
          className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3"
          data-testid="split-primary-row"
        >
          <span
            className="w-28 shrink-0 font-medium tabular-nums"
            data-testid="split-primary"
          >
            {math.primaryAmount === null
              ? '—'
              : formatMinor(math.primaryAmount, currency)}
          </span>
          <span className="flex-1 font-medium">{primaryLabel}</span>
        </div>
      ) : null}

      {hasTill ? (
        <AnswerRow
          testId="till-summary"
          label={t('tillSummary', {
            amount: state.topUpAmount,
            currency,
          })}
          detail={
            state.topUpRate
              ? t('rateLine', {
                  unit,
                  currency,
                  rate: state.topUpRate,
                  settlement,
                })
              : undefined
          }
          editLabel={t('portionEdit')}
          removeLabel={t('splitRemove')}
          onEdit={() => setEditing({ kind: 'TILL' })}
          onRemove={clearTill}
        />
      ) : null}

      {state.extraFunding.map((extra) => (
        <AnswerRow
          key={extra.key}
          testId="split-extra"
          label={
            extra.amount
              ? `${extra.amount} ${currency}`
              : t('portionNoAmount', { currency })
          }
          detail={sourceLabel(extra)}
          editLabel={t('portionEdit')}
          removeLabel={t('splitRemove')}
          onEdit={() => setEditing({ kind: 'EXTRA', key: extra.key })}
          onRemove={() => removeExtra(extra.key)}
        />
      ))}

      {/* THE QUESTION. Only the arithmetic raises it, and it raises exactly
          one — everything an answer needs is inside its own dialog. */}
      {shortfall !== null ? (
        <div className="flex flex-col gap-2" data-testid="split-shortfall">
          <p className="text-sm font-medium">
            {t('shortfallQuestion', {
              amount: formatMinor(shortfall, currency),
            })}
          </p>
          {selectedWallet ? (
            <button
              type="button"
              className={ANSWER_CLASS}
              onClick={openTill}
              data-testid="answer-till"
            >
              <span className="font-medium">{t('answerTill')}</span>
              <span className="text-xs text-muted-foreground">
                {t('answerTillNote', { label: primaryLabel })}
              </span>
            </button>
          ) : null}
          {spareWallets.map((wallet) => {
            const Icon = KIND_ICON[wallet.type]
            return (
              <button
                key={wallet.id}
                type="button"
                className={ANSWER_CLASS}
                onClick={() =>
                  openExtra(
                    { kind: 'WALLET', walletId: wallet.id },
                    bigMin(shortfall, BigInt(wallet.balanceMinor)),
                  )
                }
                data-testid={`answer-wallet-${wallet.id}`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {t('answerOtherWallet', { label: wallet.label })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {tWallet('remaining', { amount: wallet.balance })}
                </span>
              </button>
            )
          })}
          {others.length > 0 ? (
            <button
              type="button"
              className={ANSWER_CLASS}
              onClick={() =>
                openExtra({ kind: 'PAY_AS_YOU_GO' }, shortfall, others[0].id)
              }
              data-testid="answer-someone-else"
            >
              <span className="flex items-center gap-2 font-medium">
                <Users aria-hidden="true" className="size-4 shrink-0" />
                {t('answerSomeoneElse')}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('answerSomeoneElseNote')}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className={ANSWER_CLASS}
            onClick={() => openExtra({ kind: 'PAY_AS_YOU_GO' }, shortfall)}
            data-testid="answer-on-the-spot"
          >
            <span className="flex items-center gap-2 font-medium">
              <CreditCard aria-hidden="true" className="size-4 shrink-0" />
              {t('answerOnTheSpot')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('answerOnTheSpotNote')}
            </span>
          </button>
        </div>
      ) : (
        // No shortfall asks nothing. A receipt paid from two pockets when
        // neither ran out is still a real thing, so the way in stays — as a
        // link, not a panel.
        <button
          type="button"
          onClick={() => openExtra({ kind: 'PAY_AS_YOU_GO' }, 0n)}
          className="w-fit text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
          data-testid="add-split-source"
        >
          {t('splitAdd')}
        </button>
      )}

      {math.primaryAmount !== null && math.primaryAmount < 0n ? (
        <p className="text-xs text-negative" data-testid="split-over">
          {t('splitOver', {
            amount: formatMinor(-math.primaryAmount, currency),
          })}
        </p>
      ) : null}

      <Dialog
        open={editing?.kind === 'TILL'}
        onOpenChange={(open) => !open && setEditing(null)}
        title={t('tillTitle', { label: primaryLabel })}
        description={t('tillDialogNote')}
        closeLabel={tCommon('close')}
        testId="till-dialog"
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t('tillAmountLabel', { currency })}
          </span>
          <NumberField
            value={state.topUpAmount}
            onChange={(topUpAmount) => patch({ topUpAmount })}
            ariaLabel={t('tillAmountLabel', { currency })}
            inputClassName="h-11 w-full"
            testId="till-amount"
          />
        </div>
        <RateField
          value={state.topUpRate}
          onChange={(topUpRate) => patch({ topUpRate })}
          auto={marketDisplay}
          label={t('tillRateLabel', { unit, currency, settlement })}
          autoLine={t('rateLine', {
            unit,
            currency,
            rate: state.topUpRate,
            settlement,
          })}
          changeLabel={t('rateNotThis')}
          testId="till-rate"
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t('tillPaidLabel', { settlement })}
          </span>
          <NumberField
            value={tillPaidShown}
            onChange={(topUpPaid) => patch({ topUpPaid })}
            ariaLabel={t('tillPaidLabel', { settlement })}
            inputClassName="h-11 w-full"
            testId="till-paid"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="touch"
            className="flex-1"
            onClick={() => setEditing(null)}
            data-testid="till-done"
          >
            {tCommon('done')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={() => {
              clearTill()
              setEditing(null)
            }}
            data-testid="till-topup-remove"
          >
            {t('splitRemove')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={editingExtra !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={t('portionTitle')}
        closeLabel={tCommon('close')}
        testId="portion-dialog"
      >
        {editingExtra ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t('splitAmountLabel')}
              </span>
              <NumberField
                value={editingExtra.amount}
                onChange={(amount) => patchExtra(editingExtra.key, { amount })}
                ariaLabel={t('splitAmountLabel')}
                inputClassName="h-11 w-full"
                testId={`split-extra-amount-${editingExtra.key}`}
              />
            </div>
            {others.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {t('portionWhoLabel')}
                </span>
                <select
                  aria-label={t('portionWhoLabel')}
                  value={editingExtra.memberId}
                  // Switching funder drops the wallet: one member's travel
                  // card is not a pot the next member could have paid from,
                  // and keeping it would credit them at a rate their own
                  // money never bought.
                  onChange={(event) =>
                    patchExtra(editingExtra.key, {
                      memberId: event.target.value,
                      source: { kind: 'PAY_AS_YOU_GO' },
                      ownRate: '',
                    })
                  }
                  className={DIALOG_SELECT_CLASS}
                  data-testid={`split-extra-who-${editingExtra.key}`}
                >
                  <option value="">{t('portionWhoPayer')}</option>
                  {others.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t('splitSourceLabel')}
              </span>
              <select
                aria-label={t('splitSourceLabel')}
                value={fundingKey(editingExtra.source)}
                onChange={(event) =>
                  patchExtra(editingExtra.key, {
                    source: sourceFromKey(event.target.value),
                  })
                }
                className={DIALOG_SELECT_CLASS}
                data-testid={`split-extra-source-${editingExtra.key}`}
              >
                {(editingExtra.memberId
                  ? walletsOfFunder(editingExtra.memberId)
                  : extraWalletOptions(editingExtra.source)
                ).map((w) => (
                  <option
                    key={w.id}
                    value={fundingKey({ kind: 'WALLET', walletId: w.id })}
                  >
                    {w.label}
                  </option>
                ))}
                <option value="PAY_AS_YOU_GO">{t('sourceOnTheSpot')}</option>
                {/* "Money I exchanged myself" is the answer for someone with
                    no pot in this currency at all, which is the same
                    condition question 2 above puts on it. */}
                {(editingExtra.memberId
                  ? walletsOfFunder(editingExtra.memberId).length === 0
                  : mine.length === 0) ||
                editingExtra.source.kind === 'PREPAID_NO_WALLET' ? (
                  <option value="PREPAID_NO_WALLET">
                    {t('sourceOwnRate')}
                  </option>
                ) : null}
              </select>
            </div>
            {editingExtra.source.kind === 'PREPAID_NO_WALLET' &&
            math.foreign ? (
              <RateField
                value={editingExtra.ownRate}
                onChange={(ownRate) =>
                  patchExtra(editingExtra.key, { ownRate })
                }
                auto={null}
                label={t('ownRateAnchor', { unit, currency })}
                autoLine=""
                changeLabel={t('rateNotThis')}
                testId={`split-extra-rate-${editingExtra.key}`}
              />
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                size="touch"
                className="flex-1"
                onClick={() => setEditing(null)}
                data-testid="portion-done"
              >
                {tCommon('done')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="touch"
                onClick={() => {
                  removeExtra(editingExtra.key)
                  setEditing(null)
                }}
                data-testid={`split-extra-remove-${editingExtra.key}`}
              >
                {t('splitRemove')}
              </Button>
            </div>
          </>
        ) : null}
      </Dialog>
    </fieldset>
  )
}

/** One answer already given: what it was, and the two things you can do to it. */
function AnswerRow({
  testId,
  label,
  detail,
  editLabel,
  removeLabel,
  onEdit,
  onRemove,
}: {
  testId: string
  label: string
  detail?: string
  editLabel: string
  removeLabel: string
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-border px-4 py-3"
      data-testid={testId}
    >
      <span className="flex flex-1 flex-col">
        <span className="font-medium tabular-nums">{label}</span>
        {detail ? (
          <span className="text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
        {editLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        {removeLabel}
      </Button>
    </div>
  )
}

/**
 * A rate that already has a sensible answer, stated rather than demanded.
 *
 * Money changed at a till was changed today, so today's looked-up rate is the
 * right thing to open with — the user came here to record a purchase, not to
 * key in a number they would have to go and find. A booth takes a margin on
 * top of the market, so the figure is optimistic and must never be presented
 * as certain: "not this rate?" opens the field, and any rate typed by hand
 * stays open, because a hand-typed number is not one to hide behind a link.
 */
function RateField({
  value,
  onChange,
  auto,
  label,
  autoLine,
  changeLabel,
  testId,
}: {
  value: string
  onChange: (next: string) => void
  /** The looked-up rate this field opened with, if there was one. */
  auto: string | null
  label: string
  autoLine: string
  changeLabel: string
  testId: string
}) {
  const [open, setOpen] = useState(false)
  const showing = open || auto === null || value !== auto
  if (showing) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <NumberField
          value={value}
          onChange={onChange}
          ariaLabel={label}
          inputClassName="h-11 w-full"
          testId={testId}
        />
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm" data-testid={`${testId}-auto`}>
        {autoLine}
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
        data-testid={`${testId}-change`}
      >
        {changeLabel}
      </button>
    </div>
  )
}

const bigMax = (a: bigint, b: bigint): bigint => (a > b ? a : b)
const bigMin = (a: bigint, b: bigint): bigint => (a < b ? a : b)
