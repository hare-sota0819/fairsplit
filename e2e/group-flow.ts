import { expect, type Page } from '@playwright/test'

/**
 * Create a group the way the product does it now (patches5, 2026-08-28): the
 * create screen asks ONE question — the name — and everything else is derived
 * or deferred.
 *
 * Two consequences this helper absorbs for the whole suite, so that no spec
 * has to restate them:
 *
 *  - **Settlement currency is derived from the account locale** (`ko` → KRW,
 *    everything else → USD). This suite asks for `en-US` so its English text
 *    selectors keep working (playwright.config.ts), which would settle every
 *    group in USD, while the specs below state money in KRW throughout. The
 *    currency is therefore pinned here in group settings — where the product
 *    now puts that choice — instead of on a create form that no longer offers
 *    it. Settings only allows it while the group has no expenses, which is
 *    exactly where this runs.
 *  - **Destination is not asked at create.** Specs that need one set it in
 *    settings, via `tripCountry` below.
 *
 * The member's display name is derived from the account, so specs no longer
 * choose it: signing up as "Alice E2E" makes the member "Alice E2E".
 *
 * Returns the group's URL with any query string stripped.
 */
export async function openLedger(
  page: Page,
  name: string,
  options: { settlementCurrency?: string; tripCountry?: string } = {},
): Promise<string> {
  await page.goto('/groups/new')
  await page.getByLabel('Group name').fill(name)
  await page.getByRole('button', { name: 'Open the ledger' }).click()
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url().replace(/\?.*$/, '')

  await page.goto(`${groupUrl}/settings`)
  await page
    .getByLabel('Settlement currency')
    .selectOption(options.settlementCurrency ?? 'KRW')
  if (options.tripCountry) {
    await page.getByTestId('trip-country').selectOption(options.tripCountry)
  }
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  await page.goto(groupUrl)
  await expect(page.getByTestId('home')).toBeVisible()
  return groupUrl
}
