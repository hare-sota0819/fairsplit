'use client'

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SubmitButton } from '@/components/SubmitButton'
import { Button, buttonVariants } from '@/components/ui/button'
import { fromLocalInputValue, toLocalInputValue } from '@/lib/datetime'
import {
  draftKey as buildDraftKey,
  parseDraft,
  serializeDraft,
  type ExpenseDraft,
} from '@/lib/expense-draft'
import { minorToDecimalInput, parseAmountToMinor } from '@/lib/format'
import type { FundingSource } from '@/lib/schemas/expense'
import { assignmentStatus, type ItemSplitMode } from '@/lib/settlement'
import type { ExpenseFormData } from './form-props'
import type { ExpenseFormState } from './actions'
import {
  computeMath,
  pendingTopUp,
  type ExtraFunding,
  type MarketQuote,
  type WizardState,
} from './wizard/math'
import { StepAmount } from './wizard/StepAmount'
import { StepAssign } from './wizard/StepAssign'
import { StepItems } from './wizard/StepItems'
import { StepPayment, fundingKey, walletsFor } from './wizard/StepPayment'
import { StepReview } from './wizard/StepReview'

export interface ExpenseInitial {
  amount: string
  currency: string
  payerId: string
  funding: FundingSource
  /** Sources beyond the primary one, when the receipt was split. */
  extraFunding: ExtraFunding[]
  /** Absolute instant; rendered in the device's timezone on mount. */
  timestampIso: string
  note: string
  isPersonal: boolean
  receiptImagePath?: string | null
  ownRate: string
  participantIds: string[]
  items: {
    name: string
    unitAmount: string
    quantity: number
    splitMode: ItemSplitMode
    assignees: { memberId: string; quantity: number }[]
  }[]
}

interface ExpenseFormProps {
  groupId: string
  expenseId?: string
  action: (
    prev: ExpenseFormState,
    formData: FormData,
  ) => Promise<ExpenseFormState>
  data: ExpenseFormData
  initial?: ExpenseInitial
}

const STEP_KEYS = ['amount', 'payment', 'items', 'assign', 'review'] as const

const subscribeNever = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/**
 * sessionStorage can throw outright in some privacy modes; a draft is never
 * worth breaking the form over.
 */
function readDraft(key: string): ExpenseDraft | null {
  try {
    return parseDraft(sessionStorage.getItem(key), Date.now())
  } catch {
    return null
  }
}

/**
 * Whether this mount should restore a parked sessionStorage draft, as
 * opposed to a prefill handoff or a plain fresh start. A chat handoff link
 * (`?draftAmount=...`, resolved by `new/page.tsx` into
 * `data.defaults.prefill`) wins over a parked draft. The two only compete on
 * the SAME `new/page.tsx` mount, so this is not "URL vs. autosave" in
 * general — it is "what the user just typed in chat, seconds ago" vs.
 * "whatever was last left in this group's new-expense slot, up to a week
 * old." A tapped handoff link is deliberate, current intent; a stale draft
 * is easy to forget existed.
 *
 * SINGLE SOURCE OF TRUTH: the `key` remount below, the initial `WizardState`
 * branch in `initialState`, and the timezone-localisation ref in `Wizard`
 * all key off this SAME function. They used to be re-derived separately and
 * could disagree — e.g. the localisation ref used a stale `draft !== null`
 * check, so a handoff onto a group that ALSO had a parked draft skipped the
 * device-timezone correction and saved the SSR offset-0 timestamp uncorrected
 * (often the previous day in KST).
 */
function usesDraft(
  data: ExpenseFormData,
  draft: ExpenseDraft | null,
): draft is ExpenseDraft {
  return draft !== null && data.defaults.prefill?.amount === undefined
}

/**
 * A draft parked by a detour to the wallets screen only exists in the
 * browser, so the wizard is remounted with it once hydration has run. The
 * remount is deliberately conditional on a draft ACTUALLY being USED
 * (`usesDraft`), not merely present: remounting unconditionally would throw
 * away anything typed in the moment between first paint and hydration, and
 * on a prefill handoff the draft is deliberately not used at all, so keying
 * on its mere presence would force a pointless remount for no benefit.
 */
export function ExpenseForm(props: ExpenseFormProps) {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    clientSnapshot,
    serverSnapshot,
  )
  const draftKey = buildDraftKey(props.groupId, props.expenseId)
  const draft = hydrated ? readDraft(draftKey) : null
  return (
    <Wizard
      {...props}
      key={usesDraft(props.data, draft) ? 'draft' : 'fresh'}
      draft={draft}
      draftKey={draftKey}
    />
  )
}

function initialState(
  data: ExpenseFormData,
  initial: ExpenseInitial | undefined,
  draft: ExpenseDraft | null,
): WizardState {
  if (usesDraft(data, draft)) {
    // `v` and `savedAt` ride along harmlessly; serializeDraft rewrites both.
    return {
      ...draft,
      receiptImagePath: draft.receiptImagePath ?? null,
      maxStep: Math.max(draft.step, draft.maxStep),
      // A draft parked before a portion could name its own funder has none;
      // empty is the payer, which is what those portions always meant.
      extraFunding: draft.extraFunding.map((extra) => ({
        ...extra,
        memberId: extra.memberId ?? '',
      })),
    }
  }
  const payerId = initial?.payerId ?? data.defaults.payerId
  // EDITING lands on Review, the last step, not back at square one.
  //
  // The five steps are an order worth imposing on a NEW expense — you cannot
  // say who had which dish before you have said what the dishes were. On an
  // existing one that order is just a toll: everything is already filled in
  // and valid, Save lives on the last step, so correcting a typo in the
  // amount meant tapping Next four more times to get back to a button.
  // Review already carries `< Back` and every step chip, so landing there
  // puts every part of the expense one tap away.
  const lastStep = initial ? STEP_KEYS.length - 1 : 0
  return {
    step: lastStep,
    // Everything behind it counts as reached, or Back and the step chips
    // would refuse to go anywhere.
    maxStep: lastStep,
    amount: initial?.amount ?? data.defaults.prefill?.amount ?? '',
    currency:
      initial?.currency ??
      data.defaults.prefill?.currency ??
      data.defaults.currency,
    payerId,
    funding: initial?.funding ??
      data.defaults.lastFundingByPayer[payerId] ?? { kind: 'PAY_AS_YOU_GO' },
    extraFunding: initial?.extraFunding ?? [],
    note: initial?.note ?? data.defaults.prefill?.note ?? '',
    // Seeded with the instant rendered in UTC so SSR and hydration agree; an
    // effect rewrites it in the device's timezone immediately afterwards.
    timestamp: toLocalInputValue(
      new Date(initial?.timestampIso ?? data.defaults.nowIso),
      0,
    ),
    participantIds:
      initial?.participantIds ?? data.members.map((member) => member.id),
    items: (initial?.items ?? []).map((item, index) => ({
      key: index,
      ...item,
    })),
    nextKey: initial?.items.length ?? 0,
    isPersonal: initial?.isPersonal ?? false,
    receiptImagePath: initial?.receiptImagePath ?? null,
    ownRate: initial?.ownRate ?? '',
    // An at-the-till top-up is never restored from a saved expense: the
    // record it produced already exists, so re-applying it would exchange
    // the same money twice. A parked draft DOES carry it (see the draft
    // shape) because that save never happened.
    topUpAmount: '',
    topUpRate: '',
    topUpPaid: '',
    manualOpen: false,
    manualRate: '',
    receiptTotal: initial?.amount ?? '',
    receiptTouched: false,
  }
}

/**
 * The funding source actually in force. A wallet the payer does not own, or
 * that holds a different currency, could not have paid for this — so the
 * stored choice falls back to that member's last-used source, and then to a
 * pay-as-you-go card, rather than silently pricing the expense off someone
 * else's pot.
 */
function resolveFunding(
  state: WizardState,
  data: ExpenseFormData,
): FundingSource {
  const available = walletsFor(data.wallets, state.payerId, state.currency)
  const owns = (source: FundingSource): boolean =>
    source.kind !== 'WALLET' ||
    available.some((wallet) => wallet.id === source.walletId)
  if (owns(state.funding)) {
    return state.funding
  }
  const fallback = data.defaults.lastFundingByPayer[state.payerId]
  return fallback && owns(fallback) ? fallback : { kind: 'PAY_AS_YOU_GO' }
}

function Wizard({
  groupId,
  expenseId,
  action,
  data,
  initial,
  draft,
  draftKey,
}: ExpenseFormProps & { draft: ExpenseDraft | null; draftKey: string }) {
  const t = useTranslations('expenses.form')
  const tCommon = useTranslations('common')
  const usingDraft = usesDraft(data, draft)
  const [raw, setState] = useState<WizardState>(() =>
    initialState(data, initial, draft),
  )
  const [force, setForce] = useState(false)
  const [market, setMarket] = useState<
    (MarketQuote & { currency: string }) | null
  >(null)

  // Flips true the first time the USER changes something via `patch` — as
  // opposed to an automatic correction like the timezone-localisation effect
  // below, which calls `setState` directly and must not count. Only used to
  // gate the very first autosave tick on a prefill-handoff mount that landed
  // on a group with an ignored parked draft (see `parkDraft`).
  const hasUserEdited = useRef(false)
  const patch = (change: Partial<WizardState>) => {
    hasUserEdited.current = true
    setState((previous) => ({ ...previous, ...change }))
  }

  // Whether there is a REAL parked draft this mount is deliberately not
  // using — read directly from storage, NOT from the `draft` prop. The prop
  // is intentionally reported as `null` by `ExpenseForm` until its own
  // hydration flag settles, so the FIRST render's `WizardState` stays in
  // sync with the server; a ref initializer, unlike render output, is
  // invisible to hydration-mismatch detection, so reading storage directly
  // here — once, at this instance's real mount — is safe. It is also
  // necessary: on a prefill-handoff mount `usingDraft` is false from birth
  // (see `usesDraft`), so no remount ever swaps in the resolved `draft`
  // prop the way a plain draft-restore does — gating on the prop here would
  // leave the very first `parkDraft` tick unable to tell "no draft" from "a
  // draft exists but the prop hasn't caught up yet," and it would overwrite
  // a real parked draft within milliseconds of mount.
  const ignoredParkedDraft = useRef(!usingDraft && readDraft(draftKey) !== null)

  const foreign = raw.currency !== data.defaults.settlementCurrency

  // The device's timezone is browser-only knowledge, so the default "when"
  // is corrected once after mount rather than guessed on the server. A
  // restored draft already holds a device-local wall clock. Must key off the
  // SAME `usesDraft` condition as `initialState`'s branch (see its comment):
  // a stale `draft !== null` check here would skip this correction whenever
  // a draft merely EXISTED but was not the one actually seeding `raw`.
  const localised = useRef(usingDraft)
  useEffect(() => {
    if (localised.current) return
    localised.current = true
    setState((previous) => ({
      ...previous,
      timestamp: toLocalInputValue(
        new Date(initial?.timestampIso ?? data.defaults.nowIso),
        new Date().getTimezoneOffset(),
      ),
    }))
  }, [initial?.timestampIso, data.defaults.nowIso])

  // The market rate for the live preview. The answer carries its currency so
  // a late reply for a currency the user has moved off is simply ignored.
  useEffect(() => {
    if (!foreign) {
      return
    }
    let cancelled = false
    fetch(
      `/api/rates?base=${raw.currency}&quote=${data.defaults.settlementCurrency}`,
    )
      .then((response) => response.json())
      .then((body: MarketQuote) => {
        if (!cancelled) setMarket({ ...body, currency: raw.currency })
      })
      .catch(() => {
        if (!cancelled) {
          setMarket({
            rate: null,
            asOf: null,
            today: null,
            currency: raw.currency,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [raw.currency, data.defaults.settlementCurrency, foreign])

  const quote = market?.currency === raw.currency ? market : null
  const marketLoading = foreign && quote === null

  // A wallet only makes sense for the member who owns it and in the currency
  // it holds, so a stored choice is RESOLVED on the way out rather than
  // corrected by an effect: changing the currency must not leave the form
  // pointing at a pot the money could not have come from. (Changing the payer
  // switches to their own last-used source in the picker's own handler.)
  const state = useMemo(
    () => ({ ...raw, funding: resolveFunding(raw, data) }),
    [raw, data],
  )

  const math = useMemo(
    () =>
      computeMath(
        state,
        {
          wallets: data.wallets,
          settlementCurrency: data.defaults.settlementCurrency,
          rateMode: data.defaults.rateMode,
          // Step 1 is BEFORE the "what did you pay with?" question, so it
          // quotes the market rate. Answering it on step 2 switches the very
          // same preview over to the wallet's own rate, in front of the user.
          previewAtMarket: state.step === 0,
        },
        quote,
      ),
    [
      state,
      data.wallets,
      data.defaults.settlementCurrency,
      data.defaults.rateMode,
      quote,
    ],
  )

  /**
   * Park the in-progress expense so nothing is lost to a step change, a
   * detour to the wallets screen, or the browser discarding a backgrounded
   * tab. Only once something has actually been typed: parking an untouched
   * form would leave a stale empty draft behind for a week.
   *
   * A prefill handoff already arrives "started" (the amount is seeded from
   * the URL), so this effect would otherwise fire on the very FIRST render
   * and, if this group also has an unrelated parked draft at the same key
   * that `usesDraft` chose not to restore, silently overwrite it within
   * milliseconds of mount — before the user could ever get back to it. That
   * makes "skipping the draft does not delete it" false. Preserve it
   * instead: on that specific case (a draft exists, is not the one in use,
   * and the user has not touched anything yet), skip parking. The moment the
   * user edits anything, `hasUserEdited` flips and autosave behaves exactly
   * as it always has — the ignored draft is theirs to overwrite once they
   * have actually started building a new expense on top of the prefill.
   */
  const started = state.amount.trim() !== '' || state.items.length > 0
  const parkDraft = () => {
    if (!started) return
    if (ignoredParkedDraft.current && !hasUserEdited.current) return
    try {
      sessionStorage.setItem(draftKey, serializeDraft(state, Date.now()))
    } catch {
      // Storage unavailable — the form still works, the draft just is not
      // there when we come back. Never block on it.
    }
  }
  useEffect(parkDraft, [state, draftKey, started])

  const overAssigned = state.items.some(
    (item) =>
      assignmentStatus({
        name: item.name,
        unitAmount: parseAmountToMinor(item.unitAmount, state.currency) ?? 0n,
        quantity: item.quantity,
        assignees: item.assignees,
      }) === 'over',
  )
  const amountReady = math.amountMinor !== null && math.amountMinor !== 0n
  // Funding portions that overshoot the expense would price part of the
  // receipt twice; the engine refuses them outright, so the step does too.
  const overFunded = math.primaryAmount !== null && math.primaryAmount < 0n
  const blocked =
    (state.step === 0 && !amountReady) ||
    (state.step === 1 && overFunded) ||
    (state.step === 3 && overAssigned)
  const last = state.step === STEP_KEYS.length - 1

  const goTo = (step: number) =>
    patch({ step, maxStep: Math.max(state.maxStep, step) })

  const topUp = pendingTopUp(
    state,
    data.wallets,
    data.defaults.settlementCurrency,
  )

  const payload = {
    amount: state.amount,
    currency: state.currency,
    payerId: state.payerId,
    fundingSource: state.funding,
    note: state.note || undefined,
    isPersonal: state.isPersonal,
    receiptImagePath: state.receiptImagePath,
    marketRateDisplay: (state.manualOpen && state.manualRate) || undefined,
    // The bank-statement figure is NOT sent from here any more — it is
    // corrected on the expense detail screen, and `saveExpense` leaves that
    // column untouched so an edit cannot blank out a posted statement.
    ownRateDisplay:
      (state.funding.kind === 'PREPAID_NO_WALLET' && state.ownRate) ||
      undefined,
    // Money exchanged at the till, on its way to becoming an ordinary
    // top-up on the wallet that is paying. Sent as typed; the server parses
    // and validates it against the wallet it names.
    topUp: topUp
      ? {
          walletId: topUp.walletId,
          amount: state.topUpAmount,
          paid: minorToDecimalInput(
            topUp.paid,
            data.defaults.settlementCurrency,
          ),
        }
      : undefined,
    // The sources beyond the primary one. The primary's own amount is not
    // sent: the server derives it as whatever these leave, so the portions
    // cannot arrive failing to add up to the expense.
    extraFunding: state.extraFunding.map((extra) => ({
      amount: extra.amount,
      source: extra.source,
      ownRateDisplay:
        (extra.source.kind === 'PREPAID_NO_WALLET' && extra.ownRate) ||
        undefined,
      memberId: extra.memberId || undefined,
    })),
    participantIds: state.isPersonal ? [state.payerId] : state.participantIds,
    items: state.items.map(
      ({ name, unitAmount, quantity, splitMode, assignees }) => ({
        name,
        unitAmount,
        quantity,
        splitMode,
        assignees,
      }),
    ),
    force,
  }

  // The instant is resolved at submit time from the live offset, so a device
  // that crossed a timezone mid-entry still records the right moment.
  const clientAction = async (
    previous: ExpenseFormState,
    formData: FormData,
  ): Promise<ExpenseFormState> => {
    const instant = fromLocalInputValue(
      state.timestamp,
      new Date().getTimezoneOffset(),
    )
    formData.set(
      'payload',
      JSON.stringify({
        ...payload,
        timestampIso: instant ? instant.toISOString() : '',
      }),
    )
    return action(previous, formData)
  }
  const [result, formAction, pending] = useActionState<
    ExpenseFormState,
    FormData
  >(clientAction, {})

  const stepProps = {
    groupId,
    expenseId,
    state,
    patch,
    data,
    math,
    market: quote,
    marketLoading,
    parkDraft,
  }

  return (
    <form
      action={formAction}
      // Enter inside a field must not submit a half-filled expense from
      // step 1 — the only place the form may be submitted is the last step.
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          !last &&
          (event.target as HTMLElement).tagName === 'INPUT'
        ) {
          event.preventDefault()
        }
      }}
      className="flex flex-col gap-6 px-5 py-5"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="expenseId" value={expenseId ?? ''} />

      <nav aria-label={t('steps.review')} className="flex flex-col gap-2">
        <ol className="flex gap-1.5">
          {STEP_KEYS.map((key, index) => {
            const reachable = index <= state.maxStep
            return (
              <li key={key} className="flex-1">
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => reachable && patch({ step: index })}
                  aria-current={index === state.step ? 'step' : undefined}
                  aria-label={t(`steps.${key}`)}
                  data-testid={`step-${key}`}
                  className={`h-1.5 w-full rounded-full transition-colors ${
                    index <= state.step
                      ? 'bg-primary'
                      : reachable
                        ? 'bg-primary/30'
                        : 'bg-border'
                  }`}
                />
              </li>
            )
          })}
        </ol>
        <p
          className="text-xs font-medium text-muted-foreground"
          data-testid="step-label"
        >
          {t('stepOf', {
            current: state.step + 1,
            total: STEP_KEYS.length,
            title: t(`steps.${STEP_KEYS[state.step]}`),
          })}
        </p>
      </nav>

      {state.step === 0 ? <StepAmount {...stepProps} /> : null}
      {state.step === 1 ? <StepPayment {...stepProps} /> : null}
      {state.step === 2 ? <StepItems {...stepProps} /> : null}
      {state.step === 3 ? <StepAssign {...stepProps} /> : null}
      {state.step === 4 ? <StepReview {...stepProps} /> : null}

      {result.duplicate ? (
        <div className="rounded-xl bg-notice-soft p-4 text-sm" role="alert">
          <p>
            {t('duplicate', {
              title: result.duplicate.title,
              amount: result.duplicate.amount,
            })}
          </p>
          <SubmitButton
            pending={pending}
            variant="outline"
            onClick={() => setForce(true)}
            className="mt-3"
            testId="save-anyway"
          >
            {t('saveAnyway')}
          </SubmitButton>
        </div>
      ) : null}
      {result.error ? (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        {state.step > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="hero"
            onClick={() => patch({ step: state.step - 1 })}
            className="flex-1 gap-1"
            data-testid="wizard-back"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {tCommon('back')}
          </Button>
        ) : null}
        {last ? (
          <SubmitButton
            pending={pending}
            busyLabel={t('saving')}
            size="hero"
            className="flex-[2]"
            overlay
            testId="save-expense"
          >
            {t('save')}
          </SubmitButton>
        ) : (
          <Button
            type="button"
            size="hero"
            disabled={blocked}
            onClick={() => goTo(state.step + 1)}
            className="flex-[2] gap-1"
            data-testid="wizard-next"
          >
            {tCommon('next')}
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>

      <Link
        href={
          expenseId
            ? `/groups/${groupId}/expenses/${expenseId}`
            : `/groups/${groupId}`
        }
        className={buttonVariants({ variant: 'ghost', size: 'touch' })}
        data-testid="cancel-expense"
      >
        {tCommon('cancel')}
      </Link>
    </form>
  )
}

export { fundingKey }
