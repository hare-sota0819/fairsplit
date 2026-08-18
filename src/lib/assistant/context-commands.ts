/**
 * Reference resolution — which saved expense "아까 그 술값" means.
 *
 * Pure, like every other module under src/lib/assistant and src/lib/chat-parse:
 * the caller hands in the recent expenses it already loaded, the current
 * instant, and the DEVICE's timezone offset. No Prisma, no `new Date()`, no
 * server clock. Day boundaries follow src/lib/datetime.ts's rule exactly
 * (`offsetMinutes` as `Date#getTimezoneOffset()` reports it — minutes WEST of
 * UTC, so KST is -540), because "today" has to mean the day the person typing
 * is standing in, not the day a Vercel box in UTC is having (the Phase 3C
 * bug).
 *
 * The outcome is deliberately three-valued. Exactly one survivor is the only
 * case the UI may act on directly; 'many' and 'none' are ASKS, not failures —
 * the disambiguation card is the designed behaviour, and it is what makes
 * "never a confidently wrong edit" achievable at all.
 */

import { CATEGORY_SYNONYMS } from './lexicons/categories'
import { toLocalDateKey } from '../datetime'
import { isHangulCodePoint } from '../chat-parse/engine/tokenizer'
import type { TimeWindow } from '../chat-parse/parsers/reference'

/** Just enough of an expense to match a reference and describe a candidate —
 *  the caller (T10) projects its Prisma rows onto this. `amountMinor` is
 *  integer minor units, like every amount in this repo. */
export interface RecentExpenseLite {
  id: string
  note: string
  amountMinor: bigint
  currency: string
  timestamp: Date
  participantIds: string[]
  payerId: string
  cancelled: boolean
}

export interface ReferenceResolution {
  outcome: 'one' | 'many' | 'none'
  /** 'one' → the single match; 'many' → the newest 5 of the matches; 'none' →
   *  the newest 5 expenses overall, as the "is it one of these?" fallback. */
  candidates: RecentExpenseLite[]
}

/** How many candidates a disambiguation/fallback list shows. */
const CANDIDATE_LIMIT = 5

/** How far back a bare `그거`/`that` reaches. */
const RECENT_LIMIT = 20

const MILLIS_PER_DAY = 86_400_000

/**
 * Every surface that names the keyword's category: the keyword itself, plus
 * every member of each synonym group it belongs to.
 *
 * Group membership is decided by PREFIX, in both directions: `술값` finds the
 * drinks group through `술` (Korean compounds put the category first, so
 * `술값`.startsWith(`술`) holds while `기술` — which merely contains 술 —
 * does not), and `술` finds it through any group entry that starts with it.
 */
export function expandKeyword(keyword: string): string[] {
  const needle = keyword.toLowerCase()
  const terms = new Set<string>([needle])
  for (const group of CATEGORY_SYNONYMS) {
    const hit = group.some((term) => {
      const t = term.toLowerCase()
      return needle.startsWith(t) || t.startsWith(needle)
    })
    if (!hit) continue
    for (const term of group) terms.add(term.toLowerCase())
  }
  return [...terms]
}

const LATIN_ONLY = /^[a-z0-9]+$/

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether one category surface appears in a note.
 *
 * Latin matches on a WORD boundary, so `gas` cannot fire inside "Vegas".
 * Korean has no word boundary to use, so it gets the closest honest
 * equivalent: the term must start a HANGUL RUN — the character right before
 * it must not itself be Hangul. That is what separates 술값/술 마심 (술 starts
 * the run) from 미술관/기술/예술의전당 (술 sits mid-word), a distinction a plain
 * substring cannot make and one that matters: a single unrelated note
 * containing 미술관 would otherwise be the ONE survivor of "아까 그 술값" and
 * get edited without ever being questioned.
 *
 * A term may still end mid-word (술값, 술자리, 커피값) — Korean compounds and
 * josa attach on the RIGHT, so requiring a clean end would reject the normal
 * case, not the trap.
 */
function termInNote(term: string, note: string): boolean {
  if (LATIN_ONLY.test(term)) {
    return new RegExp(`\\b${escapeRegex(term)}\\b`, 'i').test(note)
  }
  const haystack = note.toLowerCase()
  let at = haystack.indexOf(term)
  while (at !== -1) {
    const before = at === 0 ? undefined : haystack.codePointAt(at - 1)
    if (before === undefined || !isHangulCodePoint(before)) return true
    at = haystack.indexOf(term, at + 1)
  }
  return false
}

/** Whether `note` names the same thing the reference keyword did. */
export function noteMatchesKeyword(note: string, keyword: string): boolean {
  return expandKeyword(keyword).some((term) => termInNote(term, note))
}

function newestFirst(expenses: readonly RecentExpenseLite[]): RecentExpenseLite[] {
  return [...expenses].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
}

/**
 * The window filter. `today`/`yesterday` compare DEVICE-LOCAL calendar days
 * (an expense saved at 01:00 KST belongs to that Korean day even though it is
 * still the previous day in UTC); `recent` is not a day rule at all but a
 * depth limit — the newest 20 — because `그거`/`that` says nothing about when.
 */
function inWindow(
  expenses: readonly RecentExpenseLite[],
  window: TimeWindow,
  now: Date,
  tzOffsetMinutes: number,
): RecentExpenseLite[] {
  if (window === 'recent') return expenses.slice(0, RECENT_LIMIT)
  const reference =
    window === 'today' ? now : new Date(now.getTime() - MILLIS_PER_DAY)
  const day = toLocalDateKey(reference, tzOffsetMinutes)
  return expenses.filter(
    (expense) => toLocalDateKey(expense.timestamp, tzOffsetMinutes) === day,
  )
}

/**
 * Which expense the reference points at.
 *
 * Order of business, and each step's reason:
 *  1. Cancelled expenses are dropped — always, with no exception, including
 *     from the 'none' fallback list. There is nothing left to edit on one, and
 *     offering it as a candidate would only produce a dead end.
 *  2. The time window narrows by device-local day (or depth, for `recent`).
 *  3. The keyword narrows by note, through the category synonyms — this is
 *     what makes "술값" find a note that says "이자카야".
 *  4. Exactly one survivor is a match. Anything else is a question: 'many'
 *     offers the newest few survivors, 'none' offers the newest few expenses
 *     overall (the user's reference found nothing, so narrowing further would
 *     just hand back an empty list).
 */
export function resolveReference(
  ref: { window: TimeWindow; keyword: string | null },
  expenses: RecentExpenseLite[],
  now: Date,
  tzOffsetMinutes: number,
): ReferenceResolution {
  const keyword = ref.keyword
  const live = newestFirst(expenses.filter((expense) => !expense.cancelled))
  const windowed = inWindow(live, ref.window, now, tzOffsetMinutes)
  const matched =
    keyword === null
      ? windowed
      : windowed.filter((expense) => noteMatchesKeyword(expense.note, keyword))

  if (matched.length === 1) return { outcome: 'one', candidates: matched }
  if (matched.length > 1) {
    return { outcome: 'many', candidates: matched.slice(0, CANDIDATE_LIMIT) }
  }
  return { outcome: 'none', candidates: live.slice(0, CANDIDATE_LIMIT) }
}
