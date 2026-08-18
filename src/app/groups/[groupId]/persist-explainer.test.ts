import { describe, expect, it } from 'vitest'
import {
  PERSIST_EXPLAINER_STORAGE_KEY,
  markPersistExplainerSeen,
  resolveExplainerStorage,
  shouldShowPersistExplainer,
} from './persist-explainer'

/** Minimal in-memory `Storage` stand-in — no `window`/`localStorage` needed
 *  to exercise the pure gating logic (mirrors `persist-status.test.ts`'s
 *  style of testing the module directly rather than through a browser API). */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size
    },
  }
}

function throwingStorage(): Storage {
  return {
    getItem: () => {
      throw new Error('storage unavailable')
    },
    setItem: () => {
      throw new Error('storage unavailable')
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  }
}

describe('shouldShowPersistExplainer', () => {
  it('is true on a device that has never seen the explainer', () => {
    expect(shouldShowPersistExplainer(fakeStorage())).toBe(true)
  })

  it('is false once the flag has been recorded', () => {
    const storage = fakeStorage({ [PERSIST_EXPLAINER_STORAGE_KEY]: '1' })
    expect(shouldShowPersistExplainer(storage)).toBe(false)
  })

  it('never throws — a storage read failure is treated as "already seen"', () => {
    expect(() => shouldShowPersistExplainer(throwingStorage())).not.toThrow()
    expect(shouldShowPersistExplainer(throwingStorage())).toBe(false)
  })
})

describe('markPersistExplainerSeen', () => {
  it('writes the flag so a later check reports already-seen', () => {
    const storage = fakeStorage()
    expect(shouldShowPersistExplainer(storage)).toBe(true)
    markPersistExplainerSeen(storage)
    expect(shouldShowPersistExplainer(storage)).toBe(false)
  })

  it('never throws on a storage write failure', () => {
    expect(() => markPersistExplainerSeen(throwingStorage())).not.toThrow()
  })
})

describe('resolveExplainerStorage', () => {
  it('returns whatever the getter resolves', () => {
    const storage = fakeStorage()
    expect(resolveExplainerStorage(() => storage)).toBe(storage)
  })

  it('never throws and returns null when the getter itself throws — the real-world case being `window.localStorage`\'s PROPERTY ACCESS raising a SecurityError under blocked storage (Safari "Block All Cookies", a sandboxed iframe), not just a getItem/setItem call', () => {
    const throwingGetter = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    expect(() => resolveExplainerStorage(throwingGetter)).not.toThrow()
    expect(resolveExplainerStorage(throwingGetter)).toBeNull()
  })
})
