import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { toPersistable, type PersistableMessage } from '@/lib/chat-history'
import type { TranscriptMessage } from './ChatTranscript'
import { createPersistTracker, scopeClientMessageId } from './persist-status'

/**
 * Wiring tests for `ChatTranscript.tsx`'s `flushBatch`/`retryPersist`/
 * `queuePersist`, sharing as much REAL code as this project's `environment:
 * 'node'` vitest config (see vitest.config.ts) allows.
 *
 * Review round 2: round 1's version was a self-contained replica that
 * hand-copied the `clientMessageId` scoping as an inline string template —
 * it could not have caught a regression in the actual scoping logic, or in
 * `toPersistable`. This version instead calls:
 * - `toPersistable` (chat-history.ts) — the REAL function.
 * - `scopeClientMessageId` (persist-status.ts) — the REAL function
 *   `ChatTranscript.tsx`'s `queuePersist` calls (extracted there specifically
 *   so this file can share it — see persist-status.ts's doc comment).
 * - `createPersistTracker` — the REAL tracker.
 *
 * What still CANNOT be shared, and why:
 * - `ChatTranscript.tsx` itself: a 'use client' component. Importing its
 *   VALUES (not just the `TranscriptMessage` TYPE, which is erased at
 *   compile time and never touches this file's runtime) would drag in
 *   react/next-intl and the whole component tree — this project has no
 *   React Testing Library / jsdom wired into vitest (`environment: 'node'`,
 *   `src/**\/*.test.ts` only), so rendering it isn't an option here. `flushBatch`
 *   is therefore still hand-written to `ChatTranscript.tsx`'s real shape
 *   (same guard order, same resolve/reject calls) rather than imported.
 * - `appendChatMessages` (chat-history-actions.ts): a `'use server'` Prisma
 *   call. No test database is wired into vitest — that's what the
 *   Playwright e2e suite + the `fairsplit_e2e` database exist for, and this
 *   fix round separately proved the migration applies via
 *   `prisma migrate deploy`/`migrate status` against the local dev DB (see
 *   task-1-report.md), which is a one-time manual proof, not a repeatable
 *   test. The stand-in `makeServer` below models `skipDuplicates` +
 *   single-transaction commit semantics instead, and is backed by the
 *   source-text safeguard test at the bottom of this file so a regression
 *   that REMOVES either real safeguard still fails a test even though the
 *   stand-in itself can't detect it.
 */
function makeServer() {
  const rows = new Map<string, PersistableMessage>() // clientMessageId -> row
  // One-shot failure switch: armed before a call, consumed by it. Models a
  // TRANSIENT failure (the transaction commits, then the response is lost —
  // a dropped connection, a function timeout) rather than a permanently
  // broken server, so a later retry of the SAME call can genuinely succeed.
  let armedToFailAfterCommit = false
  return {
    rows,
    armNextCallToFailAfterCommit() {
      armedToFailAfterCommit = true
    },
    async appendChatMessages(entries: readonly PersistableMessage[]): Promise<void> {
      // createMany({ skipDuplicates: true }) inside one $transaction: every
      // new clientMessageId lands, an already-present one is silently
      // skipped — and it all happens as one atomic unit.
      for (const entry of entries) {
        if (!rows.has(entry.clientMessageId)) {
          rows.set(entry.clientMessageId, entry)
        }
      }
      if (armedToFailAfterCommit) {
        armedToFailAfterCommit = false
        // The transaction above already committed — this models the
        // response being lost afterward, which is exactly what the client
        // sees as a rejected `appendChatMessages` call even though the rows
        // DID land.
        throw new Error('connection lost after commit')
      }
    },
  }
}

/** A faithful copy of `ChatTranscript.tsx`'s `flushBatch`: looks up each
 *  id's persisted payload, rejects (not leaves 'pending') when there's
 *  nothing to send, otherwise calls the server and resolves/rejects the
 *  WHOLE batch together. Exactly one of these per test — the original
 *  microtask flush AND `retryPersist` both call this SAME reference, same
 *  as `ChatTranscript.tsx`'s single `flushBatch` `useCallback`. */
function makeFlushBatch(
  tracker: ReturnType<typeof createPersistTracker>,
  persistedById: Map<string, PersistableMessage>,
  server: ReturnType<typeof makeServer>,
) {
  return (ids: readonly string[]) => {
    const persisted = ids
      .map((id) => persistedById.get(id))
      .filter((p): p is PersistableMessage => p !== undefined)
    if (persisted.length === 0) {
      tracker.reject(ids)
      return
    }
    void server
      .appendChatMessages(persisted)
      .then(() => tracker.resolve(ids))
      .catch(() => tracker.reject(ids))
  }
}

/** Builds one `persistedById` entry the SAME way `ChatTranscript.tsx`'s
 *  `queuePersist` does: the REAL `toPersistable` then the REAL
 *  `scopeClientMessageId` — never a hand-rolled clientMessageId string. */
function persistedEntryFor(sessionId: string, message: TranscriptMessage): PersistableMessage {
  const persistable = toPersistable(message)
  if (persistable === null) {
    throw new Error('test fixture message must be persistable')
  }
  return scopeClientMessageId(sessionId, persistable)
}

describe('flushBatch/retryPersist wiring (double-persist fix)', () => {
  it('retry after a reject whose rows already landed does NOT duplicate them — status ends saved', async () => {
    const server = makeServer()
    const tracker = createPersistTracker()
    const persistedById = new Map<string, PersistableMessage>()
    const sessionId = 'session-abc'
    const message: TranscriptMessage = { id: 'user-1', role: 'user', kind: 'text', text: 'hello' }
    persistedById.set(message.id, persistedEntryFor(sessionId, message))
    const flushBatch = makeFlushBatch(tracker, persistedById, server)

    // --- original microtask flush: commits, then the response is lost ---
    server.armNextCallToFailAfterCommit()
    tracker.enqueue([message.id])
    flushBatch([message.id])
    await vi.waitFor(() => expect(tracker.statusOf(message.id)).toBe('failed'))

    expect(server.rows.size).toBe(1) // the row DID land

    // --- user taps retry (Task 2's button -> retryPersist) — SAME
    // flushBatch reference, no second write path ---
    tracker.retry(message.id, flushBatch)
    await vi.waitFor(() => expect(tracker.statusOf(message.id)).toBe('saved'))

    // FIXED: skipDuplicates means the retry inserted nothing new.
    expect(server.rows.size).toBe(1)
    const [[clientMessageId, row]] = Array.from(server.rows.entries())
    expect(clientMessageId).toBe('session-abc:user-1') // proves the REAL scoping ran
    expect(row).toEqual({
      role: 'user',
      kind: 'text',
      clientMessageId: 'session-abc:user-1',
      payload: { text: 'hello' },
    })
  })

  it('retry funnels through the exact SAME flushBatch reference as the original send — no second write path', async () => {
    const server = makeServer()
    const tracker = createPersistTracker()
    const persistedById = new Map<string, PersistableMessage>()
    const sessionId = 'session-abc'
    const message: TranscriptMessage = { id: 'user-1', role: 'user', kind: 'text', text: 'hello' }
    persistedById.set(message.id, persistedEntryFor(sessionId, message))

    const flushBatch = vi.fn(makeFlushBatch(tracker, persistedById, server))

    server.armNextCallToFailAfterCommit()
    tracker.enqueue([message.id])
    flushBatch([message.id])
    await vi.waitFor(() => expect(tracker.statusOf(message.id)).toBe('failed'))

    // ChatTranscript's retryPersist calls `persistTracker.retry(messageId,
    // flushBatch)` with the SAME useCallback reference — reproduced here by
    // passing the identical `flushBatch` spy, not a second implementation.
    tracker.retry(message.id, flushBatch)
    await vi.waitFor(() => expect(tracker.statusOf(message.id)).toBe('saved'))

    expect(flushBatch).toHaveBeenCalledTimes(2)
    expect(flushBatch).toHaveBeenNthCalledWith(1, [message.id])
    expect(flushBatch).toHaveBeenNthCalledWith(2, [message.id])
  })

  it('flushBatch rejects (not stuck pending) when it has nothing persisted to send — the stuck-pending trap fix', () => {
    const tracker = createPersistTracker()
    const persistedById = new Map<string, PersistableMessage>() // empty
    const server = makeServer()
    const flushBatch = makeFlushBatch(tracker, persistedById, server)

    // Mirrors queuePersist: enqueue() always runs before flushBatch() is
    // called, so a silent no-op inside flushBatch would leave 'user-1'
    // 'pending' forever with no resolve/reject ever coming.
    tracker.enqueue(['user-1'])
    flushBatch(['user-1'])

    expect(tracker.statusOf('user-1')).toBe('failed')
  })

  it('two independent batches each dedup against the server on their own retry, without affecting each other', async () => {
    const server = makeServer()
    const tracker = createPersistTracker()
    const persistedById = new Map<string, PersistableMessage>()
    const sessionId = 'session-abc'
    const messageA: TranscriptMessage = { id: 'user-1', role: 'user', kind: 'text', text: 'hello' }
    const messageB: TranscriptMessage = { id: 'user-2', role: 'user', kind: 'text', text: 'world' }
    persistedById.set(messageA.id, persistedEntryFor(sessionId, messageA))
    persistedById.set(messageB.id, persistedEntryFor(sessionId, messageB))
    const flushBatch = makeFlushBatch(tracker, persistedById, server)

    server.armNextCallToFailAfterCommit()
    tracker.enqueue([messageA.id])
    flushBatch([messageA.id])
    await vi.waitFor(() => expect(tracker.statusOf(messageA.id)).toBe('failed'))

    // batch B lands cleanly on the first try, independent of batch A's retry
    tracker.enqueue([messageB.id])
    flushBatch([messageB.id])
    await vi.waitFor(() => expect(tracker.statusOf(messageB.id)).toBe('saved'))

    tracker.retry(messageA.id, flushBatch)
    await vi.waitFor(() => expect(tracker.statusOf(messageA.id)).toBe('saved'))

    expect(server.rows.size).toBe(2)
    expect(new Set(server.rows.keys())).toEqual(
      new Set(['session-abc:user-1', 'session-abc:user-2']),
    )
  })
})

describe('appendChatMessages server-side safeguards (chat-history-actions.ts)', () => {
  // No test database is wired into this project's vitest config
  // (`environment: 'node'`, no Prisma/Postgres test container) — a genuine
  // proof that `skipDuplicates` + `$transaction` behave correctly against
  // Postgres already exists (this fix round applied the migration to the
  // local dev DB and confirmed it with `migrate deploy`/`migrate status`,
  // see task-1-report.md), but that's a one-time manual check, not a
  // repeatable regression test, and a full Postgres-backed integration test
  // is out of scope for this round's vitest gate (that's what the
  // Playwright e2e suite exists for).
  //
  // This is the cheapest REAL regression guard available without adding DB
  // infrastructure to the unit-test gate: it reads the ACTUAL action file's
  // source at test time (not a hardcoded copy pasted into this file) and
  // fails the moment either safeguard is deleted, moved off the relevant
  // call, or `skipDuplicates` flips to `false` — exactly the "someone
  // deletes the fix in a refactor and nothing here notices" gap the review
  // flagged. It cannot prove RUNTIME correctness (a source string doesn't
  // execute) — only presence and rough shape — but that is a meaningfully
  // higher bar than the stand-in `makeServer` above could offer on its own.
  it('createMany uses skipDuplicates:true (with clientMessageId) inside one $transaction', () => {
    const actionsPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      'chat-history-actions.ts',
    )
    const source = readFileSync(actionsPath, 'utf8')

    // Scope every check to the `appendChatMessages` FUNCTION BODY, not the
    // whole file — `fetchChatHistory` below it legitimately calls
    // `prisma.chatMessage.findMany`/`.count` outside any transaction (it's
    // a plain read), which would otherwise false-flag the "trim must run
    // through `tx`, not the bare `prisma` client" check below.
    const fnBody = extractFunctionBody(source, 'export async function appendChatMessages(')

    expect(fnBody).toMatch(/prisma\.\$transaction\(\s*async\s*\(\s*tx\s*\)/)

    // Bracket-balanced extraction rather than a `[\s\S]*?\}\)` regex — the
    // real call NESTS another `}))`  (the `data: parsed.data.map(...)`
    // argument) before its own close, which a lazy regex stops at early.
    const createManyCall = extractBalancedCall(fnBody, 'tx.chatMessage.createMany(')
    expect(createManyCall).toMatch(/clientMessageId:\s*entry\.clientMessageId/)
    expect(createManyCall).toMatch(/skipDuplicates:\s*true/)

    // The trim (findMany + deleteMany) must run through the SAME `tx`, not
    // the top-level `prisma` client — otherwise it would silently escape
    // the transaction the fix depends on.
    expect(fnBody).toMatch(/tx\.chatMessage\.findMany/)
    expect(fnBody).toMatch(/tx\.chatMessage\.deleteMany/)
    expect(fnBody).not.toMatch(/prisma\.chatMessage\.(createMany|findMany|deleteMany)/)
  })
})

/** Extracts `source`'s substring from `marker` (ending in an opening `(`)
 *  through its MATCHING close, tracking `(`/`{`/`[` depth rather than a
 *  regex — robust to the nested `}))` a Prisma `createMany({ data: x.map(...) })`
 *  call always has. Throws if `marker` isn't found or brackets never
 *  balance (the latter would mean the source itself doesn't parse). */
function extractBalancedCall(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  if (markerIndex === -1) {
    throw new Error(`expected to find "${marker}" in the action file's source`)
  }
  const openIndex = markerIndex + marker.length - 1 // the '(' itself
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return source.slice(markerIndex, i + 1)
    }
  }
  throw new Error(`unbalanced brackets scanning "${marker}"`)
}

/** Extracts a function's full body: `signatureMarker` (e.g.
 *  `'export async function foo('`) through the MATCHING close of the
 *  first `{` found after it — i.e. the function's own body brace, skipped
 *  past its parameter list and return-type annotation, tracking `{`/`}`
 *  depth only (parens in the signature don't confuse it, since counting
 *  starts at the body's opening brace, not the marker itself). */
function extractFunctionBody(source: string, signatureMarker: string): string {
  const markerIndex = source.indexOf(signatureMarker)
  if (markerIndex === -1) {
    throw new Error(`expected to find "${signatureMarker}" in the action file's source`)
  }
  const braceStart = source.indexOf('{', markerIndex)
  if (braceStart === -1) {
    throw new Error(`no function body found after "${signatureMarker}"`)
  }
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(markerIndex, i + 1)
    }
  }
  throw new Error(`unbalanced braces scanning function body after "${signatureMarker}"`)
}
