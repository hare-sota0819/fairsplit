'use client'

import { useTranslations } from 'next-intl'
import { useActionState, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Landmark, Plus, Wallet } from 'lucide-react'
import { SubmitButton } from '@/components/SubmitButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toLocalInputValue } from '@/lib/datetime'
import { minorToDecimalInput, parseAmountToMinor } from '@/lib/format'
import { convertAtDisplayRate, quoteUnitFor } from '@/lib/rate-units'
import {
  saveExchangeRecord,
  saveWallet,
  type ExchangeFormState,
  type TopUpView,
  type WalletView,
} from './actions'

const SELECT_CLASS =
  'h-11 rounded-lg border border-input bg-transparent px-3 text-base outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const KIND_ICON = {
  CASH: Landmark,
  TRAVEL_CARD: Wallet,
  OTHER_PREPAID: Wallet,
} as const

const WALLET_TYPES = ['CASH', 'TRAVEL_CARD', 'OTHER_PREPAID'] as const

const STEP_KEYS = ['wallet', 'rate', 'amount', 'review'] as const

/** One tappable wallet, the same skin the expense wizard uses for a choice. */
const CHOICE_CLASS = (selected: boolean): string =>
  `flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition-[background-color,color,border-color,transform] duration-fast ease-swift active:scale-[0.97] ${
    selected
      ? 'border-primary bg-primary/8 ring-1 ring-primary'
      : 'border-border hover:bg-muted/60'
  }`

/** What the wizard is editing: a new top-up, or one already recorded. */
export interface TopUpEdit {
  walletId: string
  topUp: TopUpView
}

/**
 * Recording an exchange, one question at a time.
 *
 * The screen this replaces put everything on one page — a top-up form, every
 * wallet with its history, and a create-a-wallet form — and the owner's report
 * was that it "all comes out in a row" and should ask step by step like the
 * expense wizard does. The two labels that provoked it, "received" and "paid",
 * were the same problem in miniature: two bare amounts with no question above
 * them.
 *
 * Order is forced by arithmetic, not preference: a rate cannot be stated
 * ("100 ??? = ___ KRW") until the wallet says which currency, so the wallet
 * comes first even though the owner listed the rate first.
 */
export function TopUpWizard({
  groupId,
  settlementCurrency,
  currencies,
  wallets,
  today,
  initialWalletId,
  newWalletCurrency,
  editing,
  onWallets,
  onSaved,
  onCancelEdit,
  onShowWallets,
}: {
  groupId: string
  settlementCurrency: string
  currencies: readonly string[]
  wallets: WalletView[]
  /** Server "today" as a date-input value; the device corrects it on mount. */
  today: string
  initialWalletId?: string
  newWalletCurrency?: string
  /** Set when an existing record is being corrected rather than added. */
  editing?: TopUpEdit
  onWallets: (wallets: WalletView[]) => void
  onSaved: (wallets: WalletView[]) => void
  onCancelEdit: () => void
  /** Leave without recording anything — the list is the other half of this
      screen, and arriving here to look rather than to log is ordinary. */
  onShowWallets: () => void
}) {
  const t = useTranslations('exchange')
  const tWallet = useTranslations('wallet')
  const tCommon = useTranslations('common')

  const [step, setStep] = useState(editing ? 1 : 0)
  const [walletId, setWalletId] = useState(
    editing?.walletId ??
      (initialWalletId && wallets.some((w) => w.id === initialWalletId)
        ? initialWalletId
        : (wallets[0]?.id ?? '')),
  )
  const [creating, setCreating] = useState(wallets.length === 0)
  const [rate, setRate] = useState('')
  const [received, setReceived] = useState(editing?.topUp.received ?? '')
  // Null while the rate's answer stands; a string once the user types over it.
  const [paidOverride, setPaidOverride] = useState<string | null>(
    editing?.topUp.paid ?? null,
  )
  // "Today" is the DEVICE's today, not the server's. The input is
  // uncontrolled so the SSR value can be rewritten on mount without a
  // hydration mismatch; the step's Next button lifts whatever it holds into
  // state, which is what the review step then submits.
  const [date, setDate] = useState(editing?.topUp.date ?? today)
  const dateRef = useRef<HTMLInputElement | null>(null)
  const localised = useRef(editing !== undefined)
  const attachDate = (node: HTMLInputElement | null) => {
    dateRef.current = node
    if (node && !localised.current) {
      localised.current = true
      node.value = toLocalInputValue(
        new Date(),
        new Date().getTimezoneOffset(),
      ).slice(0, 10)
    }
  }

  const wallet = wallets.find((w) => w.id === walletId) ?? null
  const currency = wallet?.currency ?? ''
  const quoteUnit = currency ? quoteUnitFor(currency) : 1
  const unit = quoteUnit === 1 ? '' : quoteUnit.toLocaleString('en')

  const receivedMinor = currency
    ? parseAmountToMinor(received, currency)
    : null
  const computedPaid =
    currency && receivedMinor !== null && receivedMinor > 0n
      ? convertAtDisplayRate(receivedMinor, rate, currency, settlementCurrency)
      : null
  const paid =
    paidOverride ??
    (computedPaid === null
      ? ''
      : minorToDecimalInput(computedPaid, settlementCurrency))

  const [state, formAction, pending] = useActionState<
    ExchangeFormState,
    FormData
  >(async (prev, formData) => {
    const result = await saveExchangeRecord(prev, formData)
    if (result.wallets) onSaved(result.wallets)
    return result
  }, {})

  const [createState, createAction, creatingPending] = useActionState<
    ExchangeFormState,
    FormData
  >(async (prev, formData) => {
    const result = await saveWallet(prev, formData)
    if (result.wallets) {
      onWallets(result.wallets)
      // The wallet the user just made is the one they came here to fill.
      const fresh = result.wallets.find(
        (w) => !wallets.some((old) => old.id === w.id),
      )
      if (fresh) setWalletId(fresh.id)
      setCreating(false)
      setStep(1)
    }
    return result
  }, {})

  /** Whether the current step has enough to move on. */
  const blocked =
    (step === 0 && wallet === null) ||
    (step === 2 && (receivedMinor === null || receivedMinor <= 0n))

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('steps.review')} className="flex flex-col gap-2">
        <ol className="flex gap-1.5">
          {STEP_KEYS.map((key, index) => (
            <li key={key} className="flex-1">
              <button
                type="button"
                disabled={index > step}
                onClick={() => index <= step && setStep(index)}
                aria-current={index === step ? 'step' : undefined}
                aria-label={t(`steps.${key}`)}
                data-testid={`topup-step-${key}`}
                className={`h-1.5 w-full rounded-full transition-colors ${
                  index <= step ? 'bg-primary' : 'bg-border'
                }`}
              />
            </li>
          ))}
        </ol>
        <p
          className="text-xs font-medium text-muted-foreground"
          data-testid="topup-step-label"
        >
          {t('stepOf', {
            current: step + 1,
            total: STEP_KEYS.length,
            title: t(`steps.${STEP_KEYS[step]}`),
          })}
        </p>
      </nav>

      {step === 0 ? (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{t('walletQuestion')}</legend>
          {wallets.map((option) => {
            const Icon = KIND_ICON[option.type]
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setWalletId(option.id)
                  setCreating(false)
                }}
                className={CHOICE_CLASS(!creating && option.id === walletId)}
                data-testid={`topup-wallet-${option.id}`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {option.label}
                  <span className="text-xs font-normal text-muted-foreground">
                    {tWallet(`type.${option.type}`)}
                  </span>
                </span>
                <span
                  className={`text-xs ${option.overdrawn ? 'text-negative' : 'text-muted-foreground'}`}
                >
                  {option.overdrawn
                    ? tWallet('overdrawn', { amount: option.remainingAmount })
                    : tWallet('remaining', { amount: option.remainingAmount })}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={CHOICE_CLASS(creating)}
            data-testid="topup-new-wallet"
          >
            <span className="flex items-center gap-2 font-medium">
              <Plus aria-hidden="true" className="size-4 shrink-0" />
              {tWallet('add')}
            </span>
          </button>

          {creating ? (
            // Its own form, not nested in the top-up one: a wallet is created
            // the moment it is named, so the next step has a currency to
            // anchor its rate to.
            <form action={createAction} className="flex flex-col gap-3 pt-2">
              <input type="hidden" name="groupId" value={groupId} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wallet-label">{tWallet('label')}</Label>
                <Input
                  id="wallet-label"
                  name="label"
                  placeholder={tWallet('labelPlaceholder')}
                  required
                  className="h-11"
                  data-testid="wallet-create-label"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wallet-type">{tWallet('kind')}</Label>
                <select
                  id="wallet-type"
                  name="type"
                  defaultValue="CASH"
                  className={SELECT_CLASS}
                  data-testid="wallet-create-type"
                >
                  {WALLET_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {tWallet(`type.${type}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wallet-currency">{tWallet('currency')}</Label>
                <select
                  id="wallet-currency"
                  name="currency"
                  defaultValue={newWalletCurrency ?? currencies[0]}
                  className={SELECT_CLASS}
                  data-testid="wallet-create-currency"
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              {createState.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {createState.error}
                </p>
              ) : null}
              <SubmitButton
                pending={creatingPending}
                testId="wallet-create-save"
              >
                {tWallet('create')}
              </SubmitButton>
            </form>
          ) : null}
        </fieldset>
      ) : null}

      {step === 1 ? (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{t('rateQuestion')}</legend>
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 font-semibold"
              data-testid="exchange-rate-anchor"
            >
              {unit} {currency} =
            </span>
            <Input
              inputMode="decimal"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value)
                setPaidOverride(null)
              }}
              className="h-11 w-32 tabular-nums"
              aria-label={`${unit} ${currency} = ? ${settlementCurrency}`}
              data-testid="exchange-rate"
            />
            <span className="shrink-0 font-semibold">
              {settlementCurrency}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t('rateHint')}</p>
        </fieldset>
      ) : null}

      {step === 2 ? (
        <fieldset className="flex flex-col gap-4 text-sm">
          <legend className="mb-1 font-medium">{t('amountQuestion')}</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exchange-received">
              {t('amountReceived', { currency })}
            </Label>
            <Input
              id="exchange-received"
              inputMode="decimal"
              value={received}
              onChange={(e) => {
                setReceived(e.target.value)
                setPaidOverride(null)
              }}
              required
              className="h-13 text-xl font-semibold tabular-nums"
              data-testid="exchange-received"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exchange-paid">
              {t('amountPaid', { currency: settlementCurrency })}
            </Label>
            <Input
              id="exchange-paid"
              inputMode="decimal"
              value={paid}
              onChange={(e) => setPaidOverride(e.target.value)}
              required
              className="h-11 tabular-nums"
              data-testid="exchange-paid"
            />
            <span className="text-xs text-muted-foreground">
              {t('paidComputed')}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exchange-date">{t('date')}</Label>
            <Input
              id="exchange-date"
              type="date"
              defaultValue={date}
              ref={attachDate}
              required
              className="h-11"
            />
          </div>
        </fieldset>
      ) : null}

      {step === 3 ? (
        <form action={formAction} className="flex flex-col gap-4 text-sm">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="recordId" value={editing?.topUp.id ?? ''} />
          <input type="hidden" name="walletId" value={walletId} />
          <input type="hidden" name="amountReceived" value={received} />
          <input type="hidden" name="amountPaid" value={paid} />
          <input type="hidden" name="timestamp" value={date} />

          <div
            className="flex flex-col gap-1 rounded-xl border border-border px-4 py-3"
            data-testid="topup-summary"
          >
            <span className="font-medium">
              {t('reviewLine', {
                label: wallet?.label ?? '',
                amount: `${received} ${currency}`,
              })}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('reviewCost', {
                paid: `${paid} ${settlementCurrency}`,
                unit,
                currency,
                rate:
                  rate ||
                  (receivedMinor && receivedMinor > 0n ? t('rateFromAmounts') : '—'),
                settlement: settlementCurrency,
              })}
            </span>
            <span className="text-xs text-muted-foreground">{date}</span>
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="hero"
              onClick={() => setStep(2)}
              className="flex-1 gap-1"
              data-testid="topup-back"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              {tCommon('back')}
            </Button>
            <SubmitButton
              pending={pending}
              busyLabel={t('saving')}
              size="hero"
              className="flex-[2]"
              testId="exchange-save"
            >
              {editing ? t('update') : t('save')}
            </SubmitButton>
          </div>
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={onCancelEdit}
            >
              {t('cancelEdit')}
            </Button>
          ) : null}
        </form>
      ) : (
        <div className="flex gap-2">
          {step > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="hero"
              onClick={() => setStep(step - 1)}
              className="flex-1 gap-1"
              data-testid="topup-back"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              {tCommon('back')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="hero"
            disabled={blocked}
            onClick={() => {
              if (step === 2 && dateRef.current) setDate(dateRef.current.value)
              setStep(step + 1)
            }}
            className="flex-[2] gap-1"
            data-testid="topup-next"
          >
            {tCommon('next')}
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={onShowWallets}
        className="w-fit text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
        data-testid="show-wallets"
      >
        {t('showWallets')}
      </button>
    </div>
  )
}
