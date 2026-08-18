import { expect, type Page } from '@playwright/test'

/**
 * Shared sidebar-navigation helpers (Task 6, app-shell restructure): the
 * bottom Tabs bar and the `+` FAB are gone, so every e2e spec that used to
 * click a tab link or the FAB now goes through the sidebar instead.
 *
 * Deviates from the brief's literal item union (`'wallets'` was listed
 * alongside `'exchange'`): Task 2's review ruling collapsed the sidebar's
 * wallet-management row into the single `exchange` item (there is no
 * `/wallets` route and no `sidebar-wallets` testid) — `'wallets'` would map
 * to a testid that has never existed. Omitted here rather than reproduced
 * as dead code.
 */
export type SidebarNavItem =
  | 'history'
  | 'status'
  | 'me'
  | 'exchange'
  | 'manual-entry'
  | 'invite'
  | 'settings'

/** The URL segment each item's sidebar link resolves to, relative to the group root. */
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
 * Makes the sidebar's items reachable. Below `lg` (1024px) that means
 * opening the drawer via the header hamburger; at `lg`+ (Playwright's
 * default 1280x720 included) the sidebar is an always-mounted rail and the
 * hamburger is hidden, so there is nothing to open — the same testids are
 * already on screen (shell phase B, 2026-08-16).
 */
export async function openSidebar(page: Page): Promise<void> {
  const rail = page.getByTestId('sidebar-rail')
  if (await rail.isVisible()) {
    return
  }
  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar-panel')).toBeVisible()
}

/**
 * Opens the sidebar and clicks the given item's link, waiting for the URL to
 * land on that item's destination — the real-user path a click through the
 * sidebar now takes, replacing what used to be a tab-link or FAB click. Most
 * specs still reach a destination via a direct `page.goto()` where they
 * never went through the tab bar in the first place; this is only for the
 * navigations that actually need to prove the click itself works.
 */
export async function goVia(page: Page, item: SidebarNavItem): Promise<void> {
  await openSidebar(page)
  await page.getByTestId(`sidebar-${item}`).click()
  await page.waitForURL(new RegExp(`/${ROUTE_SEGMENT[item]}$`))
}
