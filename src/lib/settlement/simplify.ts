import type { MemberId, Transfer } from './types'

interface Party {
  memberId: MemberId
  /** Always positive: credit for creditors, debt for debtors. */
  amount: bigint
}

/**
 * Turn zero-sum net balances into a small list of "who pays whom" transfers
 * by greedily matching the largest creditor with the largest debtor (ties
 * broken by smaller member id, so output is deterministic).
 *
 * Every match fully settles at least one of the two parties, so n members
 * always need at most n-1 transfers. This is NOT the minimum possible number
 * of transfers: finding that optimum is NP-hard (it reduces to partitioning
 * the members into as many zero-sum subgroups as possible), and the greedy
 * bound is well within what a travel group needs.
 *
 * Adapted from Spliit's getSuggestedReimbursements (MIT — see NOTICE),
 * rewritten for exact bigint arithmetic.
 */
export function simplifyDebts(balances: Map<MemberId, bigint>): Transfer[] {
  let total = 0n
  for (const amount of balances.values()) total += amount
  if (total !== 0n) {
    throw new Error(`Balances must sum to zero, got ${total}`)
  }

  const creditors: Party[] = []
  const debtors: Party[] = []
  for (const [memberId, amount] of balances) {
    if (amount > 0n) creditors.push({ memberId, amount })
    else if (amount < 0n) debtors.push({ memberId, amount: -amount })
  }

  const transfers: Transfer[] = []
  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = takeLargest(creditors)
    const debtor = takeLargest(debtors)
    const amount =
      creditor.amount < debtor.amount ? creditor.amount : debtor.amount

    transfers.push({ from: debtor.memberId, to: creditor.memberId, amount })

    creditor.amount -= amount
    debtor.amount -= amount
    if (creditor.amount > 0n) creditors.push(creditor)
    if (debtor.amount > 0n) debtors.push(debtor)
  }
  return transfers
}

/** Remove and return the party with the largest amount (ties: smaller id). */
function takeLargest(parties: Party[]): Party {
  let best = 0
  for (let i = 1; i < parties.length; i++) {
    const p = parties[i]
    if (
      p.amount > parties[best].amount ||
      (p.amount === parties[best].amount && p.memberId < parties[best].memberId)
    ) {
      best = i
    }
  }
  const [party] = parties.splice(best, 1)
  return party
}
