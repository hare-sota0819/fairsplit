/**
 * One-time inline explainer for the persistence indicator (Task 2,
 * chat-indicator-currency, docs/PROMPT.md 2026-08-14): shown the FIRST time
 * a pending clock ever renders in a transcript, never again after that.
 *
 * Device-level flag via `localStorage`, NOT a DB column — deliberate
 * deviation from the exchange-onboarding precedent (the `/guide` redirect
 * on first sign-up), which IS DB-backed because it's a real onboarding step
 * tied to the account: it must not repeat on a second device either. This
 * explainer is cosmetic UI education about an icon, not onboarding —
 * repeating it once on a device the user later signs into is a mild
 * annoyance, not a functional problem, and doesn't justify a schema change
 * for it. Same per-device precedent `ThemeChoice.tsx`'s theme preference
 * already uses.
 *
 * `storage` is an explicit parameter on `shouldShowPersistExplainer`/
 * `markPersistExplainerSeen` (never defaulted to `window.localStorage`
 * internally) so those two stay pure and unit-testable without a `window`
 * global. Every function swallows its own storage errors (private-browsing
 * quota, disabled storage) — this must never be the thing that breaks the
 * chat surface, same rule `persist-status.ts` follows for the tracker
 * itself.
 *
 * `resolveExplainerStorage` (below) is what actually gets that `storage`
 * argument in production: fix round 1 (review) caught that the PROPERTY
 * ACCESS `window.localStorage` — not just `.getItem`/`.setItem` — throws a
 * `SecurityError` under some blocked-storage configurations (Safari's
 * "Block All Cookies", a sandboxed iframe without
 * `allow-storage-access-by-user-activation`), which neither of the two
 * functions above can protect against since they never see it — they only
 * ever receive an already-resolved `storage` object. `ChatTranscript.tsx`
 * calls this instead of touching `window.localStorage` directly, so that
 * failure mode is "explainer silently skipped" rather than "the transcript
 * effect throws". Takes an injectable `getStorage` (defaulting to
 * `() => window.localStorage`, evaluated lazily and only when the argument
 * is omitted) so it stays testable without a `window` global too — real
 * callers never pass one.
 */

export const PERSIST_EXPLAINER_STORAGE_KEY = 'fairsplit:persist-explainer-seen'

type ExplainerStorage = Pick<Storage, 'getItem' | 'setItem'>

/** True the first time this runs on a device that has never recorded the
 *  flag. A storage read failure is treated as "already seen" (fail closed —
 *  showing the explainer once too few times is harmless; a throwing
 *  `getItem` is a sign `setItem` will fail too, so showing it again would
 *  just repeat forever). */
export function shouldShowPersistExplainer(storage: ExplainerStorage): boolean {
  try {
    return storage.getItem(PERSIST_EXPLAINER_STORAGE_KEY) === null
  } catch {
    return false
  }
}

/** Records that the explainer has been shown, so it never shows again on
 *  this device. Never throws — a write failure just means it may show
 *  again next time, not a crash. */
export function markPersistExplainerSeen(storage: ExplainerStorage): void {
  try {
    storage.setItem(PERSIST_EXPLAINER_STORAGE_KEY, '1')
  } catch {
    // Never throw — see the module doc comment above.
  }
}

/** Resolves the real storage to pass into the two functions above, or
 *  `null` if even the PROPERTY ACCESS throws (see the module doc comment).
 *  Never throws itself. */
export function resolveExplainerStorage(
  getStorage: () => ExplainerStorage = () => window.localStorage,
): ExplainerStorage | null {
  try {
    return getStorage()
  } catch {
    return null
  }
}
