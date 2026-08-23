import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BankChargedForm } from './BankChargedForm'
import { CancelExpenseForm } from './CancelExpenseForm'
import { KeepAsWalletOffer } from './KeepAsWalletOffer'
import { ClearDraft } from '../ClearDraft'
import { dismissExchangePrompt } from '../../exchange/actions'
import { BackLink } from '@/components/BackLink'
import { LocalTime } from '@/components/LocalTime'
import { NavLink } from '@/components/NavLoader'
import { RateChip } from '@/components/RateChip'
import { proposeExpenseCancel } from '../../changes/actions'
import { RequestCancelForm } from '../../changes/RequestCancelForm'
import { isFrozenExpense } from '@/lib/checkpoint-freeze'
import { rateChipCopy } from '@/lib/rate-chip'
import { SubmitButton } from '@/components/SubmitButton'
import { Money } from '@/components/Money'
import { ChevronDown } from 'lucide-react'
import { draftKey } from '@/lib/expense-draft'
import { formatMinor, minorToDecimalInput } from '@/lib/format'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { toEngineExpense } from '@/lib/engine-map'
import { quoteUnitFor, storageRateToDisplay } from '@/lib/rate-units'
import {
  consumedShares,
  convertExpense,
  explainShares,
  lineTotal,
  resolveRate,
  roundDivHalfEven,
  rateToDecimalString,
  type Ratio,
} from '@/lib/settlement'

/** Ratio -> minor units, DISPLAY ONLY (the settlement figure is consumedShares). */
const ratioToMinor = (r: Ratio): bigint => roundDivHalfEven(r.num, r.den)

export default async function ExpenseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; expenseId: string }>
  searchParams: Promise<{ created?: string; saved?: string }>
}) {
  const { groupId, expenseId } = await params
  const { created, saved } = await searchParams
  const { member: me } = await requireGroupMember(groupId)
  const { group, members, expenses, wallets, context, mode } =
    await loadGroupData(groupId)
  const expense = expenses.find((e) => e.id === expenseId)
  if (!expense) {
    notFound()
  }
  const nameOf = (id: string): string =>
    members.find((m) => m.id === id)?.name ?? '?'
  const [t, tForm, tChip, tExchange, tLoading, tCommon, tExpenses] =
    await Promise.all([
      getTranslations('expenses.detail'),
      getTranslations('expenses.form'),
      getTranslations('rateChip'),
      getTranslations('exchange'),
      getTranslations('loading'),
      getTranslations('common'),
      getTranslations('expenses'),
    ])

  const cancelled = expense.cancelledAt !== null
  const frozen = isFrozenExpense(expense)
  const engineExpense = toEngineExpense(expense)
  const converted = convertExpense(engineExpense, mode, context)
  const showConversion =
    expense.currency !== group.settlementCurrency ||
    converted.source === 'ACTUAL_CHARGED'
  // Label and explanation both come from `rateChipCopy`, which is also what
  // the feed rows use — a frozen conversion has to read the same in both
  // places, and it names the rate that applied inside the explanation.
  const chip = rateChipCopy(converted, tChip)
  const chipLabel = chip.label

  // One-time onboarding: right after creating an expense, nudge members who
  // never logged an exchange (Skip sets the flag forever).
  const showPrompt =
    created === '1' &&
    me.exchangePromptDismissedAt === null &&
    (await prisma.exchangeRecord.count({ where: { memberId: me.id } })) === 0

  // The bank-statement correction only makes sense once: AVG_COST is the
  // mode where a rate matters, the money is foreign, no wallet already
  // fixes its rate, and no own-rate snapshot already prices it (a bank
  // statement cannot reprice money the payer exchanged themselves).
  // It also only makes sense for a receipt paid from ONE place: a bank
  // billed a card, not a card and a pocketful of cash, so there is no single
  // figure to correct once a receipt is split.
  const soleFunding = expense.funding.length === 1 ? expense.funding[0] : null
  const showBankCharged =
    !cancelled &&
    group.rateMode === 'AVG_COST' &&
    expense.currency !== group.settlementCurrency &&
    soleFunding !== null &&
    soleFunding.walletId === null &&
    soleFunding.ownRateSnapshot == null

  // The wallet offer only follows a fresh save of own-rate prepaid money,
  // only to the payer, and only when they don't already have a wallet in
  // that currency (otherwise there is nothing to offer).
  const showKeepAsWallet =
    created === '1' &&
    expense.funding.some((portion) => portion.ownRateSnapshot != null) &&
    expense.payerId === me.id &&
    !wallets.some(
      (wallet) =>
        wallet.memberId === expense.payerId &&
        wallet.currency === expense.currency,
    )

  // Every money figure can be expanded to its derivation: the same
  // per-member shares the balances use (explainShares/consumedShares), so
  // the explanation can never disagree with the number it explains.
  const explanations = explainShares(engineExpense)
  const shares = consumedShares(engineExpense, mode, context)
  const { rate } = resolveRate(engineExpense, mode, context)
  const rateUnit = quoteUnitFor(expense.currency)
  const rateUnitLabel = rateUnit === 1 ? '' : rateUnit.toLocaleString('en')
  const rateDisplay = storageRateToDisplay(
    rateToDecimalString(rate, group.settlementCurrency, expense.currency, 4),
    expense.currency,
  )

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-6">
      <BackLink
        href={`/groups/${groupId}`}
        caption={tLoading('group')}
        label={tCommon('back')}
        testId="back-link"
      />
      {created === '1' ? <ClearDraft storageKey={draftKey(groupId)} /> : null}
      {saved === '1' ? (
        <ClearDraft storageKey={draftKey(groupId, expenseId)} />
      ) : null}

      {showPrompt ? (
        <div
          className="rounded-xl bg-card p-4 text-sm ring-1 ring-border-strong"
          data-testid="exchange-prompt"
        >
          <p>{tExchange('prompt.question')}</p>
          <div className="mt-2 flex items-center gap-3">
            <NavLink
              href={`/groups/${groupId}/exchange`}
              caption={tLoading('exchange')}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-[filter,transform] duration-fast ease-swift hover:brightness-110 active:scale-[0.97]"
            >
              {tExchange('prompt.log')}
            </NavLink>
            <form action={dismissExchangePrompt}>
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="expenseId" value={expenseId} />
              <SubmitButton
                variant="ghost"
                size="sm"
                testId="exchange-prompt-skip"
              >
                {tExchange('prompt.skip')}
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : null}

      {showKeepAsWallet ? (
        <KeepAsWalletOffer groupId={groupId} currency={expense.currency} />
      ) : null}

      {expense.marketRateProvisional ? (
        <div
          className="rounded-xl bg-notice-soft p-4 text-sm text-notice"
          data-testid="provisional-rate-banner"
        >
          {converted.walletLabel
            ? t('provisionalRate', { label: converted.walletLabel })
            : t('provisionalRateNoWallet')}
        </div>
      ) : null}

      {cancelled ? (
        <div
          className="rounded-xl bg-negative-soft p-4 text-sm text-negative"
          data-testid="cancelled-banner"
        >
          {t('cancelledBanner', {
            name: expense.cancelledBy?.name ?? '?',
          })}{' '}
          · <LocalTime iso={expense.cancelledAt!.toISOString()} />
        </div>
      ) : null}

      <h1
        className={`text-xl font-bold ${cancelled ? 'line-through opacity-50' : ''}`}
      >
        {expense.title || t('title')}
      </h1>
      {/* A settled expense offers no edit, no cancel and no bank-statement
          correction: all three move balances behind a checkpoint. The notice
          replaces the button rather than sitting beside a disabled one, so
          there is nothing to press and wonder about. */}
      {frozen ? (
        <div className="flex flex-col gap-3">
          <p
            className="rounded-xl border border-border p-3 text-sm text-muted-foreground"
            data-testid="expense-frozen-notice"
          >
            {tExpenses('frozenNotice')}
          </p>
          {/* The dead end is a ROUTE. Stage 1 made these three refuse; this is
              where the refusal turns into the request flow, which is the whole
              seam between the two halves of the feature. */}
          <NavLink
            href={`/groups/${groupId}/expenses/${expenseId}/edit?propose=1`}
            caption={tLoading('expense')}
            testId="request-edit"
            className="inline-flex h-13 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground transition-[filter,transform] duration-fast ease-swift hover:brightness-110 active:scale-[0.97]"
          >
            {tExpenses('requestChange')}
          </NavLink>
          <RequestCancelForm
            action={proposeExpenseCancel}
            groupId={groupId}
            expenseId={expenseId}
            cancelled={cancelled}
          />
        </div>
      ) : (
        <NavLink
          href={`/groups/${groupId}/expenses/${expenseId}/edit`}
          caption={tLoading('expense')}
          className="inline-flex h-13 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground transition-[filter,transform] duration-fast ease-swift hover:brightness-110 active:scale-[0.97]"
        >
          {t('edit')}
        </NavLink>
      )}

      <span
        className={cancelled ? 'line-through opacity-50' : ''}
        data-testid="expense-amount"
      >
        <Money size="hero">
          {formatMinor(expense.amount, expense.currency)}
        </Money>
      </span>
      {showConversion ? (
        <div className="-mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span data-testid="expense-converted">
            {t('converted', {
              amount: formatMinor(converted.amount, group.settlementCurrency),
            })}
          </span>
          <RateChip label={chip.label} explanation={chip.explanation} />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        <span>{t('payer', { name: nameOf(expense.payerId) })}</span>
        {/* One source states itself in a sentence; several are a list, with
            each portion's own amount, because "how much came from where" is
            the whole question and a count would not answer it. */}
        <span data-testid="expense-method">
          {soleFunding
            ? soleFunding.wallet
              ? t('paidFromWallet', { label: soleFunding.wallet.label })
              : soleFunding.ownRateSnapshot != null
                ? t('paidFromOwnRate')
                : t('paidFromCard')
            : t('paidFromSplit')}
        </span>
        {soleFunding ? null : (
          <ul className="flex flex-col gap-1" data-testid="funding-portions">
            {expense.funding.map((portion) => (
              <li key={portion.id}>
                {t('paidFromPortion', {
                  amount: formatMinor(portion.amount, expense.currency),
                  source: portion.wallet
                    ? portion.wallet.label
                    : portion.ownRateSnapshot != null
                      ? t('portionOwnRate')
                      : t('portionCard'),
                })}
                {/* A portion someone else fronted has to say so: the money is
                    owed back to THEM, and the row is the only place that says
                    which of them. */}
                {portion.funderId && portion.funderId !== expense.payerId
                  ? ` (${t('portionFunder', { name: nameOf(portion.funderId) })})`
                  : ''}
              </li>
            ))}
          </ul>
        )}
        <span>
          <LocalTime iso={expense.timestamp.toISOString()} />
        </span>
        {expense.receiptImagePath ? (
          <a
            href={`/api/receipts/image?path=${encodeURIComponent(expense.receiptImagePath)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit"
            data-testid="receipt-thumbnail"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served
                through a membership-checked redirect to a short-lived signed
                URL, so it is neither a static asset nor optimisable. */}
            <img
              src={`/api/receipts/image?path=${encodeURIComponent(expense.receiptImagePath)}`}
              alt={t('receiptPhoto')}
              className="h-24 w-20 rounded-lg border border-border object-cover"
            />
          </a>
        ) : null}
        {expense.isPersonal ? (
          <span className="w-fit rounded-full bg-muted px-2 py-1 text-xs">
            {t('personalBadge')}
          </span>
        ) : null}
        <span data-testid="entered-by">
          {t('enteredBy', { name: nameOf(expense.enteredById) })}
        </span>
        {expense.updatedById ? (
          <span>{t('updatedBy', { name: nameOf(expense.updatedById) })}</span>
        ) : null}
      </div>

      {expense.items.length > 0 ? (
        <ul
          className="-mx-5 divide-y divide-border text-sm"
          data-testid="receipt"
        >
          {expense.items.map((item) => (
            <li key={item.id} data-testid="receipt-row">
              <details className="group">
                <summary className="flex min-h-14 w-full cursor-pointer list-none items-center gap-3 px-5 py-3 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted">
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {item.quantity > 1
                      ? t('itemLine', {
                          unit: formatMinor(item.unitAmount, expense.currency),
                          quantity: item.quantity,
                        })
                      : null}
                  </span>
                  <Money className="shrink-0">
                    {formatMinor(lineTotal(item), expense.currency)}
                  </Money>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 text-chevron transition-transform group-open:rotate-180"
                  />
                </summary>
                <p
                  className="border-t border-border bg-muted/40 px-5 py-3 text-xs text-muted-foreground"
                  data-testid="receipt-assignees"
                >
                  {item.assignments.length === 0
                    ? t('itemUnassigned')
                    : item.splitMode === 'BY_AMOUNT'
                      ? t('itemSharedByAmount', {
                          // Same `', '` join as the branch below; switching
                          // to Intl.ListFormat here is the already-filed
                          // follow-up for this file, not this change.
                          names: item.assignments
                            .map((a) => nameOf(a.memberId))
                            .join(', '),
                        })
                      : item.assignments
                          .map((a) =>
                            item.quantity > 1
                              ? t('itemAssignee', {
                                  name: nameOf(a.memberId),
                                  quantity: a.quantity,
                                })
                              : nameOf(a.memberId),
                          )
                          .join(', ')}
                </p>
              </details>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="flex flex-col gap-2">
        <ul className="-mx-5 divide-y divide-border text-sm">
          {expense.participants.map(({ memberId }) => {
            const explanation = explanations.get(memberId)
            const share = shares.get(memberId) ?? 0n
            return (
              <li key={memberId}>
                <details className="group">
                  <summary
                    className="flex min-h-14 w-full cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted"
                    aria-label={t('showDerivation')}
                  >
                    <span className="font-medium">{nameOf(memberId)}</span>
                    <span className="flex items-center gap-2">
                      <Money>
                        {formatMinor(share, group.settlementCurrency)}
                      </Money>
                      <ChevronDown
                        aria-hidden="true"
                        className="size-4 shrink-0 text-chevron transition-transform group-open:rotate-180"
                      />
                    </span>
                  </summary>
                  <ul className="flex flex-col gap-1 border-t border-border bg-muted/40 px-5 py-3 text-xs text-muted-foreground">
                    {explanation?.evenSplitOf ? (
                      <li>
                        {tForm('derivationEven', {
                          total: formatMinor(
                            explanation.evenSplitOf.total,
                            expense.currency,
                          ),
                          count: explanation.evenSplitOf.among,
                        })}
                      </li>
                    ) : (
                      explanation?.lines.map((line, index) => (
                        <li key={index}>
                          {line.splitMode === 'BY_AMOUNT'
                            ? tForm('derivationByAmount', {
                                name: line.name,
                                count: line.claimants,
                                total: formatMinor(
                                  ratioToMinor(line.share),
                                  expense.currency,
                                ),
                              })
                            : line.quantity <= 1
                              ? tForm('derivationShared', {
                                  name: line.name,
                                  count: line.claimants,
                                  total: formatMinor(
                                    ratioToMinor(line.share),
                                    expense.currency,
                                  ),
                                })
                              : tForm('derivationItem', {
                                  name: line.name,
                                  units: line.units,
                                  total: formatMinor(
                                    ratioToMinor(line.share),
                                    expense.currency,
                                  ),
                                })}
                        </li>
                      ))
                    )}
                    {explanation && explanation.unassigned.num !== 0n ? (
                      <li>
                        {tForm('derivationUnassigned', {
                          amount: formatMinor(
                            ratioToMinor(explanation.unassigned),
                            expense.currency,
                          ),
                        })}
                      </li>
                    ) : null}
                    {expense.currency === group.settlementCurrency ? (
                      <li>{tForm('derivationSame')}</li>
                    ) : converted.source === 'SPLIT_FUNDING' ? (
                      // Printing the blended factor here would state a rate
                      // nobody was ever charged.
                      <li>{tForm('derivationSplit')}</li>
                    ) : (
                      <li>
                        {tForm('derivationRate', {
                          source: chipLabel,
                          unit: rateUnitLabel,
                          currency: expense.currency,
                          rate: rateDisplay ?? '',
                          settlement: group.settlementCurrency,
                        })}
                      </li>
                    )}
                    <li>
                      {tForm('derivationRounding', {
                        settlement: group.settlementCurrency,
                      })}
                    </li>
                  </ul>
                </details>
              </li>
            )
          })}
        </ul>
      </section>

      {showBankCharged && !frozen ? (
        <BankChargedForm
          groupId={groupId}
          expenseId={expenseId}
          currency={expense.currency}
          settlementCurrency={group.settlementCurrency}
          foreignAmount={expense.amount.toString()}
          initialDecimal={
            soleFunding?.actualChargedAmount != null
              ? minorToDecimalInput(
                  soleFunding.actualChargedAmount,
                  group.settlementCurrency,
                )
              : ''
          }
          initialFormatted={
            soleFunding?.actualChargedAmount != null
              ? formatMinor(
                  soleFunding.actualChargedAmount,
                  group.settlementCurrency,
                )
              : null
          }
        />
      ) : null}

      {frozen ? null : (
        <CancelExpenseForm
          groupId={groupId}
          expenseId={expenseId}
          cancelled={cancelled}
        />
      )}
    </main>
  )
}
