import { expect, type Page } from '@playwright/test'

/**
 * Driving the wallet screen, which is a wizard rather than a page of forms.
 *
 * Every spec that needs a funded wallet used to poke the same five controls in
 * the same order; when the screen became a four-step flow that was eight
 * copies of the same edit. It is one helper now, so the next change to the
 * flow is one edit too.
 */

/**
 * Make sure the wizard is showing. After a save the screen hands over to the
 * wallet list, and "Record another exchange" is the way back in.
 */
export async function startTopUp(page: Page): Promise<void> {
  const again = page.getByTestId('topup-again')
  if (await again.isVisible().catch(() => false)) {
    await again.click()
  }
}

/**
 * Create a wallet from step 1 of the wizard and land on the rate step.
 *
 * The create form is already open when the member has no wallet at all —
 * there is nothing to choose between — and behind "Add a wallet" otherwise.
 */
export async function createWallet(
  page: Page,
  wallet: { label: string; type?: string; currency: string },
): Promise<void> {
  // The wallet list has a create form of its own, and creating from THERE
  // does not start a top-up. Get into the wizard first, or the flow silently
  // ends one step short of the thing it was opened for.
  await startTopUp(page)
  const openForm = page.getByTestId('topup-new-wallet')
  if (await openForm.isVisible().catch(() => false)) {
    await openForm.click()
  }
  await page.getByTestId('wallet-create-label').fill(wallet.label)
  if (wallet.type) {
    await page
      .getByTestId('wallet-create-type')
      .selectOption({ label: wallet.type })
  }
  await page.getByTestId('wallet-create-currency').selectOption(wallet.currency)
  await page.getByTestId('wallet-create-save').click()
  // Creating a wallet advances to the rate step: it was created in order to
  // be filled, so asking "which wallet?" again would be asking twice.
  await expect(page.getByTestId('exchange-rate')).toBeVisible()
}

/**
 * Leave the wizard for the wallet list without recording anything.
 *
 * `isVisible()` does not wait, so the screen has to be settled BEFORE it is
 * asked — otherwise a call straight after `goto` reads "no link", skips the
 * click and then waits out the clock on a list it never opened. Waiting for
 * either the link or the list first makes the branch a real either/or.
 */
export async function showWallets(page: Page): Promise<void> {
  const link = page.getByTestId('show-wallets')
  const again = page.getByTestId('topup-again')
  await expect(link.or(again).first()).toBeVisible()
  if (await link.isVisible().catch(() => false)) {
    await link.click()
  }
  await expect(again).toBeVisible()
}

/** Land on the wallet list. The screen opens on the wizard, not the list. */
export async function openWallets(
  page: Page,
  groupUrl: string,
): Promise<void> {
  await page.goto(`${groupUrl}/exchange`)
  await showWallets(page)
}

/** Choose an already-existing wallet on step 1 and move to the rate step. */
export async function chooseWallet(page: Page, label: string): Promise<void> {
  await page
    .locator('[data-testid^="topup-wallet-"]')
    .filter({ hasText: label })
    .first()
    .click()
  await page.getByTestId('topup-next').click()
  await expect(page.getByTestId('exchange-rate')).toBeVisible()
}

/**
 * Fill the rate and amount steps and save, from the rate step onwards.
 * Returns once the wizard has handed over to the wallet list.
 */
export async function recordTopUp(
  page: Page,
  topUp: { rate: string; received: string; expectPaid?: string },
): Promise<void> {
  await page.getByTestId('exchange-rate').fill(topUp.rate)
  await page.getByTestId('topup-next').click()
  await page.getByTestId('exchange-received').fill(topUp.received)
  if (topUp.expectPaid) {
    await expect(page.getByTestId('exchange-paid')).toHaveValue(
      topUp.expectPaid,
    )
  }
  await page.getByTestId('topup-next').click()
  await page.getByTestId('exchange-save').click()
  // Saved. Where that leaves you depends on how you arrived: mid-expense it
  // returns to the expense, otherwise it hands over to the wallet list. The
  // one thing true of both is that the wizard is done.
  await expect(page.getByTestId('exchange-save')).toHaveCount(0)
}

/** The whole thing: land on the wallet screen, make a wallet, fill it. */
export async function addFundedWallet(
  page: Page,
  groupUrl: string,
  wallet: { label: string; type?: string; currency: string },
  topUp: { rate: string; received: string; expectPaid?: string },
): Promise<void> {
  await page.goto(`${groupUrl}/exchange`)
  await createWallet(page, wallet)
  await recordTopUp(page, topUp)
}
