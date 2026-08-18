'use server'

import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import {
  CHAT_HISTORY_CAP,
  CHAT_HISTORY_PAGE_SIZE,
  appendChatMessagesSchema,
  sessionMemorySchema,
  sessionTitleFrom,
  type ChatMessageRow,
  type PersistableMessage,
} from '@/lib/chat-history'

/** Title for a first batch that carries no user text (e.g. a scan-first
 *  session) — localized rename is one tap away. */
const NEW_SESSION_FALLBACK_TITLE = '새 대화'

/** The adopted session id, returned so a NEW chat's client learns which
 *  row its lazy first batch created. (A named interface rather than an
 *  inline object type: persist-flush.test.ts's source-shape safeguard
 *  brace-balances from the first `{` after the function marker, and an
 *  inline `{ sessionId: string }` in the signature would be it.) */
export interface AppendChatResult {
  sessionId: string
}

/** Opaque page cursor — the (createdAt, id) tuple of the OLDEST row already
 *  shown, so the next page can ask for everything strictly before it. */
export interface ChatHistoryCursor {
  createdAt: string
  id: string
}

export interface FetchChatHistoryResult {
  rows: ChatMessageRow[]
  nextCursor: ChatHistoryCursor | null
  atCap: boolean
}

/**
 * Append a batch of persisted chat bubbles for the ACTING member (never a
 * client-supplied member id — `requireGroupMember` is the only source of
 * `memberId`, same gate every other group-scoped mutation uses), then trim
 * that member's history back down to `CHAT_HISTORY_CAP` rows.
 *
 * Fire-and-forget from the client (`void appendChatMessages(...)`, no await
 * in the render path) — so this never throws for an ordinary caller. A
 * malformed batch (client shape is never trusted) is silently dropped
 * rather than surfaced, since there is no error channel wired to a
 * fire-and-forget call; `entries` itself is otherwise plan-shaped
 * `PersistableMessage[]` produced only by `toPersistable`.
 *
 * Double-persist fix (docs/SOLVED.md 2026-08-14 "Chat-indicator-currency T1
 * review round 1"): `ChatTranscript.tsx`'s `retryPersist` can resend a
 * batch whose rows already landed here — the client only learns the
 * ORIGINAL call rejected (a timeout, a dropped connection after commit,
 * this function throwing between the insert and the trim), never whether
 * the insert itself actually committed. Two halves close that:
 * - `insert` + `trim` run inside ONE `$transaction`, so a throw from EITHER
 *   half (e.g. the trim) rolls back the insert too — no half-committed
 *   batch a retry could partially duplicate. Interactive `$transaction`
 *   note: Prisma's default 5s execution timeout / 2s connection-acquire
 *   `maxWait` are ample for this call's actual size (<=20 rows in, a
 *   findMany + deleteMany trim), and `src/lib/prisma.ts`'s `@prisma/adapter-pg`
 *   checks out ONE physical connection for the whole callback, which is
 *   compatible with a transaction-mode pooler (a single BEGIN..COMMIT is
 *   exactly what that mode hands one backend connection for) — but
 *   `prisma.config.ts` documents `DATABASE_URL` as a pooled connection in
 *   production, so re-check connection affinity if this ever needs a
 *   custom `timeout`/`maxWait` or the batch size grows well past today's
 *   `MAX_ENTRIES_PER_CALL`/`CHAT_HISTORY_CAP`.
 * - `createMany`'s `skipDuplicates: true`, paired with the
 *   `(memberId, clientMessageId)` unique index, makes a full retry of a
 *   batch that DID commit a no-op for the rows that already exist — the
 *   transaction still resolves successfully (0 new rows for those, the
 *   trim still runs), and the client correctly marks the batch 'saved'.
 *   CAVEAT: Prisma's Postgres `skipDuplicates` compiles to an UNTARGETED
 *   `INSERT ... ON CONFLICT DO NOTHING` (no `ON CONFLICT (columns)` target)
 *   — it swallows a conflict on ANY unique/exclusion constraint on this
 *   table, not just `(memberId, clientMessageId)`. If `ChatMessage` ever
 *   gains another unique constraint, a violation of THAT constraint would
 *   also be silently dropped here instead of surfacing as an error; revisit
 *   this call (and probably scope the insert down, e.g. per-kind) before
 *   adding one.
 *
 * Known residual (not a duplicate, a timestamp quirk): if enough OTHER
 * messages get persisted and trim the cap between the original failed
 * attempt and the user tapping retry, this member's row COUNT can already
 * have pushed the original row out via `CHAT_HISTORY_CAP` trimming before
 * retry runs — in the vanishingly rare case that happens, `skipDuplicates`
 * has nothing left to skip (the old row is gone), so the retry inserts a
 * fresh row with today's `createdAt` rather than the original send time.
 * Content-correct, no duplicate ever coexists, only the timestamp moves —
 * not worth guarding against given `CHAT_HISTORY_CAP` is 500 and a single
 * append batch is capped at `MAX_ENTRIES_PER_CALL` (20).
 */
export async function appendChatMessages(
  groupId: string,
  entries: PersistableMessage[],
  /**
   * R2b sessions: the thread these rows belong to. `null` = a NEW chat —
   * the session row is created here, lazily, on this first persisted
   * batch (auto-titled from the batch's first user text), and its id is
   * returned so the client adopts it. An id that does not belong to the
   * acting member drops the batch — same privacy law as every read.
   */
  sessionId: string | null = null,
  /** The dialogue memory snapshot riding this batch (R2b) — persisted on
   *  the session in the SAME transaction as the rows, so memory and
   *  transcript can never disagree, and there is exactly ONE history
   *  write path for the persist indicator to reflect. */
  memory: unknown = undefined,
): Promise<AppendChatResult | undefined> {
  const { member } = await requireGroupMember(groupId)

  const parsed = appendChatMessagesSchema.safeParse(entries)
  if (!parsed.success) {
    return undefined
  }

  return await prisma.$transaction(async (tx) => {
    let session: { id: string }
    if (sessionId === null) {
      const firstUserText = parsed.data.find(
        (e) => e.role === 'user' && e.kind === 'text',
      )?.payload as { text?: string } | undefined
      const title =
        sessionTitleFrom(
          typeof firstUserText?.text === 'string' ? firstUserText.text : '',
        ) || NEW_SESSION_FALLBACK_TITLE
      session = await tx.chatSession.create({
        data: { groupId, memberId: member.id, title },
        select: { id: true },
      })
    } else {
      const owned = await tx.chatSession.findFirst({
        where: { id: sessionId, groupId, memberId: member.id },
        select: { id: true },
      })
      if (!owned) return undefined
      session = owned
      await tx.chatSession.update({
        where: { id: owned.id },
        data: { lastMessageAt: new Date() },
      })
    }

    if (memory !== undefined) {
      const parsedMemory = sessionMemorySchema.safeParse(memory)
      if (parsedMemory.success) {
        await tx.chatSession.update({
          where: { id: session.id },
          data: { memory: parsedMemory.data },
        })
      }
    }

    await tx.chatMessage.createMany({
      data: parsed.data.map((entry) => ({
        groupId,
        memberId: member.id,
        sessionId: session.id,
        role: entry.role,
        kind: entry.kind,
        payload: entry.payload,
        clientMessageId: entry.clientMessageId,
      })),
      skipDuplicates: true,
    })

    // Trim: findMany(select id, skip: cap) + deleteMany(id in) rather than a
    // raw-SQL OFFSET subquery — portable, and the id selection is exactly
    // Prisma's own OFFSET semantics (ORDER BY createdAt DESC, id DESC OFFSET
    // cap), so there is nothing bespoke here to unit-test separately. Two
    // concurrent appends can each observe <=cap rows and both skip
    // trimming, leaving briefly >cap rows — harmless; the next append's
    // trim catches up.
    const excess = await tx.chatMessage.findMany({
      where: { groupId, memberId: member.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: CHAT_HISTORY_CAP,
      select: { id: true },
    })
    if (excess.length > 0) {
      await tx.chatMessage.deleteMany({
        where: { id: { in: excess.map((row) => row.id) } },
      })
    }

    return { sessionId: session.id }
  })
}

/**
 * Newest page of the ACTING member's history, below `cursor` (exclusive).
 * Deliberately takes no `memberId` — accepting one from the caller would let
 * a member read another member's history by id, defeating the whole point
 * of per-member privacy. The member is always resolved server-side via
 * `requireGroupMember`, and every query below is scoped by its id.
 */
export async function fetchChatHistory(
  groupId: string,
  cursor?: ChatHistoryCursor,
  /** R2b: scope to one session; omitted = the member's whole history
   *  (legacy shape, still what the pre-session client sends). */
  sessionId?: string,
): Promise<FetchChatHistoryResult> {
  const { member } = await requireGroupMember(groupId)
  const sessionFilter = sessionId !== undefined ? { sessionId } : {}

  const cursorCreatedAt = cursor ? new Date(cursor.createdAt) : null
  const cursorFilter =
    cursor && cursorCreatedAt
      ? {
          OR: [
            { createdAt: { lt: cursorCreatedAt } },
            { createdAt: cursorCreatedAt, id: { lt: cursor.id } },
          ],
        }
      : {}

  const [rows, total] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { groupId, memberId: member.id, ...sessionFilter, ...cursorFilter },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CHAT_HISTORY_PAGE_SIZE + 1,
      select: {
        id: true,
        groupId: true,
        role: true,
        kind: true,
        payload: true,
        createdAt: true,
      },
    }),
    prisma.chatMessage.count({
      where: { groupId, memberId: member.id, ...sessionFilter },
    }),
  ])

  const hasMore = rows.length > CHAT_HISTORY_PAGE_SIZE
  const page = hasMore ? rows.slice(0, CHAT_HISTORY_PAGE_SIZE) : rows
  const oldest = page[page.length - 1]

  return {
    rows: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    nextCursor:
      hasMore && oldest
        ? { createdAt: oldest.createdAt.toISOString(), id: oldest.id }
        : null,
    atCap: total === CHAT_HISTORY_CAP,
  }
}
