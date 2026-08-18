'use server'

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireGroupMember } from '@/lib/membership'
import { feedShareFor } from '@/lib/feed-share'
import { groundInterpretation } from '@/lib/assistant/interpret/ground'
import { GeminiInterpreter } from '@/lib/assistant/interpret/gemini'
import {
  NullInterpreter,
  type FallbackInterpreter,
} from '@/lib/assistant/interpret/provider'

/**
 * Server side of the chat's filtered expense queries (R2a, docs/PROMPT.md
 * 2026-08-15: "수탉과 먹은 지출을 다 보여줘"). The chat asks with the
 * filters `classify()` read out of the sentence; this answers from the
 * FULL ledger — not the composer's small recent slice — so "다 보여줘"
 * really means all of it, paged.
 *
 * Money discipline: rows return `amountMinor` as decimal STRINGS and the
 * per-currency totals are summed here as BigInt — never floats, never a
 * cross-currency sum (a JPY+KRW ledger reports one total line per
 * currency; inventing a conversion here would silently pick a rate).
 */

const filtersSchema = z.object({
  companionId: z.string().optional(),
  payerId: z.string().optional(),
  keyword: z.string().max(50).optional(),
  window: z.enum(['today', 'yesterday']).optional(),
  /** Device offset, minutes — same convention as the edit flow's
   *  tzOffsetMinutes, so day boundaries match the user's clock. */
  tzOffsetMinutes: z.number().int().min(-840).max(840),
})

export type ExpenseListFilters = z.infer<typeof filtersSchema>

export interface ExpenseListRow {
  id: string
  title: string
  amountMinor: string
  currency: string
  payerId: string
  timestampIso: string
}

export interface ExpenseListResult {
  rows: ExpenseListRow[]
  totalCount: number
  /** One entry per currency present in the FULL match set. */
  totalsByCurrency: Array<{ currency: string; sumMinor: string }>
  /** Offset cursor for the next page; null = nothing further. */
  nextOffset: number | null
}

const PAGE_SIZE = 5

export async function fetchExpenseList(
  groupId: string,
  rawFilters: ExpenseListFilters,
  offset = 0,
  /** Page size — the chat's load-more chip keeps the default 5; the desktop
   *  context panel asks for a fuller first page (capped). */
  limit = PAGE_SIZE,
): Promise<ExpenseListResult | { error: 'invalid' }> {
  await requireGroupMember(groupId)
  const parsed = filtersSchema.safeParse(rawFilters)
  if (
    !parsed.success ||
    offset < 0 ||
    !Number.isInteger(offset) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 30
  ) {
    return { error: 'invalid' }
  }
  const filters = parsed.data

  // Day boundaries on the DEVICE's clock: "어제" is the user's yesterday,
  // not the server's. tzOffsetMinutes is Date#getTimezoneOffset()'s sign
  // convention (UTC+9 → -540), so local = UTC - offset.
  let timestamp: { gte: Date; lt: Date } | undefined
  if (filters.window !== undefined) {
    const offsetMs = filters.tzOffsetMinutes * 60_000
    const nowLocal = new Date(Date.now() - offsetMs)
    const dayStartLocal = new Date(
      Date.UTC(
        nowLocal.getUTCFullYear(),
        nowLocal.getUTCMonth(),
        nowLocal.getUTCDate(),
      ),
    )
    const shiftDays = filters.window === 'yesterday' ? 1 : 0
    const start = new Date(
      dayStartLocal.getTime() - shiftDays * 86_400_000 + offsetMs,
    )
    timestamp = { gte: start, lt: new Date(start.getTime() + 86_400_000) }
  }

  const where = {
    groupId,
    cancelledAt: null,
    ...(filters.payerId !== undefined ? { payerId: filters.payerId } : {}),
    ...(filters.companionId !== undefined
      ? { participants: { some: { memberId: filters.companionId } } }
      : {}),
    ...(filters.keyword !== undefined
      ? { title: { contains: filters.keyword } }
      : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
  }

  const [totalCount, matched, page] = await Promise.all([
    prisma.expense.count({ where }),
    // Totals need the FULL match set's amounts, grouped by currency.
    prisma.expense.groupBy({
      by: ['currency'],
      where,
      _sum: { amount: true },
    }),
    prisma.expense.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        title: true,
        amount: true,
        currency: true,
        payerId: true,
        timestamp: true,
      },
    }),
  ])

  return {
    rows: page.map((e) => ({
      id: e.id,
      title: e.title,
      amountMinor: e.amount.toString(),
      currency: e.currency,
      payerId: e.payerId,
      timestampIso: e.timestamp.toISOString(),
    })),
    totalCount,
    totalsByCurrency: matched
      .map((g) => ({
        currency: g.currency,
        sumMinor: (g._sum.amount ?? 0n).toString(),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    nextOffset: offset + page.length < totalCount ? offset + page.length : null,
  }
}

// ===========================================================================
// R4 — QUERY_EXPLAIN: the per-expense breakdown of MY share ("왜 내가
// 만원이야?"). Client-invoked action (never called during render — see
// src/lib/chat-sessions.ts for the rule and the bug it pins).
// ===========================================================================

export interface MyShareRow {
  title: string
  /** My share of this expense, EXPENSE-currency minor units. */
  shareMinor: string
  currency: string
  /** Even split: how many people shared it. null = itemised. */
  evenAmong: number | null
  /** Itemised: the lines I took (name × units), capped for display. */
  items: string[]
}

const EXPLAIN_ROWS = 5

export async function fetchMyShareBreakdown(
  groupId: string,
): Promise<{ rows: MyShareRow[]; totalCount: number } | { error: 'invalid' }> {
  const { member } = await requireGroupMember(groupId)
  const expenses = await prisma.expense.findMany({
    where: {
      groupId,
      cancelledAt: null,
      participants: { some: { memberId: member.id } },
    },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: 30,
    select: {
      title: true,
      amount: true,
      currency: true,
      participants: { select: { memberId: true } },
      items: {
        select: {
          name: true,
          unitAmount: true,
          quantity: true,
          splitMode: true,
          assignments: {
            select: { memberId: true, quantity: true, amount: true },
          },
        },
      },
    },
  })

  const rows: MyShareRow[] = []
  for (const expense of expenses) {
    const share = feedShareFor(
      {
        amount: expense.amount,
        participantIds: expense.participants.map((p) => p.memberId),
        items: expense.items.map((item) => ({
          name: item.name,
          unitAmount: item.unitAmount,
          quantity: item.quantity,
          ...(item.splitMode !== null ? { splitMode: item.splitMode } : {}),
          assignees: item.assignments.map((a) => ({
            memberId: a.memberId,
            quantity: a.quantity,
            ...(a.amount !== null ? { amount: a.amount } : {}),
          })),
        })),
      },
      member.id,
    )
    if (share === null) continue
    rows.push({
      title: expense.title,
      shareMinor: share.total.toString(),
      currency: expense.currency,
      evenAmong: share.evenSplitOf?.among ?? null,
      items: share.lines
        .filter((l) => l.name !== null)
        .slice(0, 3)
        .map((l) => (l.units > 1 ? `${l.name} ×${l.units}` : (l.name as string))),
    })
    if (rows.length >= EXPLAIN_ROWS) break
  }
  return { rows, totalCount: expenses.length }
}

// ===========================================================================
// R6 — the fallback interpreter behind the seam (owner-triggered). Rules
// that make this safe (docs/handoff/C-conversation-layer.md, guards):
//  G1 every number/name below is source-grounded before anything uses it;
//  G2 the interpreter returns structure only, all math stays in the engine;
//  G3 the result only ever PREFILLS a confirm card;
//  G4 unavailable/refused/ungroundable answers become questions.
// Client-invoked action only — never called during render.
// ===========================================================================

export interface InterpretedDraft {
  amount: string | null
  currency: string
  payerId: string | null
  participantIds: string[]
  description: string | null
  /** What guard G1 stripped — non-empty means the caller should mention it. */
  rejectedCount: number
}

const INTERPRET_MIN_CONFIDENCE = 0.55

export async function interpretUtterance(
  groupId: string,
  text: string,
  context: { salientNames: string[]; locale: 'ko' | 'en'; defaultCurrency: string },
): Promise<
  | { ok: true; intent: 'expense'; draft: InterpretedDraft }
  | { ok: false; kind: 'unavailable' | 'refused' | 'lowConfidence' | 'notExpense' }
> {
  const { member } = await requireGroupMember(groupId)
  if (text.length > 500) return { ok: false, kind: 'refused' }
  const apiKey = process.env.GEMINI_API_KEY
  const interpreter: FallbackInterpreter = apiKey
    ? new GeminiInterpreter(apiKey)
    : new NullInterpreter()

  const members = await prisma.member.findMany({
    where: { groupId, leftAt: null },
    select: { id: true, name: true },
  })

  const outcome = await interpreter.interpret({
    text,
    dialogue: {
      openCardKind: null,
      salientNames: context.salientNames.slice(0, 10),
      senderId: member.id,
    },
    roster: members,
    defaultCurrency: context.defaultCurrency,
    locale: context.locale,
  })
  if (!outcome.ok) return { ok: false, kind: outcome.kind }
  if (outcome.interpretation.confidence < INTERPRET_MIN_CONFIDENCE) {
    return { ok: false, kind: 'lowConfidence' }
  }
  if (outcome.interpretation.intent !== 'expense') {
    return { ok: false, kind: 'notExpense' }
  }

  const grounded = groundInterpretation(outcome.interpretation, text, members)
  const i = grounded.interpretation
  const nameToId = new Map(members.map((m) => [m.name, m.id]))
  return {
    ok: true,
    intent: 'expense',
    draft: {
      amount: i.amount,
      currency: i.currency ?? context.defaultCurrency,
      payerId: i.payerName !== null ? (nameToId.get(i.payerName) ?? null) : null,
      participantIds: i.participantNames
        .map((n) => nameToId.get(n))
        .filter((id): id is string => id !== undefined),
      description: i.description,
      rejectedCount: grounded.rejected.length,
    },
  }
}
