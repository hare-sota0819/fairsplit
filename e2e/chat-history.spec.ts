import { expect, test, type Page } from '@playwright/test'

/**
 * Task 3 (docs/superpowers/plans/2026-08-13-chat-history.md, "e2e (Task 3)"):
 * end-to-end coverage for persistent per-member chat history — Task 1's
 * `src/lib/chat-history.ts` + `chat-history-actions.ts` are unit-tested
 * directly, Task 2's provider/page wiring is not exercised anywhere short
 * of a real browser reload, which is what every test below actually does.
 *
 * Local helper pattern copied from `e2e/chat-entry.spec.ts` (this repo's
 * convention: no shared page-object module, each spec keeps its own small
 * copies of signUp/createGroup/joinGroup).
 */

test.use({ viewport: { width: 390, height: 844 } })

const uniqueEmail = (tag: string): string =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

const PASSWORD = 'password123'

async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.goto('/signup')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
}

async function createGroup(
  page: Page,
  name: string,
  displayName: string,
): Promise<string> {
  await page.goto('/groups/new')
  // Known pre-existing flake (docs/BUGS.md 2026-08-09): DestinationPicker's
  // hydration mismatch, if filled into within the first ~second, regenerates
  // a subtree that appears to take sibling form state down with it.
  await page.waitForTimeout(1500)
  await page.getByLabel('Group name').fill(name)
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill(displayName)
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  return page.url().replace(/\?.*$/, '')
}

async function joinGroup(
  page: Page,
  invitePath: string,
  displayName: string,
): Promise<void> {
  await page.goto(invitePath)
  await page.getByLabel('Your display name in this group').fill(displayName)
  await page.getByRole('button', { name: 'Join group' }).click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

/** Every bubble in the transcript, restored or live, in document order. */
const allBubbles = (page: Page) => page.locator('[data-testid^="chat-message-"]')

/**
 * Waits for the fire-and-forget history WRITE to land before reloading or
 * navigating away.
 *
 * docs/BUGS.md [2026-08-13]: this spec flaked under the full suite — a
 * different test each run, all passing alone — and the mechanism is a
 * test-vs-product-contract mismatch, not a product bug.
 * `ChatTranscriptProvider.queuePersist` persists deliberately fire-and-forget
 * (queued, flushed on the next microtask, sent as
 * `void appendChatMessages(...)`) because "an entry app must never block on
 * history". Every assertion below is on the RENDERED bubble, which is an
 * immediate local push — so a `page.reload()` fired straight after it can
 * cancel the still-in-flight POST and the restored page comes back one bubble
 * short.
 *
 * The fix is on the TEST side, exactly as that entry ruled: the product's
 * instant, non-blocking chat surface is the trade the chat-history plan
 * already made, and awaiting the write in the product would undo it. The test
 * simply stops racing it. `networkidle` (no network connections for 500ms) is
 * the least invasive mechanism available here — the persist POST is a server
 * action to the page's own URL, indistinguishable by URL from the save it
 * follows, so there is no single response to await; and this app opens no
 * long-lived connections (no websockets, no polling fetches), so idle really
 * does mean "the writes are done".
 *
 * Call it before a reload or a cross-context navigation, never in the inner
 * loop of a send — it costs the 500ms quiet window each time.
 */
async function settleHistoryWrites(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
}

/**
 * Sends one plain-text expense sentence, confirms the card, and waits for
 * the saved bubble — the flow test 1/2 need for a single persisted
 * user-text + assistant-saved pair.
 */
async function sendAndSaveExpense(page: Page, sentence: string): Promise<void> {
  await page.getByTestId('chat-input').fill(sentence)
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
  await page.getByTestId('chat-confirm-save').click()
  await expect(page.getByTestId('chat-saved-summary')).toBeVisible()
}

/**
 * A cheap, high-volume round trip for the pagination test: a real
 * QUERY_MY_BALANCE sentence (`src/lib/assistant/lexicons/corpus.ts`'s en
 * main-tier "how much do I owe" row) resolves through `classify()`
 * synchronously (no network round trip — only the fire-and-forget
 * `appendChatMessages` write happens server-side), and its reply is a
 * PLAIN text line (`compose.ts`'s `composeMyBalance`), never a GUIDED chip
 * — chip-only answers are dropped whole by `toPersistable` (chat-history.ts),
 * so a GUIDED/HELP reply would silently fail to produce the 2nd row this
 * test relies on. One user 'text' row + one assistant 'answer' row persist
 * per call.
 */
async function sendBalanceQuery(page: Page, expectedAnswerCount: number): Promise<void> {
  await page.getByTestId('chat-input').fill('how much do I owe')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-answer')).toHaveCount(expectedAnswerCount)
}

/**
 * Test 1 — persistence round trip. A saved expense's user sentence AND its
 * saved-summary bubble both survive a reload, in order; the LIVE confirm
 * card (never persisted — plan's "what persists" list) does not; and the
 * greeting empty-state (which only shows when history is ALSO empty) must
 * not flash back once real history exists.
 */
test('a saved expense round-trips through a reload: both bubbles restored, in order, card and greeting absent', async ({
  page,
}) => {
  await signUp(page, 'Alice E2E', uniqueEmail('alice-persist'))
  await createGroup(page, 'Chat History Persist E2E', 'Alice')

  await sendAndSaveExpense(page, '택시 8500원')
  await expect(page.getByTestId('chat-saved-summary')).toContainText('택시')

  await settleHistoryWrites(page)
  await page.reload()

  // Greeting is gone: real history exists now.
  await expect(page.getByTestId('chat-empty')).toHaveCount(0)
  // The live confirm card never persists — it must not come back.
  await expect(page.getByTestId('chat-confirm-card')).toHaveCount(0)

  // Exactly the two persistable bubbles from the round trip above, in the
  // order they were sent: the user's sentence, then the assistant's saved
  // summary (the live 'card' bubble in between was never persisted, so it
  // does not reappear as a third bubble).
  const bubbles = allBubbles(page)
  await expect(bubbles).toHaveCount(2)
  await expect(bubbles.nth(0)).toHaveAttribute('data-testid', 'chat-message-user')
  await expect(bubbles.nth(0)).toContainText('택시 8500원')
  await expect(bubbles.nth(1)).toHaveAttribute(
    'data-testid',
    'chat-message-assistant',
  )
  await expect(bubbles.nth(1).getByTestId('chat-saved-summary')).toContainText(
    '택시',
  )
})

/**
 * Test 2 — multi-device. Server storage is the source of truth (plan's own
 * framing), so the SAME account signed in from a brand-new browser context
 * (never having seen this group's URL) must see the history that account's
 * first context wrote, once it navigates to the same group.
 */
test('the same account in a second browser context sees the history written from the first', async ({
  browser,
}) => {
  const email = uniqueEmail('multidevice')
  const deviceA = await browser.newContext()
  const pageA = await deviceA.newPage()
  await signUp(pageA, 'Dana E2E', email)
  await createGroup(pageA, 'Chat History Multi-Device E2E', 'Dana')

  await sendAndSaveExpense(pageA, '커피 4200원')
  await expect(pageA.getByTestId('chat-saved-summary')).toContainText('커피')

  await settleHistoryWrites(pageA)

  const deviceB = await browser.newContext()
  const pageB = await deviceB.newPage()
  await signIn(pageB, email)
  await pageB.goto('/groups')
  await pageB
    .getByTestId('group-list-row')
    .filter({ hasText: 'Chat History Multi-Device E2E' })
    .click()

  await expect(pageB.getByTestId('chat-empty')).toHaveCount(0)
  const bubblesB = allBubbles(pageB)
  await expect(bubblesB).toHaveCount(2)
  await expect(bubblesB.nth(0)).toContainText('커피 4200원')
  await expect(bubblesB.nth(1).getByTestId('chat-saved-summary')).toContainText(
    '커피',
  )

  await deviceA.close()
  await deviceB.close()
})

/**
 * Test 3 — privacy. PRIVATE per-member-per-group history is the whole
 * point of the plan (not a shared group room): a second member who joins
 * the same group must see none of the first member's transcript, and a
 * message that second member sends must stay invisible to the first even
 * after a reload.
 */
test('a second member of the same group sees none of the first member\'s history, and vice versa', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signUp(ownerPage, 'Priya E2E', uniqueEmail('priya-privacy'))
  const groupUrl = await createGroup(
    ownerPage,
    'Chat History Privacy E2E',
    'Priya',
  )
  await ownerPage.goto(`${groupUrl}/invite`)
  const invitePath = await ownerPage.getByTestId('invite-link').innerText()
  await ownerPage.goto(groupUrl)

  await sendAndSaveExpense(ownerPage, '점심 6000원')
  await expect(ownerPage.getByTestId('chat-saved-summary')).toContainText(
    '점심',
  )

  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()
  await signUp(memberPage, 'Owen E2E', uniqueEmail('owen-privacy'))
  await joinGroup(memberPage, invitePath, 'Owen')

  // The joining member's OWN history is empty — none of Priya's messages
  // (own-member-only, not a shared room).
  await expect(memberPage.getByTestId('chat-empty')).toBeVisible()
  await expect(allBubbles(memberPage)).toHaveCount(0)

  // Owen sends his own message — it must persist under HIS memberId only.
  await sendAndSaveExpense(memberPage, '간식 1500원')
  await expect(memberPage.getByTestId('chat-saved-summary')).toContainText(
    '간식',
  )

  // Priya reloads: still no sign of Owen's message, only her own two bubbles.
  await settleHistoryWrites(memberPage)
  await settleHistoryWrites(ownerPage)
  await ownerPage.reload()
  await expect(allBubbles(ownerPage)).toHaveCount(2)
  await expect(ownerPage.getByTestId('chat-saved-summary')).toHaveCount(1)
  await expect(
    ownerPage.getByTestId('chat-saved-summary').filter({ hasText: '간식' }),
  ).toHaveCount(0)
  await expect(ownerPage.locator('body')).not.toContainText('간식')

  await ownerContext.close()
  await memberContext.close()
})

/**
 * Test 4 — pagination. Sending 51 expense-save round trips to exceed one
 * `CHAT_HISTORY_PAGE_SIZE` (=50) page is too slow for e2e; every persistable
 * user+assistant pair counts equally toward the row total, so 26 cheap
 * QUERY_MY_BALANCE round trips (52 rows, no card/save clicks) reach the
 * same threshold far faster. A reload shows the newest 50 with a
 * "load earlier" control at the top; clicking it prepends the 2 remaining
 * older rows without yanking the scroll position to the bottom (the
 * anchoring `useLayoutEffect` in `ChatTranscript.tsx`).
 */
test('over one page of history shows a load-earlier control that prepends without jumping scroll to the bottom', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signUp(page, 'Priya Page E2E', uniqueEmail('priya-page'))
  await createGroup(page, 'Chat History Pagination E2E', 'Priya')

  for (let i = 1; i <= 26; i += 1) {
    await sendBalanceQuery(page, i)
  }
  await expect(allBubbles(page)).toHaveCount(52)

  await settleHistoryWrites(page)
  await page.reload()

  // Newest page only: 50 of the 52 rows, oldest 2 held back behind the
  // control.
  await expect(page.getByTestId('chat-empty')).toHaveCount(0)
  await expect(allBubbles(page)).toHaveCount(50)
  await expect(page.getByTestId('chat-history-more')).toBeVisible()
  // Not yet at the cap (52 << 500), so no retention notice.
  await expect(page.getByTestId('chat-history-notice')).toHaveCount(0)

  // Scroll away from the bottom to a known reference point (the very top,
  // where the load-earlier control lives) before triggering the prepend —
  // starting already-at-the-bottom would make "didn't jump to the bottom"
  // untestable, since prepending above content you're already at the
  // bottom of leaves you at the (new) bottom either way.
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

  await page.getByTestId('chat-history-more').click()

  // The 2 remaining older rows landed, above the previous 50.
  await expect(allBubbles(page)).toHaveCount(52)
  // No more pages left, and still nowhere near the 500-row cap.
  await expect(page.getByTestId('chat-history-more')).toHaveCount(0)
  await expect(page.getByTestId('chat-history-notice')).toHaveCount(0)

  // The anchoring effect must have moved the scroll position DOWN from 0 by
  // roughly the height of what was just inserted above (proving the view
  // did not stay pinned at the literal top) — but nowhere near the new
  // bottom of the (now taller) page (proving it did not jump there either,
  // the regression this test guards against).
  const scrollY = await page.evaluate(() => window.scrollY)
  const maxScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )
  expect(scrollY).toBeGreaterThan(0)
  expect(scrollY).toBeLessThan(maxScroll - 50)
})

// Cap/atCap notice: unit-level only (Task 1's tests already cover the trim
// math and the atCap boolean via `evaluate`-style pure-function checks on
// `src/lib/chat-history.ts`). Reaching the real 500-row cap in e2e would
// mean 250 round trips minimum — far outside this suite's time budget, and
// no cheaper honest way to reach it was found (the cap is enforced by a
// real `deleteMany` against real row counts, not something a test-only prop
// can lower without touching production code paths this task must not
// change).

// SANCTIONED APPEND (Task 2, chat-indicator-currency,
// .superpowers/sdd/2026-08-14-chat-indicator-currency/task-2-brief.md) — do
// not edit any test above this line.
//
// Test 5 — the persist indicator. Two halves in one flow: (a) an ordinary
// send shows the pending clock on the user bubble while the history write
// is in flight (Task 1's `persistStatuses`), and it clears once the write
// lands — alongside the one-time explainer bubble, which only ever shows
// once per device (`persist-explainer.ts`); (b) a write that fails (stubbed
// via `page.route`) shows the failed badge + a real retry button, and
// tapping retry re-sends through the SAME queue path and clears once THAT
// succeeds.
//
// `appendChatMessages` (`chat-history-actions.ts`) is a Next.js Server
// Action: called from a client component, it POSTs to the CURRENT page
// URL — indistinguishable from any other action on that same URL by path
// alone, so unlike every other route stub in this repo (`**/api/...`) this
// one has to key off the group page's own URL instead, and only ever gets
// installed AFTER `createGroup` returns, so it can't intercept sign-up or
// group-creation's own server actions.
test('the persist indicator shows a pending clock that clears on save, and a failed write shows a retry that also clears', async ({
  page,
}) => {
  await signUp(page, 'Indicator E2E', uniqueEmail('persist-indicator'))
  const groupUrl = await createGroup(
    page,
    'Chat Persist Indicator E2E',
    'Indicator',
  )

  // `delay`: slows the write just enough that the pending clock is
  // reliably observable before it resolves (an unstubbed write on
  // localhost can otherwise resolve faster than Playwright can assert the
  // intermediate state). `fail-once`: aborts exactly the FIRST matching
  // write like a dropped connection, then lets every later one (the retry)
  // through normally.
  let mode: 'delay' | 'fail-once' = 'delay'
  let failedOnce = false
  await page.route(`${groupUrl}**`, async (route) => {
    const req = route.request()
    if (req.method() !== 'POST') {
      await route.continue()
      return
    }
    if (mode === 'delay') {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await route.continue()
      return
    }
    if (mode === 'fail-once' && !failedOnce) {
      failedOnce = true
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  // (a) ordinary send: the pending clock appears immediately (persisted
  // status is set synchronously, before the — deliberately slowed —
  // network call resolves), the one-time explainer bubble appears
  // alongside it, and the clock clears once the write lands.
  await page.getByTestId('chat-input').fill('how much do I owe')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-persist-pending')).toBeVisible()
  await expect(page.getByTestId('chat-persist-explainer')).toBeVisible()
  await expect(page.getByTestId('chat-persist-pending')).toHaveCount(0, {
    timeout: 10_000,
  })

  // (b) stubbed failure: the write is aborted once (a dropped connection),
  // the user bubble shows the failed badge + a real retry button; tapping
  // it re-sends through the SAME queue path (`persist-status.ts`'s
  // `retry`), and the now-unstubbed retry succeeds and clears the badge.
  mode = 'fail-once'
  await page.getByTestId('chat-input').fill('how much have we spent')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-persist-failed')).toBeVisible()
  const retryButton = page.getByTestId('chat-retry-persist')
  await expect(retryButton).toBeVisible()
  await retryButton.click()
  await expect(page.getByTestId('chat-persist-failed')).toHaveCount(0)
  await expect(page.getByTestId('chat-retry-persist')).toHaveCount(0)
})
