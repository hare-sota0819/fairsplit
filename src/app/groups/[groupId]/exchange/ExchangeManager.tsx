'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'
import { Money } from '@/components/Money'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, SELECT_FIELD } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  formatMinor,
  minorToDecimalInput,
  parseAmountToMinor,
} from '@/lib/format'
import {
  convertAtDisplayRate,
  quoteUnitFor,
  storageRateToDisplay,
} from '@/lib/rate-units'
import { rateToDecimalString } from '@/lib/settlement'
import {
  deleteExchangeRecord,
  deleteWallet,
  deleteWalletAdjustment,
  saveWallet,
  saveWalletAdjustment,
  type AdjustmentView,
  type ExchangeFormState,
  type TopUpView,
  type WalletView,
} from './actions'
import { TopUpWizard, type TopUpEdit } from './TopUpWizard'

export type { AdjustmentView, TopUpView, WalletView }

const WALLET_TYPES = ['CASH', 'TRAVEL_CARD', 'OTHER_PREPAID'] as const

const SELECT_CLASS = SELECT_FIELD

/** Fill placeholders of pre-translated templates. */
const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')

/**
 * A wallet's average cost, in display units — sum(paid)/sum(received) over
 * its top-ups, with one top-up excluded (the one being edited) and one
 * pending set of inputs added (the live preview while typing a new one).
 * Same formula the engine uses (rateToDecimalString), just fed the client's
 * in-progress numbers instead of the saved records.
 */
function walletAvgDisplay(
  wallet: WalletView,
  settlementCurrency: string,
  excludeId?: string,
  pending?: { paidMinor: bigint; receivedMinor: bigint },
): string | null {
  let totalPaid = 0n
  let totalReceived = 0n
  for (const topUp of wallet.topUps) {
    if (topUp.id === excludeId) continue
    totalPaid += parseAmountToMinor(topUp.paid, settlementCurrency) ?? 0n
    totalReceived += parseAmountToMinor(topUp.received, wallet.currency) ?? 0n
  }
  if (pending && pending.paidMinor > 0n && pending.receivedMinor > 0n) {
    totalPaid += pending.paidMinor
    totalReceived += pending.receivedMinor
  }
  if (totalReceived <= 0n) {
    return null
  }
  return storageRateToDisplay(
    rateToDecimalString(
      { numerator: totalPaid, denominator: totalReceived },
      settlementCurrency,
      wallet.currency,
      8,
    ),
    wallet.currency,
  )
}

function DeleteTopUpButton({
  groupId,
  topUp,
  walletLabel,
  onDeleted,
}: {
  groupId: string
  topUp: TopUpView
  walletLabel: string
  onDeleted: (wallets: WalletView[]) => void
}) {
  const t = useTranslations('exchange')
  const tCommon = useTranslations('common')
  const [confirming, setConfirming] = useState(false)
  const [, formAction, pending] = useActionState<ExchangeFormState, FormData>(
    async (prev, formData) => {
      const result = await deleteExchangeRecord(prev, formData)
      if (result.wallets) onDeleted(result.wallets)
      return result
    },
    {},
  )
  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        data-testid="exchange-delete-start"
      >
        {t('delete')}
      </Button>
    )
  }
  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="recordId" value={topUp.id} />
      <p className="text-xs text-muted-foreground">
        {fill(t('deleteConfirm'), { label: walletLabel })}
      </p>
      <div className="flex gap-2">
        <SubmitButton
          pending={pending}
          variant="destructive"
          size="sm"
          testId="exchange-delete"
          data-fixed-rule=""
        >
          {tCommon('confirm')}
        </SubmitButton>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
        >
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  )
}

function RemoveAdjustmentButton({
  groupId,
  adjustment,
  onRemoved,
}: {
  groupId: string
  adjustment: AdjustmentView
  onRemoved: (wallets: WalletView[]) => void
}) {
  const t = useTranslations('wallet')
  const tCommon = useTranslations('common')
  const [confirming, setConfirming] = useState(false)
  const [, formAction, pending] = useActionState<ExchangeFormState, FormData>(
    async (prev, formData) => {
      const result = await deleteWalletAdjustment(prev, formData)
      if (result.wallets) onRemoved(result.wallets)
      return result
    },
    {},
  )
  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        data-testid="wallet-adjustment-remove-start"
      >
        {t('adjustmentRemove')}
      </Button>
    )
  }
  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="expenseId" value={adjustment.id} />
      <p className="text-xs text-muted-foreground">
        {t('adjustmentRemoveConfirm')}
      </p>
      <div className="flex gap-2">
        <SubmitButton
          pending={pending}
          variant="destructive"
          size="sm"
          testId="wallet-adjustment-remove"
          data-fixed-rule=""
        >
          {tCommon('confirm')}
        </SubmitButton>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
        >
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  )
}

/**
 * "How much is really on it?" — reconciling a wallet against reality.
 *
 * THE NUMBER TYPED IN DECIDES WHICH QUESTION COMES NEXT, and that is the
 * whole point of the screen. A prepaid wallet only gains money one way, so
 * MORE than expected can only be a top-up that was never logged, and the
 * form then asks the one thing that top-up needs: what it cost. LESS than
 * expected is spending that was never logged, and needs nothing further.
 *
 * The previous version recorded both directions as spending, so an
 * overdrawn card — which by definition means "you topped up and did not log
 * it", as the app's own warning said — was balanced by inventing negative
 * spending, throwing away the exchange rate every settlement figure from
 * that wallet depends on. Typing a number produced no question and no
 * consequence anyone could follow.
 */
function CountForm({
  groupId,
  wallet,
  settlementCurrency,
  onAdjusted,
}: {
  groupId: string
  wallet: WalletView
  settlementCurrency: string
  onAdjusted: (wallets: WalletView[]) => void
}) {
  const t = useTranslations('wallet')
  const tCommon = useTranslations('common')
  const [open, setOpen] = useState(false)
  const [counted, setCounted] = useState(wallet.countedDefault)
  const [rate, setRate] = useState('')
  /** Null while the computed cost stands; a string once the user overrides. */
  const [paidOverride, setPaidOverride] = useState<string | null>(null)
  const [state, formAction, pending] = useActionState<
    ExchangeFormState,
    FormData
  >(async (prev, formData) => {
    const result = await saveWalletAdjustment(prev, formData)
    if (result.wallets) {
      onAdjusted(result.wallets)
      setRate('')
      setPaidOverride(null)
    }
    return result
  }, {})

  // The pre-fill has to follow the balance, which moves whenever a top-up or
  // a correction is saved — a stale default would silently record the
  // difference against a number the wallet no longer shows.
  const [seenDefault, setSeenDefault] = useState(wallet.countedDefault)
  if (seenDefault !== wallet.countedDefault) {
    setSeenDefault(wallet.countedDefault)
    setCounted(wallet.countedDefault)
  }

  const countedMinor = parseAmountToMinor(counted, wallet.currency)
  const computedMinor = BigInt(wallet.computedRemainingMinor)
  // Positive: more money than the records explain, i.e. a missing top-up.
  const surplus =
    countedMinor === null || countedMinor < 0n
      ? null
      : countedMinor - computedMinor
  const quoteUnit = quoteUnitFor(wallet.currency)
  const unitLabel = quoteUnit === 1 ? '' : quoteUnit.toLocaleString('en')
  const computedPaid =
    surplus !== null && surplus > 0n
      ? convertAtDisplayRate(surplus, rate, wallet.currency, settlementCurrency)
      : null
  const paid =
    paidOverride ??
    (computedPaid === null
      ? ''
      : minorToDecimalInput(computedPaid, settlementCurrency))

  const label = t('adjustBalance')
  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => setOpen(true)}
        data-testid="wallet-count-start"
      >
        {label}
      </Button>
    )
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="walletId" value={wallet.id} />
      <h3 className="text-sm font-semibold">{label}</h3>
      <p className="text-xs text-muted-foreground">{t('adjustExplainer')}</p>
      <dl className="grid grid-cols-2 gap-y-1 text-xs text-muted-foreground [&_dd]:tabular-nums">
        <dt>{t('loadedTotal')}</dt>
        <dd className="text-right">{wallet.loadedDisplay}</dd>
        <dt>{t('spentTotal')}</dt>
        <dd className="text-right">{wallet.spentDisplay}</dd>
        <dt>{t('adjustments')}</dt>
        <dd className="text-right">{wallet.adjustmentsDisplay}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">{t('countHelp')}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`counted-${wallet.id}`} className="text-xs">
          {t('counted', { currency: wallet.currency })}
        </Label>
        <Input
          id={`counted-${wallet.id}`}
          inputMode="decimal"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
          name="counted"
          required
          className="h-11"
          data-testid="wallet-counted"
        />
      </div>

      {/* What the app concluded, in words, before anything is saved. */}
      {surplus === null || surplus === 0n ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="count-verdict"
        >
          {t('countNothing')}
        </p>
      ) : surplus < 0n ? (
        <p className="text-xs text-notice" data-testid="count-verdict">
          {t('countShortfall', {
            amount: formatMinor(-surplus, wallet.currency),
          })}
        </p>
      ) : (
        <>
          <p className="text-xs text-notice" data-testid="count-verdict">
            {t('countSurplus', {
              amount: formatMinor(surplus, wallet.currency),
            })}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`count-rate-${wallet.id}`} className="text-xs">
              {t('countRateLabel', {
                unit: unitLabel,
                currency: wallet.currency,
                settlement: settlementCurrency,
              })}
            </Label>
            <Input
              id={`count-rate-${wallet.id}`}
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="h-11"
              data-testid="count-rate"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`count-paid-${wallet.id}`} className="text-xs">
              {t('countPaidLabel', { settlement: settlementCurrency })}
            </Label>
            <Input
              id={`count-paid-${wallet.id}`}
              inputMode="decimal"
              value={paid}
              onChange={(e) => setPaidOverride(e.target.value)}
              name="paid"
              className="h-11"
              data-testid="count-paid"
            />
          </div>
        </>
      )}

      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p className="text-xs text-positive">{t('adjusted')}</p>
      ) : null}
      <div className="flex gap-2">
        <SubmitButton
          pending={pending}
          variant="outline"
          testId="wallet-adjust"
        >
          {t('saveAdjustment')}
        </SubmitButton>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  )
}

function WalletCardItem({
  groupId,
  wallet,
  settlementCurrency,
  pendingPreview,
  onWalletsUpdated,
  onEditTopUp,
}: {
  groupId: string
  wallet: WalletView
  settlementCurrency: string
  /** Set only while this wallet is the one selected in the top-up form. */
  pendingPreview?: {
    excludeId?: string
    paidMinor: bigint
    receivedMinor: bigint
  }
  onWalletsUpdated: (wallets: WalletView[]) => void
  onEditTopUp: (wallet: WalletView, topUp: TopUpView) => void
}) {
  const t = useTranslations('exchange')
  const tWallet = useTranslations('wallet')
  const tCommon = useTranslations('common')
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(wallet.label)
  const [deleteConfirming, setDeleteConfirming] = useState(false)

  const [, renameAction, renamePending] = useActionState<
    ExchangeFormState,
    FormData
  >(async (prev, formData) => {
    const result = await saveWallet(prev, formData)
    if (result.wallets) {
      onWalletsUpdated(result.wallets)
      setRenaming(false)
    }
    return result
  }, {})

  const [deleteState, deleteAction, deletePending] = useActionState<
    ExchangeFormState,
    FormData
  >(async (prev, formData) => {
    const result = await deleteWallet(prev, formData)
    if (result.wallets) onWalletsUpdated(result.wallets)
    return result
  }, {})

  const avg = walletAvgDisplay(
    wallet,
    settlementCurrency,
    pendingPreview?.excludeId,
    pendingPreview,
  )
  const unit = quoteUnitFor(wallet.currency)
  const unitLabel = unit === 1 ? '' : unit.toLocaleString('en')

  return (
    <Card data-testid="wallet-card">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          {renaming ? (
            <form
              action={renameAction}
              className="flex flex-1 items-center gap-2"
            >
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="walletId" value={wallet.id} />
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                name="label"
                required
                className="h-9 flex-1"
                data-testid="wallet-rename-input"
              />
              <SubmitButton
                pending={renamePending}
                size="sm"
                testId="wallet-rename-save"
              >
                {tWallet('renameSave')}
              </SubmitButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRenaming(false)
                  setLabel(wallet.label)
                }}
              >
                {tCommon('cancel')}
              </Button>
            </form>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="font-semibold">{wallet.label}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">
                    {tWallet(`type.${wallet.type}`)}
                  </Badge>
                  {wallet.currency}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRenaming(true)}
                data-testid="wallet-rename"
              >
                {tWallet('rename')}
              </Button>
            </>
          )}
        </div>

        <span data-testid={`wallet-remaining-${wallet.id}`}>
          <Money size="lg">
            {wallet.overdrawn
              ? tWallet('overdrawn', { amount: wallet.remainingAmount })
              : tWallet('remaining', { amount: wallet.remainingAmount })}
          </Money>
        </span>
        <p className="text-xs text-muted-foreground">
          {avg
            ? t('avgRate', {
                unit: unitLabel,
                currency: wallet.currency,
                rate: avg,
                settlement: settlementCurrency,
              })
            : tWallet('noTopUps')}
        </p>

        {wallet.topUps.length > 0 ? (
          <ul className="-mx-4 divide-y divide-border text-sm">
            {wallet.topUps.map((topUp) => (
              <li
                key={topUp.id}
                className="flex items-center justify-between gap-2 px-4 py-2"
                data-testid="exchange-record-row"
              >
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">
                    {topUp.date}
                  </span>
                  <Money>
                    {topUp.paidDisplay} → {topUp.receivedDisplay}
                  </Money>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onEditTopUp(wallet, topUp)}
                    data-testid="exchange-edit"
                  >
                    {t('edit')}
                  </Button>
                  <DeleteTopUpButton
                    groupId={groupId}
                    topUp={topUp}
                    walletLabel={wallet.label}
                    onDeleted={onWalletsUpdated}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {wallet.overdrawn ? (
          <p
            className="text-xs text-notice"
            data-testid="wallet-overdrawn-hint"
          >
            {tWallet('overdrawnHint')}
          </p>
        ) : null}

        {wallet.adjustments.length > 0 ? (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">
              {tWallet('adjustmentsTitle')}
            </h3>
            <ul className="-mx-4 divide-y divide-border text-sm">
              {wallet.adjustments.map((adjustment) => (
                <li
                  key={adjustment.id}
                  className="flex items-center justify-between gap-2 px-4 py-2"
                  data-testid="wallet-adjustment-row"
                >
                  <span className="min-w-0">
                    <span className="block text-xs text-muted-foreground">
                      {adjustment.date}
                    </span>
                    <Money>{adjustment.amountDisplay}</Money>
                  </span>
                  <RemoveAdjustmentButton
                    groupId={groupId}
                    adjustment={adjustment}
                    onRemoved={onWalletsUpdated}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <CountForm
          groupId={groupId}
          wallet={wallet}
          settlementCurrency={settlementCurrency}
          onAdjusted={onWalletsUpdated}
        />

        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          {deleteConfirming ? (
            <>
              <p className="text-xs text-muted-foreground">
                {fill(tWallet('deleteConfirm'), { label: wallet.label })}
              </p>
              <form action={deleteAction} className="flex items-center gap-2">
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="walletId" value={wallet.id} />
                <SubmitButton
                  pending={deletePending}
                  variant="destructive"
                  size="sm"
                  testId="wallet-delete-confirm"
                  data-fixed-rule=""
                >
                  {tCommon('confirm')}
                </SubmitButton>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirming(false)}
                >
                  {tCommon('cancel')}
                </Button>
              </form>
              {deleteState.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {deleteState.error}
                </p>
              ) : null}
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit text-destructive"
              onClick={() => setDeleteConfirming(true)}
              data-testid="wallet-delete"
            >
              {tWallet('delete')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function WalletCreateForm({
  groupId,
  currencies,
  newWalletCurrency,
  onCreated,
}: {
  groupId: string
  currencies: readonly string[]
  /** Preselects the currency select, e.g. arriving from the trip-currency prompt. */
  newWalletCurrency?: string
  onCreated: (wallets: WalletView[]) => void
}) {
  const t = useTranslations('wallet')
  const [label, setLabel] = useState('')
  const [state, formAction, pending] = useActionState<
    ExchangeFormState,
    FormData
  >(async (prev, formData) => {
    const result = await saveWallet(prev, formData)
    if (result.wallets) {
      onCreated(result.wallets)
      setLabel('')
    }
    return result
  }, {})

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="groupId" value={groupId} />
          <h2 className="text-sm font-semibold">{t('add')}</h2>
          <div className="flex flex-col gap-1.5 text-sm">
            <Label htmlFor="wallet-label">{t('label')}</Label>
            <Input
              id="wallet-label"
              name="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('labelPlaceholder')}
              required
              className="h-11"
              data-testid="wallet-create-label"
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <Label htmlFor="wallet-type">{t('kind')}</Label>
            <select
              id="wallet-type"
              name="type"
              defaultValue="CASH"
              className={SELECT_CLASS}
              data-testid="wallet-create-type"
            >
              {WALLET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`type.${type}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <Label htmlFor="wallet-currency">{t('currency')}</Label>
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
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          <SubmitButton pending={pending} testId="wallet-create-save">
            {t('create')}
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * The wallet screen: record an exchange, then look at what you have.
 *
 * It used to show all three things at once — a top-up form, every wallet with
 * its history, and a create-a-wallet form, stacked down one page. The owner's
 * report was that it "all comes out in a row" and should ask step by step the
 * way the expense wizard does, so the top-up became `TopUpWizard` and the
 * wallets moved behind it: you land on the question, and the list is what you
 * get once the question is answered (or by asking for it).
 */
export function ExchangeManager({
  groupId,
  settlementCurrency,
  currencies,
  wallets: initialWallets,
  today,
  initialWalletId,
  newWalletCurrency,
  returnTo,
  latestCheckpointIso,
}: {
  groupId: string
  settlementCurrency: string
  currencies: readonly string[]
  wallets: WalletView[]
  today: string
  /** Pre-scopes the wizard, e.g. arriving from the expense wizard. */
  initialWalletId?: string
  /** Preselects the new-wallet currency, e.g. from the trip-currency prompt. */
  newWalletCurrency?: string
  /** Set when the user detoured here mid-expense; offers the way back. */
  returnTo?: string
  /** The newest checkpoint's instant, or null when nothing is settled yet. */
  latestCheckpointIso: string | null
}) {
  const t = useTranslations('exchange')
  const tWallet = useTranslations('wallet')
  const router = useRouter()
  // The list is seeded by the server and then maintained from what each
  // write returns: a server action does not re-render its own route.
  const [wallets, setWallets] = useState(initialWallets)
  const [view, setView] = useState<'wizard' | 'wallets'>('wizard')
  const [editing, setEditing] = useState<TopUpEdit | undefined>(undefined)
  // Bumped on each ENTRY into the wizard, and on nothing else. Keying the
  // remount off the wallet list instead threw the flow back to step 1 the
  // moment a wallet was created inside it — which is exactly when it must
  // not, because creating one is how you get to step 2.
  const [run, setRun] = useState(0)

  const applyWallets = (fresh: WalletView[]) => {
    setWallets(fresh)
    router.refresh()
  }

  const afterSave = (fresh: WalletView[]) => {
    setWallets(fresh)
    setEditing(undefined)
    setRun((n) => n + 1)
    // Everything else that reads these wallets (home card, status).
    router.refresh()
    if (returnTo) {
      router.push(returnTo)
      return
    }
    setView('wallets')
  }

  if (view === 'wizard') {
    return (
      <TopUpWizard
        // Remounting on each entry is deliberate: a wizard that reopens
        // holding the last exchange's half-typed rate is worse than one that
        // starts clean, and the saved record is already in the list below.
        key={editing ? `edit-${editing.topUp.id}` : `new-${run}`}
        groupId={groupId}
        settlementCurrency={settlementCurrency}
        currencies={currencies}
        wallets={wallets}
        today={today}
        initialWalletId={initialWalletId}
        newWalletCurrency={newWalletCurrency}
        latestCheckpointIso={latestCheckpointIso}
        editing={editing}
        onWallets={applyWallets}
        onSaved={afterSave}
        onCancelEdit={() => {
          setEditing(undefined)
          setView('wallets')
        }}
        onShowWallets={() => {
          setEditing(undefined)
          setView('wallets')
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="touch"
          className="w-full"
          onClick={() => {
            setEditing(undefined)
            setRun((n) => n + 1)
            setView('wizard')
          }}
          data-testid="topup-again"
        >
          {t('topUpAgain')}
        </Button>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {tWallet('title')}
        </h2>
        {wallets.length === 0 ? (
          <p
            className="px-4 py-10 text-center text-sm text-muted-foreground"
            data-testid="wallet-empty"
          >
            {tWallet('none')}
          </p>
        ) : (
          wallets.map((wallet) => (
            <WalletCardItem
              key={wallet.id}
              groupId={groupId}
              wallet={wallet}
              settlementCurrency={settlementCurrency}
              onWalletsUpdated={applyWallets}
              onEditTopUp={(owner, topUp) => {
                setEditing({ walletId: owner.id, topUp })
                setView('wizard')
              }}
            />
          ))
        )}
      </section>

      <WalletCreateForm
        groupId={groupId}
        currencies={currencies}
        newWalletCurrency={newWalletCurrency}
        onCreated={applyWallets}
      />
    </div>
  )
}
