import { expect, type Page } from '@playwright/test'

/**
 * Shared navigation helpers: every e2e spec that moves between group
 * screens "as a user would" goes through the header's in-place text index
 * (docs/BRAND.md v2 §3 — `NavIndex`, testids `nav-index-toggle` /
 * `nav-index` / `nav-<item>`).
 *
 * `'wallets'` is deliberately absent: wallet management is the single
 * `exchange` item (there is no `/wallets` route).
 */
export type SidebarNavItem =
  | 'history'
  | 'status'
  | 'me'
  | 'exchange'
  | 'manual-entry'
  | 'invite'
  | 'settings'

/** The URL segment each item's index link resolves to, relative to the group root. */
const ROUTE_SEGMENT: Record<SidebarNavItem, string> = {
  history: 'history',
  status: 'status',
  me: 'me',
  exchange: 'exchange',
  'manual-entry': 'expenses/new',
  invite: 'invite',
  settings: 'settings',
}

/**
 * Opens the text index. A mouse opens it by hovering the mark; a click on
 * the mark opens it too (touch toggles), so `.click()` covers both — and
 * if the index is already open (the mouse is still over it), the click is
 * a no-op for a mouse pointer.
 */
export async function openNav(page: Page): Promise<void> {
  const list = page.getByTestId('nav-index')
  if (await list.isVisible()) {
    return
  }
  await page.getByTestId('nav-index-toggle').click()
  await expect(list).toBeVisible()
}

/**
 * Opens the index and clicks the given item's link, waiting for the URL to
 * land on that item's destination — the real-user path. Most specs still
 * reach a destination via a direct `page.goto()`; this is only for the
 * navigations that actually need to prove the click itself works.
 */
export async function goVia(page: Page, item: SidebarNavItem): Promise<void> {
  await openNav(page)
  await page.getByTestId(`nav-${item}`).click()
  await page.waitForURL(new RegExp(`/${ROUTE_SEGMENT[item]}$`))
}
