import { describe, expect, it, vi } from 'vitest'
import { createPersistTracker, mirrorPersistTracker } from './persist-status'

describe('createPersistTracker', () => {
  it('has no status before a message is ever enqueued', () => {
    const tracker = createPersistTracker()
    expect(tracker.statusOf('user-1')).toBeUndefined()
  })

  it('enqueue marks every id in the batch pending', () => {
    const tracker = createPersistTracker()
    tracker.enqueue(['user-1', 'assistant-2'])
    expect(tracker.statusOf('user-1')).toBe('pending')
    expect(tracker.statusOf('assistant-2')).toBe('pending')
  })

  it('resolve marks every id in the (matching) batch saved', () => {
    const tracker = createPersistTracker()
    tracker.enqueue(['user-1', 'assistant-2'])
    tracker.resolve(['user-1', 'assistant-2'])
    expect(tracker.statusOf('user-1')).toBe('saved')
    expect(tracker.statusOf('assistant-2')).toBe('saved')
  })

  it('reject marks every id in the batch failed', () => {
    const tracker = createPersistTracker()
    tracker.enqueue(['user-1'])
    tracker.reject(['user-1'])
    expect(tracker.statusOf('user-1')).toBe('failed')
  })

  it('retry re-enqueues a failed batch through the caller-supplied queue path and moves it back to pending', () => {
    const reEnqueue = vi.fn()
    const tracker = createPersistTracker()
    tracker.enqueue(['user-1', 'assistant-2'])
    tracker.reject(['user-1', 'assistant-2'])

    tracker.retry('user-1', reEnqueue)

    expect(tracker.statusOf('user-1')).toBe('pending')
    expect(tracker.statusOf('assistant-2')).toBe('pending')
    expect(reEnqueue).toHaveBeenCalledTimes(1)
    expect(reEnqueue).toHaveBeenCalledWith(['user-1', 'assistant-2'])
  })

  it('retry -> pending -> saved once the caller resolves the re-enqueued batch', () => {
    const reEnqueue = vi.fn()
    const tracker = createPersistTracker()
    tracker.enqueue(['user-1'])
    tracker.reject(['user-1'])

    tracker.retry('user-1', reEnqueue)
    expect(tracker.statusOf('user-1')).toBe('pending')

    // The caller (ChatTranscript) drives the SAME queue path again; once
    // that call resolves, it reports back through the same `resolve`.
    tracker.resolve(['user-1'])
    expect(tracker.statusOf('user-1')).toBe('saved')
  })

  it('retry is a no-op when the id is not currently failed (e.g. still pending)', () => {
    const reEnqueue = vi.fn()
    const tracker = createPersistTracker()
    tracker.enqueue(['user-1'])

    tracker.retry('user-1', reEnqueue)

    expect(tracker.statusOf('user-1')).toBe('pending')
    expect(reEnqueue).not.toHaveBeenCalled()
  })

  it('retry is a no-op when the id is already saved', () => {
    const reEnqueue = vi.fn()
    const tracker = createPersistTracker()
    tracker.enqueue(['user-1'])
    tracker.resolve(['user-1'])

    tracker.retry('user-1', reEnqueue)

    expect(tracker.statusOf('user-1')).toBe('saved')
    expect(reEnqueue).not.toHaveBeenCalled()
  })

  it('retry is a no-op for an id that was never enqueued', () => {
    const reEnqueue = vi.fn()
    const tracker = createPersistTracker()

    expect(() => tracker.retry('never-seen', reEnqueue)).not.toThrow()
    expect(tracker.statusOf('never-seen')).toBeUndefined()
    expect(reEnqueue).not.toHaveBeenCalled()
  })

  it('never throws even when the caller-supplied reEnqueue callback throws', () => {
    const reEnqueue = vi.fn(() => {
      throw new Error('boom')
    })
    const tracker = createPersistTracker()
    tracker.enqueue(['user-1'])
    tracker.reject(['user-1'])

    expect(() => tracker.retry('user-1', reEnqueue)).not.toThrow()
  })

  it('never throws even when a subscribed listener throws', () => {
    const tracker = createPersistTracker()
    tracker.subscribe(() => {
      throw new Error('listener boom')
    })

    expect(() => tracker.enqueue(['user-1'])).not.toThrow()
    expect(tracker.statusOf('user-1')).toBe('pending')
  })

  describe('partial-batch semantics — pinned to the queue\'s actual batch shape', () => {
    // ChatTranscript's `queuePersist` collapses every message pushed/upserted
    // within one microtask into a single `pendingRef` Map, then flushes it as
    // ONE `appendChatMessages` call carrying ALL of those ids together (see
    // `queuePersist` in ChatTranscript.tsx). There is no per-message result
    // from that call — it either resolves or rejects as a whole. So a
    // "batch" here is exactly the array of ids handed to `enqueue`/
    // `resolve`/`reject` together, and two ids enqueued in DIFFERENT batches
    // (different microtask flushes) must never transition together.

    it('two separate batches settle independently', () => {
      const tracker = createPersistTracker()
      tracker.enqueue(['user-1', 'assistant-2']) // batch A
      tracker.enqueue(['user-3']) // batch B (later microtask flush)

      tracker.resolve(['user-1', 'assistant-2']) // only batch A settles

      expect(tracker.statusOf('user-1')).toBe('saved')
      expect(tracker.statusOf('assistant-2')).toBe('saved')
      expect(tracker.statusOf('user-3')).toBe('pending')

      tracker.reject(['user-3']) // batch B settles separately
      expect(tracker.statusOf('user-3')).toBe('failed')
    })

    it('a later batch for an id already flushed replaces its batch membership for retry purposes', () => {
      // e.g. an id fails, gets retried (re-enqueued as its own new batch
      // together with whatever else piggybacks on that flush), and must then
      // retry against the NEW batch, not the stale original one.
      const reEnqueue = vi.fn()
      const tracker = createPersistTracker()
      tracker.enqueue(['user-1', 'assistant-2'])
      tracker.reject(['user-1', 'assistant-2'])

      // Retry re-enqueues user-1 together with assistant-2 (their shared,
      // still-failed batch) — the whole batch goes back to pending, since
      // that batch is one atomic unit, same as the original send.
      tracker.retry('user-1', reEnqueue)
      expect(reEnqueue).toHaveBeenLastCalledWith(['user-1', 'assistant-2'])
      expect(tracker.statusOf('assistant-2')).toBe('pending')

      // Simulate the SAME queue path folding user-1 into a fresh batch with
      // a brand-new message on the next flush.
      tracker.enqueue(['user-1', 'user-4'])
      tracker.reject(['user-1', 'user-4'])

      tracker.retry('user-1', reEnqueue)
      expect(reEnqueue).toHaveBeenLastCalledWith(['user-1', 'user-4'])
      // assistant-2 was not part of THIS batch, so this retry leaves it
      // exactly where the earlier retry put it.
      expect(tracker.statusOf('assistant-2')).toBe('pending')
    })

    it('resolve/reject skip ids the tracker never enqueued — they cannot introduce new entries', () => {
      const tracker = createPersistTracker()
      tracker.enqueue(['user-1'])
      tracker.resolve(['user-1', 'ghost-id']) // ghost-id was never enqueued

      expect(tracker.statusOf('user-1')).toBe('saved')
      expect(tracker.statusOf('ghost-id')).toBeUndefined()

      tracker.reject(['ghost-id']) // still a no-op — reject skips it too
      expect(tracker.statusOf('ghost-id')).toBeUndefined()
    })
  })

  describe('subscribe', () => {
    it('notifies subscribers on every status transition', () => {
      const tracker = createPersistTracker()
      const listener = vi.fn()
      tracker.subscribe(listener)

      tracker.enqueue(['user-1'])
      tracker.resolve(['user-1'])

      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('unsubscribe stops further notifications', () => {
      const tracker = createPersistTracker()
      const listener = vi.fn()
      const unsubscribe = tracker.subscribe(listener)
      unsubscribe()

      tracker.enqueue(['user-1'])

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('mirrorPersistTracker', () => {
    it('syncs an immediate snapshot on subscribe, even before any transition', () => {
      const tracker = createPersistTracker()
      tracker.enqueue(['user-1']) // settles BEFORE mirrorPersistTracker is called
      const onChange = vi.fn()

      mirrorPersistTracker(tracker, () => ['user-1'], onChange)

      // No transition happened after the call — the initial sync is what
      // delivers the snapshot.
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(new Map([['user-1', 'pending']]))
    })

    it('re-syncs on every subsequent tracker transition', () => {
      const tracker = createPersistTracker()
      const onChange = vi.fn()
      mirrorPersistTracker(tracker, () => ['user-1'], onChange)
      onChange.mockClear() // drop the initial sync call

      tracker.enqueue(['user-1'])
      tracker.resolve(['user-1'])

      expect(onChange).toHaveBeenCalledTimes(2)
      expect(onChange).toHaveBeenLastCalledWith(new Map([['user-1', 'saved']]))
    })

    it('unsubscribing (the returned cleanup) stops further syncs', () => {
      const tracker = createPersistTracker()
      const onChange = vi.fn()
      const unsubscribe = mirrorPersistTracker(tracker, () => ['user-1'], onChange)
      onChange.mockClear()
      unsubscribe()

      tracker.enqueue(['user-1'])

      expect(onChange).not.toHaveBeenCalled()
    })

    it('excludes ids with no status yet, even if knownIds() reports them', () => {
      const tracker = createPersistTracker()
      const onChange = vi.fn()

      mirrorPersistTracker(tracker, () => ['never-enqueued'], onChange)

      expect(onChange).toHaveBeenCalledWith(new Map())
    })

    it('picks up ids added to knownIds() after the initial sync', () => {
      const tracker = createPersistTracker()
      const ids = new Set<string>()
      const onChange = vi.fn()
      mirrorPersistTracker(tracker, () => ids, onChange)
      onChange.mockClear()

      ids.add('user-2')
      tracker.enqueue(['user-2'])

      expect(onChange).toHaveBeenLastCalledWith(new Map([['user-2', 'pending']]))
    })
  })
})
