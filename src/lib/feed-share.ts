import {
  addRatio,
  ceilDiv,
  explainShares,
  type ExpenseInput,
  type ItemSplitMode,
  type MemberId,
  type Ratio,
} from '@/lib/settlement'

/**
 * One line of "what I had" on a receipt, in the expense's own currency.
 * `name === null` is the leftover row: unassigned lines, the tax nobody
 * ticked, untaken units and any gap between the items and the total.
 */
export interface FeedShareLine {
  key: string
  name: string | null
  /** Units this member took. Meaningless for a BY_AMOUNT line. */
  units: number
  /** Units on the line. */
  quantity: number
  splitMode: ItemSplitMode | null
  /** This member's part of the line, rounded (see below). */
  amount: bigint
}

export interface FeedShare {
  /** What this member consumed, expense-currency minor units. */
  total: bigint
  lines: FeedShareLine[]
  /** Set only when the expense has no items and split evenly. */
  evenSplitOf: { total: bigint; among: number } | null
}

const ZERO: Ratio = { num: 0n, den: 1n }

/**
 * ONE member's side of an expense, for the feed: the total they consumed and
 * the lines that made it up. Nobody else's share appears — the feed answers
 * "what did I have?", and the receipt total is not that number.
 *
 * The lines SUM EXACTLY to the total. Rounding each line on its own would
 * not: three ¥1,000 thirds are ¥334 each and ¥1,002 together. So the exact
 * rational shares are accumulated and the RUNNING TOTAL is rounded, each
 * line taking the difference from the previous one. That telescopes, so the
 * last difference lands exactly on `ceilDiv(total)` — the same payer-favored
 * rounding, and the same figure `shareBreakdown` puts in the home totals.
 *
 * Returns null when this member has no share at all (they were not a
 * participant), which is different from a share of zero.
 *
 * Pure — no DB, no formatting.
 */
export function feedShareFor(
  expense: Pick<ExpenseInput, 'amount' | 'items' | 'participantIds'>,
  memberId: MemberId,
): FeedShare | null {
  const explanation = explainShares(expense).get(memberId)
  if (explanation === undefined) {
    return null
  }

  const parts: { seed: Omit<FeedShareLine, 'amount'>; share: Ratio }[] =
    explanation.lines.map((line) => ({
      seed: {
        key: `item-${line.index}`,
        name: line.name,
        units: line.units,
        quantity: line.quantity,
        splitMode: line.splitMode,
      },
      share: line.share,
    }))
  if (explanation.unassigned.num !== 0n) {
    parts.push({
      seed: {
        key: 'rest',
        name: null,
        units: 0,
        quantity: 0,
        splitMode: null,
      },
      share: explanation.unassigned,
    })
  }

  let running = ZERO
  let rounded = 0n
  const lines = parts.map((part) => {
    running = addRatio(running, part.share)
    const next = ceilDiv(running.num, running.den)
    const amount = next - rounded
    rounded = next
    return { ...part.seed, amount }
  })

  return {
    total: ceilDiv(explanation.total.num, explanation.total.den),
    lines,
    evenSplitOf: explanation.evenSplitOf,
  }
}
