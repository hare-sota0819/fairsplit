import { expect, test, type Locator, type Page } from '@playwright/test'
import { goVia, openNav } from './nav'

test.use({ viewport: { width: 390, height: 844 } })

const uniqueEmail = (tag: string): string =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.goto('/signup')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
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
  // a subtree that appears to take sibling form state down with it. Not this
  // task's bug to fix — the documented workaround is to wait for hydration
  // to settle before filling.
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
  // Home is chat-only (Task 5, app-shell restructure): the composer is the
  // one thing guaranteed to be on the page regardless of group size, so its
  // presence is the "the join landed and the page rendered" signal — the
  // old signal (a `pairwise-row` naming the other member) lived on home's
  // now-removed per-person list; that same fact (the other member is a
  // real co-member) is what `/status` shows now, exercised directly by the
  // tests that need it, not by every join.
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

/** One participant pill on the chat confirm card, found by the name it shows. */
const participantPill = (page: Page, name: string): Locator =>
  page.locator('[data-testid^="chat-participant-"]').filter({ hasText: name })

/** The chat confirm card's payer control is a Radix Select, not a native one. */
async function chatChoosePayer(page: Page, name: string): Promise<void> {
  await page.getByTestId('chat-payer').click()
  await page.getByRole('option', { name, exact: true }).click()
}

/**
 * `/api/rates` proxies a real outbound call to Frankfurter, so it is stubbed
 * exactly as every other e2e spec stubs it (see trip-currency.spec.ts) —
 * a foreign-currency amount on the wizard's step 1 fires this fetch on
 * mount, chat handoff or not, so any test that lands on a foreign-currency
 * wizard screen needs it even without saving.
 */
async function stubRates(page: Page): Promise<void> {
  await page.route('**/api/rates**', (route) =>
    route.fulfill({
      json: { rate: '9', asOf: '2026-08-01', today: '2026-08-02' },
    }),
  )
}

/**
 * Plain assertions, deliberately: these used to carry a reload-recovery
 * fallback for the post-save refresh flake (docs/SOLVED.md 2026-08-09 —
 * this Next version's client intermittently drops the re-render a
 * router.refresh() commits through). The fix makes the saved confirmation
 * render straight from the action result (`success.feedRow` → a
 * `chat.savedSummary` assistant bubble in the transcript), so it no longer
 * depends on the refresh at all — a miss here is a real regression and must
 * fail loudly.
 */
async function expectSavedBubble(page: Page, text: string): Promise<void> {
  await expect(
    page.getByTestId('chat-saved-summary').filter({ hasText: text }),
  ).toBeVisible()
}

/** Same, for a count assertion instead of one named bubble. */
async function expectSavedBubbleCount(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId('chat-saved-summary')).toHaveCount(count)
}

/**
 * Home's chat-saved feed assertions moved in two steps (Task 5, app-shell
 * restructure): (a) the saved confirmation appears IN THE TRANSCRIPT,
 * proven above by `expectSavedBubble`/`expectSavedBubbleCount` right where
 * the old `feed-row`/`feed-row` count checks used to sit; (b) the row is
 * also durably visible on its new destination, `/history`, reached the way
 * a real user would — through the sidebar, not a direct `goto`. This helper
 * proves (b) once per flow (not after every single save — the mechanism
 * only needs proving once) and returns to `homeUrl` so the calling test can
 * keep chatting.
 */
async function expectHistoryRow(
  page: Page,
  homeUrl: string,
  text: string,
): Promise<void> {
  await goVia(page, 'history')
  await expect(
    page.getByTestId('feed-row').filter({ hasText: text }),
  ).toBeVisible()
  await page.goto(homeUrl)
}

/**
 * Task 7: end-to-end coverage for chat-first expense entry (Task 4's
 * ChatComposer + Task 6's wizard prefill handoff), plus three review debts
 * from earlier tasks that were only ever verified by hand or by a deleted
 * throwaway script. Task 5 of the app-shell restructure (2026-08-10) moved
 * the composer's cards into `ChatTranscript`'s bubble list and replaced the
 * home feed with an in-transcript saved-summary bubble — the flows below
 * are unchanged, only where the confirmation is looked for.
 *
 *  - Task 4: the "Save anyway" button flips `force` in the same click that
 *    submits the form — only a real browser click proves that ordering.
 *  - Task 6: a handoff prefill must win over a parked wizard draft at the
 *    same storage key, AND that draft must survive untouched so it can
 *    still be restored later — and the device-local timestamp correction
 *    must still run on a handoff mount even though an unused draft exists.
 */

test('one sentence becomes a saved, split expense; a missing amount asks instead of erroring', async ({
  page,
}) => {
  await signUp(page, 'Alice E2E', uniqueEmail('alice'))
  await createGroup(page, 'Chat Entry E2E', 'Alice')
  const homeUrl = page.url()

  // Happy path: one sentence, straight to a confirm card with sane defaults.
  await page.getByTestId('chat-input').fill('택시 8500원')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
  await expect(page.getByTestId('chat-amount')).toHaveText('₩8,500')
  await expect(page.getByTestId('chat-payer')).toContainText('Alice paid')
  const pills = page.locator('[data-testid^="chat-participant-"]')
  await expect(pills).toHaveCount(1)
  await expect(pills).toHaveAttribute('data-state', 'on')

  await page.getByTestId('chat-confirm-save').click()
  await expectSavedBubble(page, '택시')
  // Stay-on-success: this is the composer's opt-in `stay` path, not the
  // wizard's redirect — the URL must not have moved.
  await expect(page).toHaveURL(homeUrl)
  // The destination move, proven once: the sidebar's History item shows the
  // same expense server-rendered.
  await expectHistoryRow(page, homeUrl, '택시')

  // Root opens straight into the group whose expenses I most recently
  // entered — not a picker, since this expense was just entered here.
  await page.goto('/')
  await expect(page).toHaveURL(homeUrl)

  // Missing amount: the parser can't find one, so it asks instead of
  // erroring or silently dropping the sentence. A bare noun with no
  // pay-verb ('편의점' alone) is no longer treated as an expense attempt at
  // all since Task 6 of the assistant-brain plan (classify() now routes a
  // signal-free message to a guided reply, spec §2.3 P5/P6, instead of
  // always assuming "this is a new expense") — a pay-verb with no amount
  // ('냈어') is what still reaches EXPENSE_ENTRY missing only the amount.
  await page.getByTestId('chat-input').fill('편의점 냈어')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-ask-amount-card')).toBeVisible()
  await expect(page.getByTestId('chat-error')).toHaveCount(0)
  await page.getByTestId('chat-ask-amount-input').fill('3000')
  await page.getByTestId('chat-ask-amount').click()
  await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
  await expect(page.getByTestId('chat-amount')).toHaveText('₩3,000')

  await page.getByTestId('chat-confirm-save').click()
  await expectSavedBubble(page, '편의점')
  await expect(page).toHaveURL(homeUrl)
})

/**
 * Task 4 review debt: the server's duplicate guard re-offers the same save
 * with a "Save anyway" button, and that button sets `force: true` via its
 * own onClick handler AND submits the form as the click's default action.
 * Only a real browser click (not a unit test's synthetic dispatch) proves
 * the state update commits before the native submit fires.
 */
test('a duplicate re-offers the same save, and Save anyway actually saves it', async ({
  page,
}) => {
  await signUp(page, 'Bob E2E', uniqueEmail('bob'))
  await createGroup(page, 'Chat Duplicate E2E', 'Bob')

  await page.getByTestId('chat-input').fill('택시 8500원')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('chat-confirm-save').click()
  await expectSavedBubble(page, '택시')
  await expectSavedBubbleCount(page, 1)

  // Same sentence again, moments later: the server's own guard catches it.
  await page.getByTestId('chat-input').fill('택시 8500원')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
  await page.getByTestId('chat-confirm-save').click()
  await expect(page.getByTestId('chat-duplicate')).toBeVisible()
  // The duplicate attempt has not saved anything yet: still one bubble.
  await expectSavedBubbleCount(page, 1)

  await page.getByTestId('chat-confirm-save-anyway').click()
  await expectSavedBubbleCount(page, 2)
})

/**
 * A2 review guard (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차" follow-
 * up), narrowed by Task 3 (docs/handoff/B-multi-item-chat.md): a multi-
 * amount sentence must never resolve to a confident single-amount confirm
 * card built from the lone FIRST number `parse()` happens to report — that
 * guard itself is unchanged. What changed is the escape hatch: a
 * STRUCTURED multi-item sentence ("13000원 김치찌개 3개, 7000원 콜라 2개,
 * 400000원 와규 2개" — the sentence this test used to exercise) now parses
 * cleanly via `parseItems` into the items card instead of bouncing here; see
 * the new 'a clean multi-item sentence opens the items card…' test below for
 * that path. This test moves to a sentence `parseItems` genuinely REFUSES —
 * mixed currencies in the same breath ($ and 엔, the same fixture
 * `chat-parse/items.test.ts`'s "rejects mixed currencies" case uses) — so
 * the guard this test is actually about (never guess when the parse itself
 * is untrustworthy) still has a real case to cover: no confident ₩ card for
 * EITHER currency, and no items card either, since none of the three
 * numbers/currencies can be resolved into one sentence currency.
 */
test('an unparseable multi-amount sentence still gets the multiAmount notice, never a confident card', async ({
  page,
}) => {
  await signUp(page, 'Grace E2E', uniqueEmail('grace-multiamount'))
  await createGroup(page, 'Chat Multi Amount E2E', 'Grace')

  await page.getByTestId('chat-input').fill('$5 콜라 3개랑 700엔 피자 1개')
  await page.getByTestId('chat-send').click()

  await expect(page.getByTestId('chat-multi-amount-card')).toBeVisible()
  await expect(page.getByTestId('chat-confirm-card')).toHaveCount(0)
  await expect(page.getByTestId('chat-confirm-items-card')).toHaveCount(0)
  // No confident amount anywhere, and no Save button to confirm one through.
  await expect(page.getByTestId('chat-amount')).toHaveCount(0)
  await expect(page.getByTestId('chat-confirm-save')).toHaveCount(0)

  // The wizard escape stays available (never a dead end).
  await expect(page.getByTestId('chat-open-form')).toBeVisible()
  await page.getByTestId('chat-open-form').click()
  await expect(page).toHaveURL(/\/expenses\/new/)
  // No amount prefilled — neither currency's number is trustworthy alone.
  const url = new URL(page.url())
  expect(url.searchParams.get('draftAmount')).toBe('')
})

/**
 * Task 3 (docs/handoff/B-multi-item-chat.md): the owner's structured
 * "amount+name+quantity" sentence now parses into the "who had what" card
 * (`ChatAssignCard`) instead of the `multiAmount` notice — this is the main
 * new path the whole task exists for. A settlement-currency (KRW) sentence
 * is used rather than the owner's literal JPY example specifically to keep
 * this test independent of the RateCache-seeding machinery
 * `trip-currency.spec.ts`'s A2 test needs for a foreign-currency save — the
 * brief names this as an acceptable substitution where the scenario allows
 * it, and the parsing/assignment/save mechanics under test do not depend on
 * which currency is involved.
 *
 * Covers: 3 rows with exact per-line and grand totals: assigning ONE item
 * (leaving the other two unassigned, which is legal — the engine's
 * proportional rule handles it) and saving stores all 3 items with exact
 * unitAmounts/quantities, verified on the expense detail screen (not just
 * the chat card) so the round-trip through `saveExpense` is what is
 * actually proven, not just the client-side total.
 */
test('a clean multi-item sentence opens the items card; assigning one item and saving stores all 3 items exactly', async ({
  page,
}) => {
  await signUp(page, 'Ivy E2E', uniqueEmail('ivy-items'))
  await createGroup(page, 'Chat Items E2E', 'Ivy')

  await page.getByTestId('chat-input').fill(
    '13000원 김치찌개 3개, 7000원 콜라 2개, 400000원 와규 2개',
  )
  await page.getByTestId('chat-send').click()

  await expect(page.getByTestId('chat-confirm-items-card')).toBeVisible()
  await expect(page.getByTestId('chat-multi-amount-card')).toHaveCount(0)

  const rows = page.getByTestId('chat-assign-row')
  await expect(rows).toHaveCount(3)
  // Grand total, via the card's own summary line (app locale is EN here).
  await expect(page.getByTestId('chat-assign-summary')).toHaveText(
    '3 items · ₩853,000',
  )
  // Exact per-line totals: 13000*3, 7000*2, 400000*2.
  await expect(rows.filter({ hasText: '김치찌개' })).toContainText('₩39,000')
  await expect(rows.filter({ hasText: '콜라' })).toContainText('₩14,000')
  await expect(rows.filter({ hasText: '와규' })).toContainText('₩800,000')

  // Assign the 김치찌개 line to the sole member; leave 콜라/와규 unassigned.
  await rows.filter({ hasText: '김치찌개' }).getByTestId('chat-assign-toggle').click()
  await page.getByRole('checkbox', { name: 'Ivy' }).click()

  await page.getByTestId('chat-confirm-save').click()
  // Default title (spec item 5, "제목"/"Title" not the raw sentence): first
  // item's name + how many more (app locale is EN here).
  await expectSavedBubble(page, '김치찌개 +2 more')

  await goVia(page, 'history')
  await page.getByTestId('feed-row').filter({ hasText: '김치찌개' }).click()
  await page.getByTestId('feed-open').click()
  await expect(page).toHaveURL(/\/expenses\/[^/]+$/)

  await expect(page.getByTestId('expense-amount')).toContainText('₩853,000')

  const receiptRows = page.getByTestId('receipt-row')
  await expect(receiptRows).toHaveCount(3)
  const kimchi = receiptRows.filter({ hasText: '김치찌개' })
  await expect(kimchi).toContainText('₩13,000 × 3')
  await expect(kimchi).toContainText('₩39,000')
  const cola = receiptRows.filter({ hasText: '콜라' })
  await expect(cola).toContainText('₩7,000 × 2')
  await expect(cola).toContainText('₩14,000')
  const wagyu = receiptRows.filter({ hasText: '와규' })
  await expect(wagyu).toContainText('₩400,000 × 2')
  await expect(wagyu).toContainText('₩800,000')

  // The assignment made on the chat card round-tripped: 김치찌개 is Ivy's,
  // the other two are legally unassigned (proportional split, not dropped).
  await kimchi.click()
  await expect(kimchi.getByTestId('receipt-assignees')).toContainText('Ivy')
  await cola.click()
  await expect(cola.getByTestId('receipt-assignees')).toContainText(
    'Unassigned',
  )
  await wagyu.click()
  await expect(wagyu.getByTestId('receipt-assignees')).toContainText(
    'Unassigned',
  )
})

/**
 * A named member restricts participants to just the actor and that member —
 * not everyone — with a third, unmentioned member proving the difference.
 * Also exercises pill toggling (both directions, including the
 * minimum-one-participant guard) and switching the payer, which the chat
 * confirm card shares with the wizard's own controls.
 */
test('confirm card restricts participants to those named, with working toggles and payer switch', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signUp(ownerPage, 'Alice E2E', uniqueEmail('alice'))
  const groupUrl = await createGroup(ownerPage, 'Chat Restrict E2E', 'Alice')
  // Home is chat-only (Task 5, app-shell restructure): the invite link
  // lives on /invite now, not on home.
  await ownerPage.goto(`${groupUrl}/invite`)
  const invitePath = await ownerPage.getByTestId('invite-link').innerText()

  const minsuContext = await browser.newContext()
  const minsuPage = await minsuContext.newPage()
  await signUp(minsuPage, 'Minsu E2E', uniqueEmail('minsu'))
  await joinGroup(minsuPage, invitePath, '민수')

  const carolContext = await browser.newContext()
  const carolPage = await carolContext.newPage()
  await signUp(carolPage, 'Carol E2E', uniqueEmail('carol'))
  await joinGroup(carolPage, invitePath, 'Carol')

  await ownerPage.goto(groupUrl)
  await ownerPage.getByTestId('chat-input').fill('저녁 32000 민수랑')
  await ownerPage.getByTestId('chat-send').click()
  await expect(ownerPage.getByTestId('chat-confirm-card')).toBeVisible()
  await expect(ownerPage.getByTestId('chat-amount')).toHaveText('₩32,000')

  // Only the actor and the named member are selected — Carol, unmentioned,
  // is not, proving this is a real restriction and not just "everyone."
  await expect(participantPill(ownerPage, 'Alice')).toHaveAttribute(
    'data-state',
    'on',
  )
  await expect(participantPill(ownerPage, '민수')).toHaveAttribute(
    'data-state',
    'on',
  )
  await expect(participantPill(ownerPage, 'Carol')).toHaveAttribute(
    'data-state',
    'off',
  )

  // Toggling off leaves the other one still selected.
  await participantPill(ownerPage, 'Alice').click()
  await expect(participantPill(ownerPage, 'Alice')).toHaveAttribute(
    'data-state',
    'off',
  )
  await expect(participantPill(ownerPage, '민수')).toHaveAttribute(
    'data-state',
    'on',
  )

  // Untoggling the LAST remaining participant is refused, not applied.
  await participantPill(ownerPage, '민수').click()
  await expect(participantPill(ownerPage, '민수')).toHaveAttribute(
    'data-state',
    'on',
  )

  // Toggle Alice back on, then switch the payer.
  await participantPill(ownerPage, 'Alice').click()
  await expect(participantPill(ownerPage, 'Alice')).toHaveAttribute(
    'data-state',
    'on',
  )
  await chatChoosePayer(ownerPage, '민수')
  await expect(ownerPage.getByTestId('chat-payer')).toContainText('민수 paid')

  await ownerPage.getByTestId('chat-confirm-save').click()
  await expectSavedBubble(ownerPage, '저녁')

  await ownerContext.close()
  await minsuContext.close()
  await carolContext.close()
})

/**
 * Task 6 review debt: a chat handoff to the full wizard must win over a
 * parked wizard draft sitting at the same sessionStorage key — AND must
 * leave that draft untouched (not overwrite it) so it is still there to
 * restore later. This only ever ran as a deleted throwaway script; this is
 * its permanent coverage.
 *
 * Also pins the timestamp bug the ordering fix was originally about: a
 * handoff mount must still correct its "when" field from the SSR UTC-0
 * seed to the device's local time, even though an unused parked draft
 * exists at the same key (a stale `draft !== null` check used to skip that
 * correction in exactly this situation).
 */
test('a cross-currency handoff prefill wins over a parked draft, which survives to be restored', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const pageA = await ownerContext.newPage()
  await stubRates(pageA)
  await signUp(pageA, 'Dana E2E', uniqueEmail('dana'))
  const groupUrl = await createGroup(pageA, 'Chat Handoff E2E', 'Dana')
  // Home is chat-only (Task 5, app-shell restructure): the invite link
  // lives on /invite now, not on home.
  await pageA.goto(`${groupUrl}/invite`)
  const invitePath = await pageA.getByTestId('invite-link').innerText()
  const groupId = groupUrl.split('/').pop()!
  const draftStorageKey = `fairsplit:expense-draft:${groupId}:new`

  const minsuContext = await browser.newContext()
  const minsuPage = await minsuContext.newPage()
  await signUp(minsuPage, 'Minsu E2E', uniqueEmail('minsu'))
  await joinGroup(minsuPage, invitePath, '민수')

  // Park a partial draft: start an expense, type an amount, then leave
  // without saving.
  await pageA.goto(`${groupUrl}/expenses/new`)
  await pageA.getByTestId('amount').fill('7000')
  await pageA.waitForFunction(
    (key) => sessionStorage.getItem(key) !== null,
    draftStorageKey,
  )
  await pageA.goto(groupUrl)

  // From chat: a cross-currency mention (A2, docs/PROMPT.md "2026-08-11
  // 배포 후 폰 리뷰 2차) opens an ordinary confirm card now, not a dedicated
  // dead-end card — but its "open full form" escape link still exists for
  // the cases chat doesn't cover, and carries the SAME real draft values.
  await pageA.getByTestId('chat-input').fill('lunch $45.60 민수랑')
  await pageA.getByTestId('chat-send').click()
  await expect(pageA.getByTestId('chat-confirm-card')).toBeVisible()
  await pageA.getByTestId('chat-open-form').click()
  await expect(pageA).toHaveURL(/draftAmount=45\.60/)
  expect(pageA.url()).toContain('draftNote=lunch')
  expect(pageA.url()).toContain('draftCurrency=USD')

  // The handoff prefill wins — not the 7000 KRW parked a moment ago.
  await expect(pageA.getByTestId('amount')).toHaveValue('45.60')
  await expect(pageA.getByLabel('Currency')).toHaveValue('USD')

  // The device-local timestamp correction still ran on this handoff mount.
  const today = await pageA.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await expect(pageA.getByTestId('timestamp')).toHaveValue(
    new RegExp(`^${today}T`),
  )

  // Abandon the handoff without touching it further (reading values above
  // never patched any state), then come back plain: the parked draft — not
  // the handoff's 45.60 USD — is what is restored.
  await pageA.goto(groupUrl)
  await pageA.goto(`${groupUrl}/expenses/new`)
  await expect(pageA.getByTestId('amount')).toHaveValue('7000')
  await expect(pageA.getByLabel('Currency')).toHaveValue('KRW')

  await ownerContext.close()
  await minsuContext.close()
})

/**
 * The text index at runtime: it opens in place (no panel — the page under
 * it never moves), marks the current route in ink, and its invite item
 * actually reaches `/invite`.
 */
test('the text index opens in place, marks the current route, and its invite item reaches /invite', async ({
  page,
}) => {
  await signUp(page, 'Sidebar E2E', uniqueEmail('sidebar'))
  const groupName = 'Sidebar Nav E2E'
  await createGroup(page, groupName, 'Sam')

  const before = await page.getByTestId('chat-composer').boundingBox()
  await openNav(page)
  // Nothing beneath moved.
  expect(await page.getByTestId('chat-composer').boundingBox()).toEqual(before)
  await expect(page.getByTestId('nav-index')).toBeVisible()

  await page.getByTestId('nav-invite').click()
  await page.waitForURL(/\/invite$/)
  await expect(page.getByTestId('invite-link')).toBeVisible()
  await openNav(page)
  await expect(page.getByTestId('nav-invite')).toHaveAttribute('aria-current', 'page')
})

/**
 * Task 2's contract, reassigned to T6 (never landed as its own e2e coverage
 * until now): home caps its feed at 10 rows, but that cap lives at home's
 * own call site — history calls the same `buildFeedRows` builder uncapped.
 * 11 expenses proves both halves at once: more than the old home cap, all
 * present on history.
 */
test('history renders every expense with no cap, past the old home ten-row limit', async ({
  page,
}) => {
  // The tightest test in the suite: 11 full chat round-trips in one test,
  // each its own server action + duplicate-guard query. The default 60s
  // (playwright.config.ts) leaves little headroom if any one round-trip is
  // slow, so this one gets more room rather than risking a flake that has
  // nothing to do with what it is actually checking.
  test.setTimeout(120_000)
  await signUp(page, 'History Cap E2E', uniqueEmail('historycap'))
  await createGroup(page, 'History Cap E2E Group', 'Sam')

  for (let i = 1; i <= 11; i += 1) {
    // Amounts spaced 10,000 won apart, not merely incremented by 1: the
    // server's duplicate guard (expenses/actions.ts) flags any two expenses
    // in the same currency within 3 hours whose amounts are within 1% of
    // each other — near-identical amounts a second apart would all collide
    // with the FIRST save and re-offer it instead of saving a new one,
    // silently capping this loop at one real expense.
    await page.getByTestId('chat-input').fill(`택시 ${10_000 * i}원`)
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    await page.getByTestId('chat-confirm-save').click()
    // Asserts the COUNT, not just visibility of a matching bubble — with a
    // shared title ('택시') every iteration, a visibility-only check would
    // stay trivially true even if a later save silently failed to add one.
    await expectSavedBubbleCount(page, i)
  }

  // Regression (owner's phone report 2026-08-13): the auto-scroll's
  // `scrollIntoView({block:'end'})` used to align the newest bubble's
  // bottom with the VIEWPORT bottom — behind the fixed composer dock —
  // whenever the transcript overflowed (as it does after 11 saves here).
  // The bubble now carries a `scroll-margin-bottom` sized to the dock, so
  // its bottom edge must land ABOVE the dock's top edge once the smooth
  // scroll settles.
  await expect(async () => {
    const bubbles = page.getByTestId('chat-message-assistant')
    const lastBubble = await bubbles.last().boundingBox()
    const dock = await page.getByTestId('chat-composer-dock').boundingBox()
    expect(lastBubble).not.toBeNull()
    expect(dock).not.toBeNull()
    expect(lastBubble!.y + lastBubble!.height).toBeLessThanOrEqual(dock!.y + 1)
  }).toPass({ timeout: 5_000 })

  await goVia(page, 'history')
  await expect(page.getByTestId('feed-row')).toHaveCount(11)
})
