import type { FundingSource } from '@/lib/schemas/expense'

/**
 * The expense wizard parks itself in sessionStorage after every change, so a
 * step change, a detour to the wallets screen, or the browser discarding a
 * backgrounded tab all come back to the same half-typed expense.
 *
 * Three rules the first version broke: a draft must carry EVERY field the
 * form owns (a silent partial restore is worse than none), it must not
 * outlive the trip it belongs to, and a draft written by an older shape must
 * be discarded rather than half-read — hence the explicit version.
 *
 * Pure on purpose — sessionStorage access stays in the components, so this
 * whole contract is unit-testable.
 */

/** A parked draft older than this is dropped on read. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Bump whenever the shape below changes. Older drafts are then discarded. */
export const DRAFT_VERSION = 5

const PREFIX = 'fairsplit:expense-draft:'

export interface DraftAssignee {
  memberId: string
  quantity: number
}

export interface DraftItem {
  key: number
  name: string
  /** Unit price as typed, NOT the line total. */
  unitAmount: string
  quantity: number
  /** Which rule divided the line; see ItemState. */
  splitMode: 'BY_QUANTITY' | 'BY_AMOUNT'
  assignees: DraftAssignee[]
}

/** One extra funding source, as the form holds it. See WizardState. */
export interface DraftExtraFunding {
  key: number
  amount: string
  source: FundingSource
  ownRate: string
  /** Who fronted it; absent on a draft parked before co-funding existed. */
  memberId?: string
}

export interface ExpenseDraft {
  v: number
  /** Wizard step the user was on (0-based). */
  step: number
  /** Furthest step reached, so already-seen steps stay tappable. */
  maxStep: number
  amount: string
  currency: string
  payerId: string
  /** Receipt photo path, so parking a draft after a scan does not lose it. */
  receiptImagePath?: string | null
  funding: FundingSource
  /** Sources beyond the primary one; the primary covers whatever is left. */
  extraFunding: DraftExtraFunding[]
  note: string
  /** Device-local wall clock exactly as the datetime input held it. */
  timestamp: string
  participantIds: string[]
  items: DraftItem[]
  nextKey: number
  isPersonal: boolean
  /** The payer's own exchange rate as typed (PREPAID_NO_WALLET only). */
  ownRate: string
  /** A top-up made at the till; see WizardState. */
  topUpAmount: string
  topUpRate: string
  topUpPaid: string
  manualOpen: boolean
  manualRate: string
  receiptTotal: string
  receiptTouched: boolean
  /** Epoch ms the draft was parked. */
  savedAt: number
}

/**
 * One key per form instance: an edit detour must not come back as the next
 * new expense, which is what a group-wide key used to do.
 */
export function draftKey(groupId: string, expenseId?: string): string {
  return `${PREFIX}${groupId}:${expenseId ?? 'new'}`
}

export function serializeDraft(
  draft: Omit<ExpenseDraft, 'savedAt' | 'v'>,
  now: number,
): string {
  return JSON.stringify({
    ...draft,
    v: DRAFT_VERSION,
    savedAt: now,
  } satisfies ExpenseDraft)
}

export function parseDraft(
  raw: string | null,
  now: number,
): ExpenseDraft | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const draft = parsed as Partial<ExpenseDraft>
  if (draft.v !== DRAFT_VERSION) return null
  if (typeof draft.savedAt !== 'number') return null
  if (now - draft.savedAt >= DRAFT_TTL_MS) return null
  if (
    !Array.isArray(draft.items) ||
    !Array.isArray(draft.extraFunding) ||
    !Array.isArray(draft.participantIds) ||
    typeof draft.funding !== 'object' ||
    draft.funding === null
  ) {
    return null
  }
  return draft as ExpenseDraft
}
