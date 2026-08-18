import { scanAmountCandidates } from '../hangul-number'
import { findMembers } from '../../chat-parse/people'
import type { ChatMember } from '../../chat-parse/types'
import type { UtteranceInterpretation } from './provider'

/**
 * Guard G1 — source grounding. Every number and member name an
 * interpreter proposes must be LITERALLY present in the user's raw text
 * (numbers after hangul-number normalization: "2만엔" grounds "20000").
 * Whatever cannot be grounded is stripped, and the strips are reported so
 * the caller can ask about exactly what was dropped (guard G4) instead of
 * silently proceeding with an invented value.
 */
export interface GroundedInterpretation {
  interpretation: UtteranceInterpretation
  /** What G1 removed, by field — non-empty means "ask, don't proceed". */
  rejected: Array<
    | { field: 'amount'; value: string }
    | { field: 'payerName'; value: string }
    | { field: 'participantNames'; value: string }
  >
}

export function groundInterpretation(
  raw: UtteranceInterpretation,
  text: string,
  roster: ChatMember[],
): GroundedInterpretation {
  const rejected: GroundedInterpretation['rejected'] = []

  // Numbers: every normalized amount the text actually carries.
  const textAmounts = new Set(scanAmountCandidates(text).map((c) => c.amount))
  let amount = raw.amount
  if (amount !== null && !textAmounts.has(amount)) {
    rejected.push({ field: 'amount', value: amount })
    amount = null
  }

  // Names: only members the text actually binds (the same recognizer the
  // rule path uses — josa-aware, so "민수가" grounds "민수").
  const boundIds = new Set(findMembers(text, roster).map((h) => h.id))
  const nameToId = new Map(roster.map((m) => [m.name, m.id]))
  const grounded = (name: string): boolean => {
    const id = nameToId.get(name)
    return id !== undefined && boundIds.has(id)
  }

  let payerName = raw.payerName
  if (payerName !== null && !grounded(payerName)) {
    rejected.push({ field: 'payerName', value: payerName })
    payerName = null
  }
  const participantNames = raw.participantNames.filter((n) => {
    if (grounded(n)) return true
    rejected.push({ field: 'participantNames', value: n })
    return false
  })

  return {
    interpretation: { ...raw, amount, payerName, participantNames },
    rejected,
  }
}
