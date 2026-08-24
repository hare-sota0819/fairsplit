'use client'

import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'fairsplit:theme'

const OPTIONS: ThemePreference[] = ['system', 'light', 'dark']

function isPreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/**
 * Apply a preference to <html>.
 *
 * "system" REMOVES the attribute rather than writing one, because the CSS
 * decides by its absence: the `prefers-color-scheme` block is scoped to
 * `:root:not([data-theme])` so the OS only gets a say when nobody has
 * chosen. Writing `data-theme="system"` would silently pin the app to light.
 */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === 'system') {
    delete root.dataset.theme
  } else {
    root.dataset.theme = preference
  }
  // The RESOLVED answer also goes on as a class, because Tailwind's `dark:`
  // variant is a selector and cannot see a media query. Without this the
  // shadcn components' dark-mode tweaks never apply.
  const resolved =
    preference === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference
  root.classList.toggle('dark', resolved === 'dark')
}

/**
 * localStorage as an external store.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the server has
 * no localStorage, so the stored value cannot be read during render, and
 * setting state from an effect is both a cascading render and a lint error
 * here. This gives the server "system", the client the real answer, and no
 * hydration mismatch.
 */
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function getSnapshot(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return isPreference(stored) ? stored : 'system'
}

function getServerSnapshot(): ThemePreference {
  return 'system'
}

/**
 * The Appearance control. Three radio rows — the app had no way to choose a
 * theme at all before this; it followed the OS and nothing else.
 *
 * The choice lives in localStorage, not on the server: it is per device (the
 * same account on a laptop and a phone can reasonably want different
 * answers), and it has to be readable before the first paint, which a
 * database round trip cannot do. `ThemeScript` in the root layout reads it.
 */
export function ThemeChoice({
  labels,
}: {
  labels: Record<ThemePreference, string>
}) {
  const preference = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )

  function choose(next: ThemePreference) {
    window.localStorage.setItem(THEME_STORAGE_KEY, next)
    applyTheme(next)
    for (const listener of listeners) {
      listener()
    }
  }

  return (
    <ul className="-mx-5 divide-y divide-border border-y border-border">
      {OPTIONS.map((option) => (
        <li key={option}>
          <button
            type="button"
            role="radio"
            aria-checked={preference === option}
            onClick={() => choose(option)}
            data-testid={`theme-${option}`}
            className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-[background-color,color,transform] duration-fast ease-swift hover:bg-muted active:translate-y-px active:bg-muted"
          >
            {/* Selection is where the underline is (§7) — never a
                checkmark icon, which this grammar does not have. */}
            <span
              className={
                preference === option
                  ? 'border-b border-foreground pb-[3px] text-foreground'
                  : 'text-[#b8b8b8]'
              }
            >
              {labels[option]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Applies the stored preference before the first paint.
 *
 * This has to be a blocking inline script. Anything that runs after
 * hydration would let the OS theme paint first and then swap, which is the
 * white flash every themed app is judged by.
 */
export function ThemeScript() {
  const source = `try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k);var e=document.documentElement;
if(t==='dark'||t==='light'){e.dataset.theme=t}
var r=(t==='dark'||t==='light')?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
e.classList.toggle('dark',r==='dark');
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(ev){
 var s=localStorage.getItem(k);
 if(s!=='dark'&&s!=='light'){e.classList.toggle('dark',ev.matches)}
});}catch(err){}`
  return <script dangerouslySetInnerHTML={{ __html: source }} />
}
