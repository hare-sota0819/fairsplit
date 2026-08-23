import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { parseAmountToMinor } from '@/lib/format'
import { displayRateToStorage } from '@/lib/rate-units'
import type { ExpensePayload, FundingSource } from '@/lib/schemas/expense'
import {
  allocateEveryone,
  fundingRemainder,
  rateFromDecimalString,
  type ItemSplitMode,
} from '@/lib/settlement'

/**
 * The wizard payload, turned into the rows an expense is stored as.
 *
 * Lifted out of `saveExpense` verbatim when retroactive change requests
 * arrived (Stage 2 of the checkpoint brief), because a proposal has to be
 * derived and PRICED before anyone agrees to it — and then written, unchanged,
 * once they do. The spec's rule that "the diff shown to approvers must be
 * identical at request time and approval time" is only guaranteed if both ends
 * use the same rows, so the request stores what this returns rather than
 * re-deriving from the payload at approval time.
 *
 * It reaches the database (wallets, funders) so it is not unit-tested on its
 * own; what covers it is the whole e2e suite, which drives every branch
 * through the real wizard.
 *
 * Note one side effect kept from the original: `NEW_CASH_WALLET` creates the
 * pot here rather than at write time, so deriving a proposal that names one
 * creates it even if the proposal is never approved. An empty extra cash
 * wallet is harmless and the next derivation reuses it; making the write path
 * conditional on approval would have been the larger change.
 */

/** One receipt line, derived. */
export interface DerivedItemRow {
  name: string
  unitAmount: bigint
  quantity: number
  splitMode: ItemSplitMode
  assignees: { memberId: string; quantity: number; amount?: bigint }[]
}

/** One funding portion, derived. Position 0 is the primary source. */
export interface DerivedFundingRow {
  position: number
  amount: bigint
  walletId: string | null
  ownRateSnapshot: string | null
  funderId: string | null
}

export interface DerivedExpenseWrite {
  participantIds: string[]
  amount: bigint
  timestamp: Date
  fundingRows: DerivedFundingRow[]
  itemRows: DerivedItemRow[]
}

/** Either the rows, or the one translated error that stopped them. */
export type DeriveResult = DerivedExpenseWrite | { error: string }

/**
 * Turn the chosen funding source into the `walletId` the expense stores.
 *
 * A wallet must belong to the payer and hold the expense's currency —
 * otherwise the money could not have come out of it, and the rate it implies
 * would be nonsense. NEW_CASH_WALLET creates the pot on the spot so that
 * "I paid cash" never requires setting anything up first; it reuses an
 * existing cash wallet if one appeared in the meantime.
 */
async function resolveWalletId(
  source: FundingSource,
  /** Whoever fronted this portion — the payer unless the portion says so. */
  funderId: string,
  currency: string,
): Promise<{ walletId: string | null } | { error: 'invalid' }> {
  // Neither of these draws on a wallet: pay-as-you-go was converted by the
  // bank, and PREPAID_NO_WALLET is money the payer exchanged themselves but
  // keeps no pot for. What tells them apart downstream is `ownRateSnapshot`.
  if (source.kind === 'PAY_AS_YOU_GO' || source.kind === 'PREPAID_NO_WALLET') {
    return { walletId: null }
  }
  if (source.kind === 'WALLET') {
    const wallet = await prisma.wallet.findFirst({
      where: { id: source.walletId, memberId: funderId, currency },
    })
    return wallet ? { walletId: wallet.id } : { error: 'invalid' }
  }
  const existing = await prisma.wallet.findFirst({
    where: { memberId: funderId, currency, type: 'CASH' },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) {
    return { walletId: existing.id }
  }
  const t = await getTranslations('wallet')
  const created = await prisma.wallet.create({
    data: {
      memberId: funderId,
      type: 'CASH',
      label: t('defaultCashLabel'),
      currency,
    },
  })
  return { walletId: created.id }
}

export async function deriveExpenseWrite({
  groupId,
  payload,
  settlementCurrency,
  members,
}: {
  groupId: string
  payload: ExpensePayload
  settlementCurrency: string
  /** This group's members; the caller already has them. */
  members: { id: string }[]
}): Promise<DeriveResult> {
  const t = await getTranslations('expenses.form.errors')
  const memberIds = new Set(members.map((m) => m.id))

  // Personal expenses never circulate: only the payer shares them.
  const participantIds = payload.isPersonal
    ? [payload.payerId]
    : [...new Set(payload.participantIds)]

  const validMembers =
    memberIds.has(payload.payerId) &&
    participantIds.every((id) => memberIds.has(id)) &&
    payload.items.every((item) =>
      item.assignees.every((a) => participantIds.includes(a.memberId)),
    )
  if (!validMembers) {
    return { error: t('notMember') }
  }

  const amount = parseAmountToMinor(payload.amount, payload.currency)
  if (amount === null || amount === 0n) {
    return { error: t('amountZero') }
  }

  /**
   * One funding portion, resolved: which wallet it drew on, and the payer's
   * own exchange rate when it drew on none.
   *
   * The own rate is anchored by the form to the currency's quote unit
   * ("100 JPY = ___ KRW"); this is the one place that becomes storage units.
   * Same-currency expenses have nothing to convert, so it never applies.
   */
  const resolvePortion = async (
    source: FundingSource,
    ownRateDisplay: string | undefined,
    funderId: string = payload.payerId,
  ): Promise<
    | { walletId: string | null; ownRateSnapshot: string | null }
    | { error: string }
  > => {
    const resolved = await resolveWalletId(source, funderId, payload.currency)
    if ('error' in resolved) {
      return { error: t('invalidInput') }
    }
    if (
      source.kind !== 'PREPAID_NO_WALLET' ||
      payload.currency === settlementCurrency
    ) {
      return { walletId: resolved.walletId, ownRateSnapshot: null }
    }
    if (!ownRateDisplay) {
      return { error: t('ownRateRequired') }
    }
    const stored = displayRateToStorage(ownRateDisplay, payload.currency)
    if (stored === null) {
      return { error: t('ownRateRequired') }
    }
    try {
      // Throws on malformed or zero; a rate of 0 would divide by nothing.
      rateFromDecimalString(stored, settlementCurrency, payload.currency)
    } catch {
      return { error: t('ownRateRequired') }
    }
    return { walletId: resolved.walletId, ownRateSnapshot: stored }
  }

  // The sources beyond the primary one, each with the amount it covered. A
  // refund goes back where it came from, so splitting one is not offered and
  // is refused here rather than sign-juggled.
  const extras: {
    amount: bigint
    walletId: string | null
    ownRateSnapshot: string | null
    funderId: string | null
  }[] = []
  if (payload.extraFunding.length > 0 && amount < 0n) {
    return { error: t('invalidInput') }
  }
  for (const extra of payload.extraFunding) {
    const extraAmount = parseAmountToMinor(extra.amount, payload.currency)
    if (extraAmount === null || extraAmount <= 0n) {
      return { error: t('fundingAmount') }
    }
    // A portion someone else fronted names them. The id is checked against
    // THIS group's active members: an id from another group would credit a
    // stranger, and one who has left cannot have paid for tonight's dinner.
    const funderId =
      extra.memberId && extra.memberId !== payload.payerId
        ? extra.memberId
        : null
    if (funderId !== null) {
      const funder = await prisma.member.findFirst({
        where: { id: funderId, groupId, leftAt: null },
        select: { id: true },
      })
      if (!funder) {
        return { error: t('invalidInput') }
      }
    }
    const resolved = await resolvePortion(
      extra.source,
      extra.ownRateDisplay,
      funderId ?? payload.payerId,
    )
    if ('error' in resolved) {
      return { error: resolved.error }
    }
    extras.push({ amount: extraAmount, funderId, ...resolved })
  }

  const primary = await resolvePortion(
    payload.fundingSource,
    payload.ownRateDisplay,
  )
  if ('error' in primary) {
    return { error: primary.error }
  }
  // The primary covers what is left, which is what makes the portions add up
  // to the expense by construction. Overshooting them is the one way that can
  // fail, and it must not reach the engine.
  const primaryAmount = fundingRemainder(amount, extras)
  if (primaryAmount < 0n) {
    return { error: t('fundingOver') }
  }
  const fundingRows = [
    // A primary of exactly zero is dropped rather than stored: the extras
    // covered the whole receipt, and a zero portion has no rate to resolve.
    ...(primaryAmount === 0n
      ? []
      : [{ position: 0, amount: primaryAmount, funderId: null, ...primary }]),
    ...extras.map((extra, index) => ({ position: index + 1, ...extra })),
  ]

  const itemRows: {
    name: string
    unitAmount: bigint
    quantity: number
    splitMode: ItemSplitMode
    assignees: { memberId: string; quantity: number; amount?: bigint }[]
  }[] = []
  for (const item of payload.items) {
    const unitAmount = parseAmountToMinor(item.unitAmount, payload.currency)
    if (unitAmount === null) {
      return { error: t('invalidInput') }
    }
    // One row per member; the last quantity for a member wins.
    const assignees = new Map<string, number>()
    for (const assignee of item.assignees) {
      assignees.set(assignee.memberId, assignee.quantity)
    }
    // A line "Everyone" divided by money: the client sends only the mode and
    // who shared it, and the shares are derived HERE. That is what makes
    // "the amounts sum exactly to the line total" an invariant of the stored
    // data rather than a promise about the client. `allocateEveryone` also
    // corrects the mode back to BY_QUANTITY when the units do in fact go
    // round, so a stale flag cannot outlive an edit to the quantity.
    if (item.splitMode === 'BY_AMOUNT' && assignees.size > 0) {
      const divided = allocateEveryone(
        { quantity: item.quantity, unitAmount },
        [...assignees.keys()],
        payload.payerId,
      )
      itemRows.push({
        name: item.name,
        unitAmount,
        quantity: item.quantity,
        splitMode: divided.splitMode,
        assignees: divided.assignees.map((a) => ({
          memberId: a.memberId,
          quantity: a.quantity,
          ...(a.amount === undefined ? {} : { amount: a.amount }),
        })),
      })
      continue
    }
    // Assigning more units than the line holds cannot be satisfied and the
    // wizard blocks it; refuse it here too rather than store a contradiction.
    const assigned = [...assignees.values()].reduce((a, b) => a + b, 0)
    if (item.quantity > 1 && assigned > item.quantity) {
      return { error: t('overAssigned') }
    }
    itemRows.push({
      name: item.name,
      unitAmount,
      quantity: item.quantity,
      splitMode: 'BY_QUANTITY',
      assignees: [...assignees].map(([memberId, quantity]) => ({
        memberId,
        quantity,
      })),
    })
  }

  const timestamp = new Date(payload.timestampIso)
  if (Number.isNaN(timestamp.getTime())) {
    return { error: t('invalidInput') }
  }

  return { participantIds, amount, timestamp, fundingRows, itemRows }
}
