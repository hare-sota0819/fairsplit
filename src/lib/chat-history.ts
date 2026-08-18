import { z } from 'zod'
import type { TranscriptMessage } from '@/app/groups/[groupId]/ChatTranscript'

/**
 * Persistent per-member chat history — pure helpers shared by the server
 * actions (`chat-history-actions.ts`) and, later, `ChatTranscriptProvider`
 * (Task 2). Owner decision (docs/superpowers/plans/2026-08-13-chat-history.md):
 * PRIVATE per-member-per-group history, capped at the newest
 * `CHAT_HISTORY_CAP` rows per member; trimming is silent except for a
 * top-of-history retention notice once the cap is reached.
 */

/** Newest rows kept per member per group; older rows are trimmed on write. */
export const CHAT_HISTORY_CAP = 500

/** Page size for `fetchChatHistory`. */
export const CHAT_HISTORY_PAGE_SIZE = 50

/** Per-call guardrails on `appendChatMessages` — the client shape is never
 *  trusted, so both the batch size and every free-text field are capped. */
const MAX_ENTRIES_PER_CALL = 20
const MAX_TEXT_LENGTH = 2000
const MAX_IMAGE_PATH_LENGTH = 500
const MAX_ANSWER_LINES = 20
const MAX_ANSWER_KEY_LENGTH = 200
const MAX_ANSWER_VALUE_LENGTH = 200
const MAX_SAVED_FIELD_LENGTH = 200
/** `ChatTranscript.tsx` scopes this to `<per-mount session token>:<message
 *  id>` (e.g. `user-1`/`assistant-2` counters restart at 0 every reload, so
 *  the bare counter alone would collide across sessions) — generous cap,
 *  never trusted from the client. See `ChatMessage.clientMessageId` in
 *  schema.prisma for the dedup this feeds. */
const MAX_CLIENT_MESSAGE_ID_LENGTH = 200

// --- Payload shapes -------------------------------------------------------
//
// One zod schema per persisted `kind`, reused in both directions: validating
// an incoming `appendChatMessages` batch (never trust the client shape) and
// safe-parsing a DB row's `payload` JSON back out in `fromPersistable`
// (drops rows whose payload doesn't match — forward/backward compat with
// renamed/removed fields).

const answerLineSchema = z.object({
  key: z.string().min(1).max(MAX_ANSWER_KEY_LENGTH),
  values: z
    .record(z.string(), z.union([z.string().max(MAX_ANSWER_VALUE_LENGTH), z.number()]))
    .optional(),
})

const textPayloadSchema = z.object({
  text: z.string().max(MAX_TEXT_LENGTH),
})

// Money never floats, but `receiptTotal`/`title` here are PRE-FORMATTED
// display strings handed down from the client (already localized/rounded
// for the bubble that was actually shown), not amounts to compute with —
// they are stored as-is, verbatim, same as the live `saved` bubble renders.
const imagePayloadSchema = z.object({
  imagePath: z.string().max(MAX_IMAGE_PATH_LENGTH).nullable(),
  text: z.string().max(MAX_TEXT_LENGTH).nullable(),
})

const answerPayloadSchema = z.object({
  lines: z.array(answerLineSchema).min(1).max(MAX_ANSWER_LINES),
})

const savedPayloadSchema = z.object({
  title: z.string().max(MAX_SAVED_FIELD_LENGTH).nullable(),
  receiptTotal: z.string().max(MAX_SAVED_FIELD_LENGTH).nullable(),
})

/**
 * The four persistable kinds (plan "What persists"). `card`/`scanning`/
 * `recalc` TranscriptMessage kinds are never representable here — they are
 * either live-callback-only or server-derived, so `toPersistable` returns
 * `null` for them instead of a variant existing to hold them.
 *
 * `clientMessageId` (added for the double-persist fix, docs/SOLVED.md
 * 2026-08-14 "Chat-indicator-currency T1 review round 1"): the dedup key
 * `appendChatMessages` pairs with `createMany`'s `skipDuplicates` and the
 * `(memberId, clientMessageId)` unique index, so a retried batch whose rows
 * already landed server-side (committed, then the response was lost)
 * inserts nothing a second time.
 */
export type PersistableMessage =
  | {
      role: 'user'
      kind: 'text'
      clientMessageId: string
      payload: z.infer<typeof textPayloadSchema>
    }
  | {
      role: 'user'
      kind: 'image'
      clientMessageId: string
      payload: z.infer<typeof imagePayloadSchema>
    }
  | {
      role: 'assistant'
      kind: 'answer'
      clientMessageId: string
      payload: z.infer<typeof answerPayloadSchema>
    }
  | {
      role: 'assistant'
      kind: 'saved'
      clientMessageId: string
      payload: z.infer<typeof savedPayloadSchema>
    }

const clientMessageIdSchema = z.string().min(1).max(MAX_CLIENT_MESSAGE_ID_LENGTH)

/** Validates one `appendChatMessages` batch. Exported so the action can
 *  `safeParse` the untrusted client array before it ever reaches Prisma. */
export const appendChatMessagesSchema = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({
        role: z.literal('user'),
        kind: z.literal('text'),
        clientMessageId: clientMessageIdSchema,
        payload: textPayloadSchema,
      }),
      z.object({
        role: z.literal('user'),
        kind: z.literal('image'),
        clientMessageId: clientMessageIdSchema,
        payload: imagePayloadSchema,
      }),
      z.object({
        role: z.literal('assistant'),
        kind: z.literal('answer'),
        clientMessageId: clientMessageIdSchema,
        payload: answerPayloadSchema,
      }),
      z.object({
        role: z.literal('assistant'),
        kind: z.literal('saved'),
        clientMessageId: clientMessageIdSchema,
        payload: savedPayloadSchema,
      }),
    ]),
  )
  .min(1)
  .max(MAX_ENTRIES_PER_CALL)

/** The DB row shape both `fromPersistable` and `fetchChatHistory` share.
 *  `payload` is `unknown` on purpose — it is JSON straight from Postgres,
 *  validated (not trusted) by `fromPersistable` via the schemas above. */
export interface ChatMessageRow {
  id: string
  groupId: string
  role: string
  kind: string
  payload: unknown
  createdAt: string
}

/**
 * TranscriptMessage -> PersistableMessage, or `null` when the message must
 * never be persisted:
 * - `card` (live callbacks), `scanning`, `recalc` (server-derived),
 *   `persistExplainer` (Task 2, chat-indicator-currency — the one-time
 *   device-local explainer bubble): always null, unconditionally — these
 *   kinds have no persisted representation.
 * - `answer` whose every line carries `onSelect`/`href`: a pure-chip
 *   greeting/suggestion is a PROMPT, not a record, so it is dropped whole.
 *   A MIXED answer (some plain lines, some chips) keeps only the plain
 *   lines, dropping chip lines one by one — restored history renders text,
 *   never live chips.
 *
 * Image kind (Task 2 threaded this through): `TranscriptMessage`'s 'image'
 * variant carries `imagePath: string | null` alongside the ephemeral `url`
 * (a `URL.createObjectURL` blob, per-tab and never valid after reload) — set
 * once the scan's upload succeeds (`ChatComposer.tsx`'s `handleAttach`),
 * `null` otherwise. That value is what actually persists here; a restored
 * bubble rebuilds `url` from it in `fromPersistable` below.
 *
 * `clientMessageId` is always the message's own `TranscriptMessage.id`
 * (`ChatTranscript.tsx` further scopes it to the current session before it
 * ever reaches `appendChatMessages` — see that file's doc comment — since
 * the bare `user-1`/`assistant-2` counters restart at 0 every reload and
 * would otherwise collide across two different sessions from the same
 * member).
 */
export function toPersistable(message: TranscriptMessage): PersistableMessage | null {
  switch (message.kind) {
    case 'text':
      return {
        role: 'user',
        kind: 'text',
        clientMessageId: message.id,
        payload: { text: message.text },
      }
    case 'image':
      return {
        role: 'user',
        kind: 'image',
        clientMessageId: message.id,
        payload: { imagePath: message.imagePath, text: message.text },
      }
    case 'answer': {
      const lines = message.lines
        .filter((line) => line.onSelect === undefined && line.href === undefined)
        .map((line) => ({ key: line.key, values: line.values }))
      return lines.length === 0
        ? null
        : {
            role: 'assistant',
            kind: 'answer',
            clientMessageId: message.id,
            payload: { lines },
          }
    }
    case 'saved':
      return {
        role: 'assistant',
        kind: 'saved',
        clientMessageId: message.id,
        payload: { title: message.title, receiptTotal: message.receiptTotal },
      }
    case 'card':
    case 'scanning':
    case 'recalc':
    case 'persistExplainer':
      return null
  }
}

/**
 * DB row -> TranscriptMessage, or `null` when the row can no longer be
 * rendered:
 * - unknown/malformed `kind`/`payload` (a row from a future app version, or
 *   corrupt data) — forward compat.
 * - `answer` rows: each line is kept only when `hasKey(line.key)` is true
 *   (an i18n key that was since renamed/removed must not crash old rows —
 *   the caller passes e.g. `(k) => t.has(k)`); if every line is filtered
 *   out, the whole message is dropped.
 *
 * Restored ids are prefixed `db-` so they can never collide with the
 * provider's own runtime counters (`user-1`, `assistant-2`, ...).
 *
 * Restored `image` rows synthesize `url` from `imagePath` via the signed
 * receipt-image route (`/api/receipts/image?path=...`), which 404s unless
 * the path still belongs to a SAVED expense — restored image bubbles need
 * an `onError` fallback to a static placeholder chip (Task 2). When
 * `imagePath` is null (the scan never uploaded, or was never attempted),
 * `url` is `''`, which the same `onError` fallback must also cover.
 */
export function fromPersistable(
  row: ChatMessageRow,
  hasKey: (key: string) => boolean,
): TranscriptMessage | null {
  const id = `db-${row.id}`
  switch (row.kind) {
    case 'text': {
      const parsed = textPayloadSchema.safeParse(row.payload)
      if (!parsed.success) return null
      return { id, role: 'user', kind: 'text', text: parsed.data.text }
    }
    case 'image': {
      const parsed = imagePayloadSchema.safeParse(row.payload)
      if (!parsed.success) return null
      const url =
        parsed.data.imagePath !== null
          ? `/api/receipts/image?path=${encodeURIComponent(parsed.data.imagePath)}`
          : ''
      return {
        id,
        role: 'user',
        kind: 'image',
        url,
        text: parsed.data.text,
        imagePath: parsed.data.imagePath,
      }
    }
    case 'answer': {
      const parsed = answerPayloadSchema.safeParse(row.payload)
      if (!parsed.success) return null
      const lines = parsed.data.lines.filter((line) => hasKey(line.key))
      return lines.length === 0
        ? null
        : { id, role: 'assistant', kind: 'answer', lines }
    }
    case 'saved': {
      const parsed = savedPayloadSchema.safeParse(row.payload)
      if (!parsed.success) return null
      return {
        id,
        role: 'assistant',
        kind: 'saved',
        title: parsed.data.title,
        receiptTotal: parsed.data.receiptTotal,
        groupId: row.groupId,
      }
    }
    default:
      return null
  }
}

// ===========================================================================
// Sessions (R2b, docs/PROMPT.md 2026-08-15 — reference-app-style conversation list)
// ===========================================================================

/** Longest auto-generated session title; longer first messages are cut at
 *  a word boundary where one exists. */
export const SESSION_TITLE_MAX = 30

/**
 * Rule-based auto-title from the session's FIRST user message — the
 * reference-app list behavior without a model: whitespace collapsed, trailing
 * particles/punctuation dropped, cut at a word boundary. A hand rename
 * (titleEdited) always wins over this.
 */
export function sessionTitleFrom(firstUserText: string): string {
  const collapsed = firstUserText.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return ''
  if (collapsed.length <= SESSION_TITLE_MAX) return collapsed
  const cut = collapsed.slice(0, SESSION_TITLE_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > SESSION_TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut) + '…'
}

/**
 * The dialogue layer's persisted memory (salience list + turn counter),
 * validated on the way BACK from the DB — a Json column is never trusted
 * to still hold the shape a previous deploy wrote.
 */
export const sessionMemorySchema = z.object({
  turn: z.number().int().min(0),
  salience: z.object({
    entities: z.array(
      z.object({
        kind: z.enum(['person', 'expense', 'item', 'amount']),
        id: z.string(),
        label: z.string(),
        turn: z.number().int(),
        by: z.enum(['user', 'assistant']),
      }),
    ),
  }),
})

export type SessionMemory = z.infer<typeof sessionMemorySchema>

export interface ChatSessionRow {
  id: string
  title: string
  lastMessageAt: string
}
