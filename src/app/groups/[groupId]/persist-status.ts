import type { PersistableMessage } from '@/lib/chat-history'

/**
 * Pure status machine tracking per-message persist state for the
 * write-through chat history queue (`ChatTranscriptProvider`'s
 * `queuePersist` in `ChatTranscript.tsx`). Pure: no DB access, no I/O, no
 * React import — just observes what the caller reports. (`scopeClientMessageId`
 * below imports `PersistableMessage` as a TYPE ONLY, erased at compile time —
 * this file still never touches Prisma, fetch, or any other I/O.)
 *
 * A "batch" here is exactly the array of ids the queue flushes together in
 * one `appendChatMessages` call (`pendingRef`'s Map, collapsed to one
 * microtask flush — see `queuePersist`'s doc comment). That call has no
 * per-message result: it either resolves or rejects as a whole, so a batch
 * always transitions as one unit — `enqueue`/`resolve`/`reject` all take the
 * SAME ids array the queue used for that flush.
 *
 * `retry(messageId, reEnqueue)` re-enqueues the failed batch `messageId`
 * last belonged to via the caller-supplied `reEnqueue`, which the wiring in
 * `ChatTranscript.tsx` points back at the SAME queue path (`flushBatch`) —
 * this module never talks to `appendChatMessages` itself, so there is no
 * second write path. `reEnqueue` is taken per-call (not at construction)
 * so `createPersistTracker()` never has to close over anything React-owned
 * (e.g. a ref) at render time — `retry` only ever runs from an event
 * handler.
 *
 * Every public method swallows its own errors (including a throwing
 * subscriber or a throwing `reEnqueue`) — a status tracker must never be the
 * thing that breaks the chat surface.
 *
 * `mirrorPersistTracker` (below) is the React-free half of wiring this into
 * component state: it turns `subscribe` + `statusOf` into a plain snapshot
 * map, syncing once immediately (so a late subscriber isn't stuck showing
 * stale/empty state) and again on every transition.
 */

export type PersistStatus = 'pending' | 'saved' | 'failed'

export interface PersistTracker {
  /** Marks every id in `batchIds` 'pending' and remembers them as one batch
   *  (so a later `resolve`/`reject`/`retry` for any of these ids can find
   *  its siblings). This is the only entry point that can make a brand-new
   *  id known to the tracker. */
  enqueue(batchIds: readonly string[]): void
  /** Marks every id in `batchIds` 'saved' — ids the tracker never saw via
   *  `enqueue` are skipped (not silently adopted as new entries). */
  resolve(batchIds: readonly string[]): void
  /** Marks every id in `batchIds` 'failed' — same unknown-id skip as
   *  `resolve`. */
  reject(batchIds: readonly string[]): void
  /** Current status of one message id, or `undefined` if it was never
   *  enqueued. */
  statusOf(messageId: string): PersistStatus | undefined
  /**
   * Re-enqueues the failed batch `messageId` belongs to: marks that whole
   * batch 'pending' again and calls `reEnqueue` with the same ids — the
   * queue's own re-flush entry point (same write path as the original
   * enqueue). No-op (never throws) when `messageId` is unknown or not
   * currently 'failed'.
   */
  retry(messageId: string, reEnqueue: (batchIds: readonly string[]) => void): void
  /** Subscribes to every status transition; returns an unsubscribe
   *  function. A throwing listener never breaks the tracker or other
   *  listeners. */
  subscribe(listener: () => void): () => void
}

export function createPersistTracker(): PersistTracker {
  const statuses = new Map<string, PersistStatus>()
  const lastBatch = new Map<string, readonly string[]>()
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // A broken subscriber must never break the tracker or its siblings.
      }
    }
  }

  // Unconditional: used by `enqueue` (where making unknown ids known is the
  // whole point) and by `retry` (whose ids are always already known — they
  // came from a prior `settle` call, so re-settling them is safe).
  const settle = (batchIds: readonly string[], status: PersistStatus) => {
    try {
      for (const id of batchIds) {
        statuses.set(id, status)
        lastBatch.set(id, batchIds)
      }
      notify()
    } catch {
      // Never throw — persistence status must never block the chat surface.
    }
  }

  // Used by `resolve`/`reject`: an id the tracker never saw via `enqueue`
  // is skipped rather than silently adopted as a new 'saved'/'failed'
  // entry — those two are terminal reports on a batch that was already
  // tracked, not a way to introduce ids from outside the queue.
  const settleKnown = (batchIds: readonly string[], status: PersistStatus) => {
    try {
      let changed = false
      for (const id of batchIds) {
        if (!statuses.has(id)) continue
        statuses.set(id, status)
        lastBatch.set(id, batchIds)
        changed = true
      }
      if (changed) notify()
    } catch {
      // Never throw — persistence status must never block the chat surface.
    }
  }

  return {
    enqueue(batchIds) {
      settle(batchIds, 'pending')
    },
    resolve(batchIds) {
      settleKnown(batchIds, 'saved')
    },
    reject(batchIds) {
      settleKnown(batchIds, 'failed')
    },
    statusOf(messageId) {
      return statuses.get(messageId)
    },
    retry(messageId, reEnqueue) {
      try {
        if (statuses.get(messageId) !== 'failed') return
        const batchIds = lastBatch.get(messageId)
        if (batchIds === undefined) return
        settle(batchIds, 'pending')
        reEnqueue(batchIds)
      } catch {
        // Never throw — a failed retry attempt just leaves ids 'pending'
        // until the caller's own queue reports back via resolve/reject.
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * Mirrors a `PersistTracker` into a plain status-map snapshot for a React
 * `useState`, without this module ever importing React. Calls `onChange`
 * once IMMEDIATELY with the current snapshot (so a caller wiring this up
 * after some ids already settled — e.g. `ChatTranscriptProvider` re-running
 * its effect — doesn't sit on a stale/empty map until the next unrelated
 * transition), then again on every subsequent transition. Returns the
 * tracker's own unsubscribe function.
 *
 * @param knownIds - returns the CURRENT set of ids to include in the
 *   snapshot (a live view, e.g. reading a ref) — evaluated fresh both for
 *   the initial sync and every later notification, so ids added after this
 *   is called are still picked up.
 */
export function mirrorPersistTracker(
  tracker: PersistTracker,
  knownIds: () => Iterable<string>,
  onChange: (statuses: ReadonlyMap<string, PersistStatus>) => void,
): () => void {
  const sync = () => {
    const next = new Map<string, PersistStatus>()
    for (const id of knownIds()) {
      const status = tracker.statusOf(id)
      if (status !== undefined) next.set(id, status)
    }
    onChange(next)
  }
  sync()
  return tracker.subscribe(sync)
}

/**
 * Scopes a persisted payload's `clientMessageId` to the current mount's
 * session token before it ever reaches `appendChatMessages` (double-persist
 * fix, docs/SOLVED.md 2026-08-14 — "Chat-indicator-currency T1 review round
 * 1"): `TranscriptMessage.id` values (`user-1`/`assistant-2`, ...) restart
 * at 0 on every reload (`ChatComposer.tsx`'s `userMessageCounter`/
 * `answerMessageCounter` refs), so the bare id alone would let a brand-new
 * message from a LATER session collide — under the server's
 * `(memberId, clientMessageId)` unique index — with an unrelated message
 * from an EARLIER session that happened to reuse the same counter value.
 * Pure: returns a NEW object, never mutates `persistable`. Extracted out of
 * `ChatTranscript.tsx` (review round 2) so `persist-flush.test.ts` can build
 * its fixtures through the REAL scoping logic instead of a hand-copied
 * string template that could drift from what `queuePersist` actually sends.
 */
export function scopeClientMessageId(
  sessionId: string,
  persistable: PersistableMessage,
): PersistableMessage {
  return {
    ...persistable,
    clientMessageId: `${sessionId}:${persistable.clientMessageId}`,
  }
}
