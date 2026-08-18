import { addRatio, ratio } from './money'
import type {
  ExpenseInput,
  ExpenseItemInput,
  ItemAssigneeInput,
  ItemSplitMode,
  MemberId,
  Ratio,
} from './types'

export interface ValidationResult {
  ok: boolean
  /** items total minus receipt total (0n when they match). */
  discrepancy: bigint
}

/**
 * The line total of a receipt line: unit price x quantity, always. Phase 4A's
 * headline bug was every sum in the app using the unit price as if it were
 * the line total, so an item entered as "1,500 x 3" contributed 1,500 —
 * producing a false "differs by 3,000" warning and under-charging consumers.
 * Nothing may add up items except through this function.
 */
export function lineTotal(
  item: Pick<ExpenseItemInput, 'unitAmount' | 'quantity'>,
): bigint {
  return item.unitAmount * BigInt(item.quantity)
}

/** The mode a line is divided by; absent means the pre-4D-A default. */
export const splitModeOf = (item: ExpenseItemInput): ItemSplitMode =>
  item.splitMode ?? 'BY_QUANTITY'

/**
 * Assignees that actually claim a share. Under BY_QUANTITY that means whole
 * units; under BY_AMOUNT the units are meaningless and the money decides, so
 * a zero amount is the only thing that is not an assignment.
 */
const claimants = (item: ExpenseItemInput): ItemAssigneeInput[] =>
  splitModeOf(item) === 'BY_AMOUNT'
    ? item.assignees.filter((assignee) => (assignee.amount ?? 0n) !== 0n)
    : item.assignees.filter((assignee) => assignee.quantity >= 1)

/**
 * Divide one line among everyone who shared it — the "Everyone" chip.
 *
 * Whole units first, because "2 each" is what people can check against the
 * receipt. Only when the units do not go round does the line fall back to
 * dividing its money, which is the honest reading of "we shared it" and
 * keeps `quantity` an integer.
 *
 * The remainder minor units go to the NON-payers: the payer is credited the
 * sum of everyone else's debits, so handing them the smallest share is the
 * same payer-favoured rule the rest of the engine rounds by. `memberIds` is
 * sorted first, so the result depends on the set of people and not on the
 * order they happened to be ticked in.
 */
export function allocateEveryone(
  item: Pick<ExpenseItemInput, 'quantity' | 'unitAmount'>,
  memberIds: MemberId[],
  payerId: MemberId,
): { splitMode: ItemSplitMode; assignees: ItemAssigneeInput[] } {
  const among = uniqueSorted(memberIds)
  const people = among.length
  if (item.quantity % people === 0) {
    const each = item.quantity / people
    return {
      splitMode: 'BY_QUANTITY',
      assignees: among.map((memberId) => ({ memberId, quantity: each })),
    }
  }
  const total = lineTotal(item)
  if (total < 0n) {
    // A refunded line cannot be divided by the payer-favoured integer rule
    // in a way that means anything (the direction of "favour" inverts), and
    // no UI can produce one — item prices are entered unsigned. Fall back to
    // the exact rational split BY_QUANTITY already gives.
    return {
      splitMode: 'BY_QUANTITY',
      assignees: among.map((memberId) => ({ memberId, quantity: 1 })),
    }
  }
  const base = total / BigInt(people)
  const remainder = Number(total % BigInt(people))
  // Payer last, so the extra minor units land on everybody else first.
  const order = [...among.filter((id) => id !== payerId)]
  if (among.includes(payerId)) {
    order.push(payerId)
  }
  const extraFor = new Set(order.slice(0, remainder))
  return {
    splitMode: 'BY_AMOUNT',
    assignees: among.map((memberId) => ({
      memberId,
      quantity: 1,
      amount: extraFor.has(memberId) ? base + 1n : base,
    })),
  }
}

/** Units claimed across an item's assignees. */
export function assignedQuantity(item: ExpenseItemInput): number {
  return claimants(item).reduce((total, a) => total + a.quantity, 0)
}

/**
 * How the assigned quantities compare to the line quantity. `partial` leaves
 * the untaken units to the unassigned pool; `over` cannot be satisfied and
 * the UI must say so before saving. Single-unit lines are always `exact`:
 * ticking three people on one dish means "we shared it", not "we took three".
 */
export type AssignmentStatus = 'unassigned' | 'exact' | 'partial' | 'over'

export function assignmentStatus(item: ExpenseItemInput): AssignmentStatus {
  if (splitModeOf(item) === 'BY_AMOUNT') {
    // The amounts are built to sum to the line total, so the line is either
    // fully divided or not divided at all — units never enter into it.
    return claimants(item).length === 0 ? 'unassigned' : 'exact'
  }
  const assigned = assignedQuantity(item)
  if (assigned === 0) return 'unassigned'
  if (item.quantity <= 1) return 'exact'
  if (assigned < item.quantity) return 'partial'
  if (assigned > item.quantity) return 'over'
  return 'exact'
}

/** Sum of every line total (unit price x quantity). */
export function itemsTotal(items: ExpenseItemInput[]): bigint {
  return items.reduce((total, item) => total + lineTotal(item), 0n)
}

/** Fails with the signed discrepancy when the item sum != receipt total. */
export function validateReceipt(
  items: ExpenseItemInput[],
  totalOnReceipt: bigint,
): ValidationResult {
  const discrepancy = itemsTotal(items) - totalOnReceipt
  return { ok: discrepancy === 0n, discrepancy }
}

/** One member's stake in one receipt line. */
export interface LineContribution {
  /** Index into `expense.items`. */
  index: number
  name: string
  unitAmount: bigint
  /** Units on the line. */
  quantity: number
  /** Units this member claimed. */
  units: number
  /** How many people claimed the line (>1 with quantity 1 means "shared"). */
  claimants: number
  /**
   * How the line was divided. BY_AMOUNT means the units did not go round and
   * the money was split instead, so a breakdown must not read `units` as a
   * count of anything — the screen has to say which rule applied.
   */
  splitMode: ItemSplitMode
  /** This member's exact share of the line, expense-currency minor units. */
  share: Ratio
}

/**
 * Why one member owes what they owe, in the expense's own currency. Every
 * money figure on screen can be opened up to this, and because
 * `allocateExactShares` is derived from it the explanation can never drift
 * from the number it explains.
 */
export interface ShareExplanation {
  lines: LineContribution[]
  /** Share of unassigned lines, untaken units, and the receipt gap. */
  unassigned: Ratio
  /** Set only when the expense has no items and splits evenly. */
  evenSplitOf: { total: bigint; among: number } | null
  /** lines + unassigned; what `allocateExactShares` returns. */
  total: Ratio
}

const ZERO: Ratio = { num: 0n, den: 1n }

/**
 * Allocate an expense to its members as EXACT rational shares in
 * expense-currency minor units, with the working shown. No rounding happens
 * here: each share is rounded exactly once, later, at settlement-currency
 * conversion, where the rounding favors the payer (see balances.ts).
 *
 * - An assigned line is split in proportion to the units each assignee took.
 *   With one unit and three tickers that is the equal three-way split; with
 *   three units taken 2/1 it is two thirds and one third.
 * - A BY_AMOUNT line ignores units entirely and charges each assignee the
 *   amount stored against them (see `allocateEveryone`). Those are built to
 *   sum to the line total; any difference is treated as unassigned rather
 *   than silently dropped.
 * - A line whose assignees took FEWER units than the line has charges each
 *   of them for exactly the units they took, and the untaken units join the
 *   unassigned pool. (Over-assignment is a data error the UI blocks; if one
 *   reaches here the whole line is still split proportionally, so nobody is
 *   ever charged more than was paid.)
 * - Unassigned lines (tax, service charge) are distributed proportionally to
 *   each member's assigned subtotal; if no member has an assigned subtotal,
 *   they fall back to an equal split among the expense participants.
 * - Any gap between the itemised lines and the expense total is treated as
 *   one more unassigned line (signed): itemising part of a receipt must
 *   never drop the rest of it out of settlement, and over-itemising must
 *   never charge more than was paid.
 * - No items at all: the whole amount splits equally among participants.
 *
 * Shares always sum exactly to `expense.amount`.
 */
export function explainShares(
  expense: Pick<ExpenseInput, 'amount' | 'items' | 'participantIds'>,
): Map<MemberId, ShareExplanation> {
  const explanations = new Map<MemberId, ShareExplanation>()
  const entry = (memberId: MemberId): ShareExplanation => {
    const existing = explanations.get(memberId)
    if (existing) return existing
    const fresh: ShareExplanation = {
      lines: [],
      unassigned: ZERO,
      evenSplitOf: null,
      total: ZERO,
    }
    explanations.set(memberId, fresh)
    return fresh
  }

  if (expense.items.length === 0) {
    const among = uniqueSorted(expense.participantIds)
    const per = ratio(expense.amount, BigInt(among.length))
    for (const memberId of among) {
      const target = entry(memberId)
      target.evenSplitOf = { total: expense.amount, among: among.length }
      target.total = per
    }
    return explanations
  }

  let unassignedValue = 0n
  expense.items.forEach((item, index) => {
    const taken = claimants(item)
    const total = lineTotal(item)
    if (taken.length === 0) {
      unassignedValue += total
      return
    }
    const mode = splitModeOf(item)
    const byAmount = mode === 'BY_AMOUNT'
    const assigned = taken.reduce((sum, a) => sum + a.quantity, 0)
    const partial = !byAmount && item.quantity > 1 && assigned < item.quantity
    let allocated = 0n
    for (const assignee of taken) {
      const share = byAmount
        ? ratio(assignee.amount ?? 0n, 1n)
        : partial
          ? ratio(item.unitAmount * BigInt(assignee.quantity), 1n)
          : ratio(total * BigInt(assignee.quantity), BigInt(assigned))
      allocated += byAmount ? (assignee.amount ?? 0n) : 0n
      const target = entry(assignee.memberId)
      target.lines.push({
        index,
        name: item.name,
        unitAmount: item.unitAmount,
        quantity: item.quantity,
        units: assignee.quantity,
        claimants: taken.length,
        splitMode: mode,
        share,
      })
      target.total = addRatio(target.total, share)
    }
    if (partial) {
      unassignedValue += item.unitAmount * BigInt(item.quantity - assigned)
    }
    if (byAmount) {
      // The amounts are written to sum to the line total, so this is 0 in
      // every case the app produces. Carrying the difference anyway means
      // hand-edited or half-migrated data loses nothing and invents nothing:
      // it lands in the same unassigned pool as an un-itemised remainder.
      unassignedValue += total - allocated
    }
  })

  // Explicit unassigned lines, untaken units, and the signed receipt gap.
  const unassignedTotal =
    unassignedValue + (expense.amount - itemsTotal(expense.items))
  if (unassignedTotal === 0n) {
    return explanations
  }

  const assignedTotal = [...explanations.values()].reduce(
    (sum, e) => addRatio(sum, e.total),
    ZERO,
  )
  if (explanations.size === 0 || assignedTotal.num === 0n) {
    const among = uniqueSorted(expense.participantIds)
    const per = ratio(unassignedTotal, BigInt(among.length))
    for (const memberId of among) {
      const target = entry(memberId)
      target.unassigned = addRatio(target.unassigned, per)
      target.total = addRatio(target.total, per)
    }
    return explanations
  }

  // extra_i = unassignedTotal * subtotal_i / sum(subtotals), exactly. The
  // numerator carries the sign (a refund makes `assignedTotal.num` negative).
  for (const target of explanations.values()) {
    const subtotal = target.total
    const num = unassignedTotal * subtotal.num * assignedTotal.den
    const den = subtotal.den * assignedTotal.num
    const extra = den < 0n ? ratio(-num, -den) : ratio(num, den)
    target.unassigned = addRatio(target.unassigned, extra)
    target.total = addRatio(target.total, extra)
  }
  return explanations
}

/** Just the totals — the shape the balance maths consumes. */
export function allocateExactShares(
  expense: Pick<ExpenseInput, 'amount' | 'items' | 'participantIds'>,
): Map<MemberId, Ratio> {
  return new Map(
    [...explainShares(expense)].map(([memberId, explanation]) => [
      memberId,
      explanation.total,
    ]),
  )
}

function uniqueSorted(memberIds: MemberId[]): MemberId[] {
  const unique = [...new Set(memberIds)].sort()
  if (unique.length === 0) {
    throw new Error('Cannot split an amount among zero members')
  }
  return unique
}
