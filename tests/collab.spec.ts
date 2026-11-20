/**
 * Multi-user collaboration spec — verifies two users sign in into
 * separate browser contexts and the app distinguishes them.
 *
 * `users(2)` takes any two accounts from your pool, so this spec passes on a
 * fresh app with no setup beyond having two test accounts:
 *   npx deepspace test accounts list
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * Ask for accounts *by name* (`users(['Alice', 'Bob'])`) only when the
 * behaviour under test depends on which identity acts — otherwise naming them
 * couples the spec to one machine's pool.
 *
 * The `users` fixture handles sign-in caching (per-account storageState
 * persisted to `~/.deepspace/playwright-states/`), context creation, and
 * cleanup. No need to manage browser contexts manually.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

// A machine that has never created test accounts is the normal state of a
// fresh checkout, and there `users()` throws — turning "you have no pool yet"
// into three red tests about the app, which it is not. Skip the file instead
// and say what creates the pool. The count is of accounts usable HERE: the
// pool is global per developer, but passwords live only on the machine that
// created the account.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  // /home is dynamic (under src/pages/(app)/), so it mounts the nav shell;
  // '/' is the static landing and has no navigation.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Email, not name. The page renders the *session's* `name || email`, while
  // `user.name` here comes from the LOCAL account registry — and the two are
  // not the same fact: a display name is optional, and an account recovered on
  // another machine has none stored locally at all. The email is the credential
  // the context signed in with, so it is the one identity both sides agree on,
  // and asserting it proves the page is showing THIS browser's account.
  // The two accounts are distinct, so two exact matches is also the proof that
  // the contexts are not sharing one session.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // The identity chip shows `name || email`. Its text is not predictable, but
    // its presence is: something must be there once the profile has loaded.
    // (It is `hidden sm:inline` in some templates, so assert text, not
    // visibility.)
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('API status page renders loading success and error states', async ({ users }) => {
  const [user] = await users(1)
  let shouldFail = false
  let requestCount = 0
  let releaseSuccessResponse!: () => void
  const successResponseGate = new Promise<void>((resolve) => {
    releaseSuccessResponse = resolve
  })

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    if (shouldFail) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
      })
      return
    }

    await successResponseGate
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { integrations: { openai: {}, wikipedia: {} } } }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  releaseSuccessResponse()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()
  await expect(user.page.getByText('2 integrations available.')).toBeVisible()

  shouldFail = true
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect(user.page.getByText('Catalog unavailable')).toBeVisible()
  await expect(user.page.getByText('Showing the last loaded catalog')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('API status page shows local retry after first-load API failure', async ({ users }) => {
  const [user] = await users(1)
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Could not load API data')).toBeVisible()
  await expect(user.page.getByText('Retried 1 time automatically.')).toBeVisible()

  const retryButton = user.page.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await retryButton.click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('Alice can create an interview room and access its shared notes', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const roomName = `Alice E2E room ${Date.now()}`

  await alice.page.goto('/home')
  await expect(alice.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

  await alice.page.getByRole('button', { name: 'Create room', exact: true }).click()
  const dialog = alice.page.getByRole('dialog', { name: 'Create an interview room' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Room name').fill(roomName)
  await dialog.getByRole('combobox', { name: 'Coding challenge' }).click()
  await alice.page.getByRole('option', { name: /Two Sum/ }).click()
  await dialog.getByRole('button', { name: 'Create room', exact: true }).click()

  await expect(alice.page).toHaveURL(/\/rooms\/[^/]+$/, { timeout: 15_000 })
  await expect(alice.page.getByRole('heading', { name: roomName })).toBeVisible()
  await expect(
    alice.page.getByRole('textbox', { name: 'Shared interview notes' }),
  ).toBeEnabled({ timeout: 15_000 })
})

test('Alice and Bob can collaborate in an invited interview room', async ({ users }) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const roomName = `Alice and Bob E2E room ${uniqueId}`
  const note = `Shared interview note ${uniqueId}`

  await alice.page.goto('/home')
  await expect(alice.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  await alice.page.getByRole('button', { name: 'Create room', exact: true }).click()

  const dialog = alice.page.getByRole('dialog', { name: 'Create an interview room' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Room name').fill(roomName)
  await dialog.getByRole('combobox', { name: 'Coding challenge' }).click()
  await alice.page.getByRole('option', { name: /Two Sum/ }).click()
  await dialog.getByRole('button', { name: 'Create room', exact: true }).click()

  await expect(alice.page).toHaveURL(/\/rooms\/[^/]+$/, { timeout: 15_000 })
  const roomUrl = alice.page.url()
  await expect(alice.page.getByRole('heading', { name: roomName })).toBeVisible()
  await expect(alice.page.getByRole('textbox', { name: 'Shared interview notes' })).toBeEnabled({
    timeout: 15_000,
  })

  await alice.page.getByLabel('Collaborator email').fill('pairprep-bob-20261119@deepspace.test')
  await alice.page.getByRole('button', { name: 'Add collaborator', exact: true }).click()
  await expect(
    alice.page.getByRole('status').filter({ hasText: 'Collaborator added' }),
  ).toBeVisible({ timeout: 15_000 })

  await bob.page.goto(roomUrl)
  await expect(bob.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 15_000 })
  const bobNotes = bob.page.getByRole('textbox', { name: 'Shared interview notes' })
  await expect(bobNotes).toBeEnabled({ timeout: 15_000 })

  await alice.page.getByRole('textbox', { name: 'Shared interview notes' }).fill(note)
  await expect(bobNotes).toHaveValue(note, { timeout: 15_000 })
})
