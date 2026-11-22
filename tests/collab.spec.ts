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
import type { Page, WebSocketRoute } from '@playwright/test'

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


function mockAiCoachMessages(page: Page) {
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  let subscription:
    | {
        socket: WebSocketRoute
        subscriptionId: string
        userId: string
        roomId: string
      }
    | undefined

  const records: Array<{
    recordId: string
    data: {
      userId: string
      roomId: string
      role: 'user' | 'assistant'
      content: string
      createdAt: string
    }
    createdBy: string
    createdAt: string
    updatedAt: string
  }> = []

  function publish() {
    if (!subscription) return

    subscription.socket.send(JSON.stringify({
      type: 'core.query_result',
      payload: {
        subscriptionId: subscription.subscriptionId,
        records: records.toReversed(),
      },
    }))
  }

  function addMessage(role: 'user' | 'assistant', content: string) {
    if (!subscription) {
      throw new Error('AI Coach message subscription is not ready.')
    }

    const timestamp = new Date().toISOString()

    records.push({
      recordId: `mock-${records.length + 1}`,
      data: {
        userId: subscription.userId,
        roomId: subscription.roomId,
        role,
        content,
        createdAt: timestamp,
      },
      createdBy: subscription.userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    publish()
  }

  const setup = page.routeWebSocket('**/ws/**', (socket) => {
    const server = socket.connectToServer()

    socket.onMessage((message) => {
      try {
        const parsed = JSON.parse(String(message))
        const query = parsed.payload?.query

        if (
          parsed.type === 'core.subscribe' &&
          query?.collection === 'aiCoachMessages'
        ) {
          subscription = {
            socket,
            subscriptionId: parsed.payload.subscriptionId,
            userId: query.where?.userId,
            roomId: query.where?.roomId,
          }
          resolveReady()
          publish()
          return
        }
      } catch {
        // Forward messages that are not JSON.
      }

      server.send(message)
    })
  })

  return { setup, ready, addMessage }
}

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

test('Create Room dialog loads on demand and supports keyboard interaction', async ({ users }) => {
  const [alice] = await users(['Alice'])
  let releaseDialogModule!: () => void
  const dialogModuleGate = new Promise<void>((resolve) => {
    releaseDialogModule = resolve
  })
  let dialogModuleRequests = 0

  await alice.page.route('**/src/components/CreateRoomDialog.tsx*', async (route) => {
    dialogModuleRequests += 1
    await dialogModuleGate
    await route.continue()
  })

  try {
    await alice.page.goto('/home')
    await expect(alice.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
    expect(dialogModuleRequests).toBe(0)

    const createButton = alice.page.getByRole('button', { name: 'Create room', exact: true })
    await createButton.click()
    const loading = alice.page.getByRole('status').filter({ hasText: 'Opening the room form…' })
    await expect(loading).toBeVisible()
    await expect.poll(() => dialogModuleRequests).toBe(1)
    releaseDialogModule()

    const dialog = alice.page.getByRole('dialog', { name: 'Create an interview room' })
    await expect(dialog).toBeVisible()
    const roomName = dialog.getByRole('textbox', { name: 'Room name' })
    await expect(roomName).toBeVisible()
    await expect(roomName).toBeFocused()

    await alice.page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(createButton).toBeFocused()

    await createButton.click()
    await expect(dialog).toBeVisible()
    const challenge = dialog.getByRole('combobox', { name: 'Coding challenge' })
    await challenge.press('ArrowDown')
    await expect(alice.page.getByRole('option', { name: /Two Sum/ })).toBeVisible()
    await alice.page.keyboard.press('Enter')
    await expect(challenge).toContainText(/Two Sum/)
    await expect(roomName).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(dialogModuleRequests).toBe(1)
  } finally {
    releaseDialogModule()
  }
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

test('room owner cannot change immutable ownerId or teamId fields', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const roomName = `__test-${Date.now()}__ Protected fields E2E`

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
  const roomId = new URL(roomUrl).pathname.match(/\/rooms\/([^/]+)$/)?.[1]
  expect(roomId).toBeTruthy()

  await alice.page.goto(`/room-mutation-test?roomId=${encodeURIComponent(roomId!)}`)
  await expect(alice.page.getByRole('heading', { name: 'Development room mutation probe' })).toBeVisible()
  await expect(alice.page.getByTestId('mutation-probe-ready')).toHaveText('Ready', { timeout: 15_000 })

  await alice.page.getByRole('button', { name: 'Attempt ownerId update' }).click()
  await expect(alice.page.getByTestId('ownerId-update-result')).toHaveText(
    "Cannot modify immutable field 'ownerId'",
    { timeout: 15_000 },
  )

  await alice.page.getByRole('button', { name: 'Attempt teamId update' }).click()
  await expect(alice.page.getByTestId('teamId-update-result')).toHaveText(
    "Cannot modify immutable field 'teamId'",
    { timeout: 15_000 },
  )

  await alice.page.goto(roomUrl)
  await expect(alice.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 15_000 })
  await expect(alice.page.getByText('You own this room')).toBeVisible()
})

test('an uninvited user cannot access a private interview room', async ({ users }) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  const roomName = `Private room access E2E ${Date.now()}`

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

  await bob.page.goto(roomUrl)
  await expect(bob.page.getByRole('heading', { name: 'Room unavailable' })).toBeVisible({ timeout: 15_000 })
  await expect(bob.page.getByText('This room may not exist, or you may not have access to it.')).toBeVisible()
  await expect(bob.page.getByRole('heading', { name: roomName })).toHaveCount(0)
  await expect(bob.page.getByRole('heading', { name: 'Shared interview notes' })).toHaveCount(0)
  await expect(bob.page.getByRole('heading', { name: 'Participants' })).toHaveCount(0)
  await expect(bob.page.getByRole('heading', { name: 'AI interview coach' })).toHaveCount(0)
  await expect(bob.page.getByRole('heading', { name: 'Technical research' })).toHaveCount(0)
})

test('a non-owner cannot invite a participant to another user’s room', async ({ users }) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  const roomName = `Owner-only invitation E2E ${Date.now()}`

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
  const roomId = new URL(roomUrl).pathname.match(/\/rooms\/([^/]+)$/)?.[1]
  expect(roomId).toBeTruthy()
  await expect(alice.page.getByRole('heading', { name: roomName })).toBeVisible()

  await bob.page.goto('/home')
  await expect(bob.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  await bob.page.goto(roomUrl)
  await expect(bob.page.getByRole('heading', { name: 'Room unavailable' })).toBeVisible({ timeout: 15_000 })

  const invitationResult = await bob.page.evaluate(async ({ roomId, email }) => {
    const { callServerAction } = await import('/src/lib/server-actions.ts')
    try {
      await callServerAction('rooms.invite', { roomId, email })
      return { error: null }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, { roomId: roomId!, email: alice.email })

  expect(invitationResult.error).toBe('Only the room owner can invite participants.')
  await expect(alice.page.getByRole('heading', { name: roomName })).toBeVisible()
  await expect(alice.page.getByRole('textbox', { name: 'Shared interview notes' })).toBeEnabled({
    timeout: 15_000,
  })
  await expect(bob.page.getByText(/Collaborator added|invitation email sent|room access granted/i)).toHaveCount(0)
  await expect(bob.page.getByRole('heading', { name: 'Room unavailable' })).toBeVisible()
})

test('completed interview history and self-reviews survive reload and stay private', async ({ users }) => {
  const [owner, outsider] = await users(2)
  const roomName = `Interview history ${Date.now()}`
  const summary = 'I explained the time complexity and validated my approach.'
  const history = (page: Page) => page.getByRole('region', { name: 'Interview history' })

  await owner.page.setViewportSize({ width: 320, height: 760 })
  await owner.page.goto('/home')
  await owner.page.getByRole('button', { name: 'Create room', exact: true }).click()
  const dialog = owner.page.getByRole('dialog', { name: 'Create an interview room' })
  await dialog.getByLabel('Room name').fill(roomName)
  await dialog.getByRole('combobox', { name: 'Coding challenge' }).click()
  await owner.page.getByRole('option', { name: /Two Sum/ }).click()
  await dialog.getByRole('button', { name: 'Create room', exact: true }).click()
  await expect(owner.page).toHaveURL(/\/rooms\/[^/]+$/)
  const roomUrl = owner.page.url()

  await owner.page.getByRole('link', { name: 'Back to workspace' }).click()
  await expect(owner.page.getByRole('link', { name: new RegExp(roomName) })).toBeVisible()
  await expect(history(owner.page).getByRole('link', { name: roomName })).toHaveCount(0)
  await owner.page.getByRole('link', { name: new RegExp(roomName) }).click()
  await owner.page.getByRole('button', { name: 'Mark session complete' }).click()
  await owner.page.getByLabel('Overall summary').fill(summary)
  await owner.page.getByLabel('Strengths').fill('Worked through examples.')
  await owner.page.getByLabel('Areas for improvement').fill('Explain edge cases earlier.')
  await owner.page.getByRole('button', { name: 'Save review' }).click()
  await expect(owner.page.getByText('Review saved.', { exact: true })).toBeVisible()
  expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)

  await owner.page.reload()
  await expect(owner.page.getByText(summary, { exact: true })).toBeVisible()
  await owner.page.getByRole('link', { name: 'Back to workspace' }).click()
  const entry = history(owner.page).getByRole('listitem').filter({ hasText: roomName })
  await expect(entry.locator('time')).toHaveAttribute('datetime', /T/)
  await entry.getByRole('link', { name: 'View reviews' }).click()
  await expect(owner.page).toHaveURL(/#reviews$/)
  await expect(owner.page.getByText(summary, { exact: true })).toBeVisible()

  await outsider.page.goto('/home')
  await expect(history(outsider.page).getByRole('heading', { name: 'Interview history' })).toBeVisible()
  await expect(history(outsider.page).getByRole('link', { name: roomName })).toHaveCount(0)
  await outsider.page.goto(`${roomUrl}#reviews`)
  await expect(outsider.page.getByRole('heading', { name: 'Room unavailable' })).toBeVisible()
  await expect(outsider.page.getByText(summary, { exact: true })).toHaveCount(0)
})

test('invited participants can collaborate until the owner revokes their access', async ({ users, request }) => {
  // Stop before any provider-backed action if the test service binding is missing.
  const catalog = await request.get('/api/integrations')
  expect(await catalog.json()).toEqual({ mode: 'pairprep-local-mock' })
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

  await bob.page.goto('/home')
  await bob.page.getByRole('button', { name: 'Account menu' }).click()
  await expect(bob.page.getByTestId('nav-user-email')).toHaveText(bob.email)
  await alice.page.getByLabel('Collaborator email').fill(bob.email)
  await alice.page.getByRole('button', { name: 'Add collaborator', exact: true }).click()
  await expect(
    alice.page.getByRole('status').filter({ hasText: 'Collaborator added and invitation email sent.' }),
  ).toBeVisible({ timeout: 15_000 })

  await bob.page.goto(roomUrl)
  await expect(bob.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 15_000 })
  const bobNotes = bob.page.getByRole('textbox', { name: 'Shared interview notes' })
  await expect(bobNotes).toBeEnabled({ timeout: 15_000 })

  await alice.page.getByRole('textbox', { name: 'Shared interview notes' }).fill(note)
  await expect(bobNotes).toHaveValue(note, { timeout: 15_000 })
  await expect(bob.page.getByRole('button', { name: /Remove/ })).toHaveCount(0)

  await alice.page.getByRole('textbox', { name: 'Message the interview coach' }).fill('How can I look up the complement?')
  await alice.page.getByRole('button', { name: 'Send message' }).click()
  await expect(alice.page.getByText(/Mock coach:/)).toBeVisible()
  await alice.page.getByRole('button', { name: 'Clear conversation' }).click()
  await expect(alice.page.getByText('Conversation cleared.', { exact: true })).toBeVisible()
  await expect(alice.page.getByText(/Mock coach:/)).toHaveCount(0)
  await alice.page.getByRole('textbox', { name: 'Search technical topics' }).fill('JavaScript Map')
  await alice.page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(alice.page.getByRole('link', { name: 'Mock research result: JavaScript Map' })).toBeVisible()

  await alice.page.getByRole('button', { name: 'Mark session complete' }).click()
  await alice.page.getByLabel('Overall summary').fill('Private owner reflection.')
  await alice.page.getByLabel('Strengths').fill('Explained the trade-offs.')
  await alice.page.getByLabel('Areas for improvement').fill('Check edge cases earlier.')
  await alice.page.getByRole('button', { name: 'Save review' }).click()
  await expect(alice.page.getByText('Private owner reflection.', { exact: true })).toBeVisible()
  await expect(bob.page.getByText('You haven’t written a review for this session yet.')).toBeVisible()
  await expect(bob.page.getByText('Private owner reflection.', { exact: true })).toHaveCount(0)

  await alice.page.getByRole('button', { name: /^Remove / }).click()
  await expect(alice.page.getByText('Participant removed.', { exact: true })).toBeVisible()
  await expect(bob.page.getByRole('heading', { name: 'Room unavailable' })).toBeVisible({ timeout: 15_000 })
  await expect(bobNotes).toHaveCount(0)
  await bob.page.reload()
  await expect(bob.page.getByRole('heading', { name: 'Room unavailable' })).toBeVisible()
})

test('AI Coach displays a successful mocked response', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const roomName = `AI Coach success E2E room ${Date.now()}`
  const userMessage = 'Can you give me a small hint for Two Sum?'
  const coachReply = 'Consider how a map could help you remember values as you scan the numbers.'

  const coachMock = mockAiCoachMessages(alice.page)
  await coachMock.setup

  await alice.page.route('**/api/actions/rooms.coach', async (route) => {
    const request = route.request().postDataJSON() as { message?: string }
    coachMock.addMessage('user', request.message ?? '')
    coachMock.addMessage('assistant', coachReply)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { reply: coachReply } }),
    })
  })

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
  await coachMock.ready
  const coachInput = alice.page.getByRole('textbox', { name: 'Message the interview coach' })
  await coachInput.fill(userMessage)
  await alice.page.getByRole('button', { name: 'Send message' }).click()

  await expect(alice.page.getByText(userMessage, { exact: true })).toBeVisible()
  await expect(alice.page.getByText(coachReply, { exact: true })).toBeVisible()

  await alice.page.reload()
  await expect(alice.page.getByText(userMessage, { exact: true })).toBeVisible()
  await expect(alice.page.getByText(coachReply, { exact: true })).toBeVisible()
})

test('AI Coach loading state disables input until the mocked response arrives', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const roomName = `AI Coach loading E2E room ${Date.now()}`
  let releaseCoachResponse!: () => void
  const coachResponseGate = new Promise<void>((resolve) => {
    releaseCoachResponse = resolve
  })

  const coachMock = mockAiCoachMessages(alice.page)
  await coachMock.setup

  await alice.page.route('**/api/actions/rooms.coach', async (route) => {
    const request = route.request().postDataJSON() as { message?: string }
    coachMock.addMessage('user', request.message ?? '')
    await coachResponseGate
    coachMock.addMessage('assistant', 'Think about storing each number you have already seen.')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { reply: 'Think about storing each number you have already seen.' },
      }),
    })
  })

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
  await coachMock.ready
  const coachInput = alice.page.getByRole('textbox', { name: 'Message the interview coach' })
  const sendButton = alice.page.getByRole('button', { name: 'Send message' })
  await coachInput.fill('Please give me one hint.')
  await sendButton.click()

  const loading = alice.page.getByText('Coach is thinking…', { exact: true })
  await expect(loading).toBeVisible()
  await expect(coachInput).toBeDisabled()
  await expect(sendButton).toBeDisabled()

  releaseCoachResponse()
  await expect(loading).toBeHidden()
  await expect(alice.page.getByText('Think about storing each number you have already seen.', { exact: true })).toBeVisible()
  await expect(coachInput).toBeEnabled()
})

test('AI Coach displays request errors and remains usable', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const roomName = `AI Coach error E2E room ${Date.now()}`

  const coachMock = mockAiCoachMessages(alice.page)
  await coachMock.setup

  await alice.page.route('**/api/actions/rooms.coach', async (route) => {
    const request = route.request().postDataJSON() as { message?: string }
    coachMock.addMessage('user', request.message ?? '')
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'The AI coach is temporarily unavailable.' }),
    })
  })

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
  await coachMock.ready
  const coachInput = alice.page.getByRole('textbox', { name: 'Message the interview coach' })
  await coachInput.fill('How should I begin?')
  await alice.page.getByRole('button', { name: 'Send message' }).click()

  await expect(alice.page.getByRole('alert').filter({
    hasText: 'The AI coach is temporarily unavailable.',
  })).toBeVisible()
  await expect(coachInput).toBeEnabled()
  await coachInput.fill('I can still ask another question.')
  await expect(alice.page.getByRole('button', { name: 'Send message' })).toBeEnabled()
})

test('AI Coach handles a mocked action failure and can retry', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const roomName = `AI Coach transport error E2E room ${Date.now()}`
  let requestCount = 0

  // This is the action response the UI receives when the server catches an
  // unexpected provider transport exception; the route prevents any real call.
  const coachMock = mockAiCoachMessages(alice.page)
  await coachMock.setup

  await alice.page.route('**/api/actions/rooms.coach', async (route) => {
    const request = route.request().postDataJSON() as { message?: string }
    coachMock.addMessage('user', request.message ?? '')
    requestCount += 1
    if (requestCount === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'The AI coach is temporarily unavailable. Please try again.' }),
      })
      return
    }
    coachMock.addMessage('assistant', 'Let’s work through the problem step by step.')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { reply: 'Let’s work through the problem step by step.' } }),
    })
  })

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
  await coachMock.ready
  const coachInput = alice.page.getByRole('textbox', { name: 'Message the interview coach' })
  await coachInput.fill('Could you offer a hint?')
  await alice.page.getByRole('button', { name: 'Send message' }).click()

  await expect(alice.page.getByRole('alert').filter({
    hasText: 'The AI coach is temporarily unavailable. Please try again.',
  })).toBeVisible()
  await expect(coachInput).toBeEnabled()

  await coachInput.fill('I would like to try again.')
  await alice.page.getByRole('button', { name: 'Send message' }).click()
  await expect(alice.page.getByText('Let’s work through the problem step by step.')).toBeVisible()
  expect(requestCount).toBe(2)
})

test('Technical Research displays mocked search results', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const roomName = `Technical research success E2E room ${Date.now()}`
  const results = [
    { title: 'A Practical Guide to Hash Tables', url: 'https://example.com/hash-tables' },
    { title: 'Algorithm Design: Two Sum with a Hash Map', url: 'https://algorithms.example.org/two-sum' },
  ]

  await alice.page.route('**/api/actions/rooms.research', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { results } }),
    })
  })

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
  const searchInput = alice.page.getByRole('textbox', { name: 'Search technical topics' })
  await searchInput.fill('hash maps in algorithm interviews')
  await alice.page.getByRole('button', { name: 'Search', exact: true }).click()

  for (const result of results) {
    await expect(alice.page.getByRole('link', { name: result.title })).toHaveAttribute('href', result.url)
    await expect(alice.page.getByText(result.url, { exact: true })).toBeVisible()
  }
})

test('Technical Research loading state disables search input until results arrive', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const roomName = `Technical research loading E2E room ${Date.now()}`
  let releaseResearchResponse!: () => void
  const researchResponseGate = new Promise<void>((resolve) => {
    releaseResearchResponse = resolve
  })
  const results = [{ title: 'Hash Map Fundamentals', url: 'https://example.com/hash-map-fundamentals' }]

  await alice.page.route('**/api/actions/rooms.research', async (route) => {
    await researchResponseGate
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { results } }),
    })
  })

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
  const searchInput = alice.page.getByRole('textbox', { name: 'Search technical topics' })
  await searchInput.fill('hash map fundamentals')
  await alice.page.getByRole('button', { name: 'Search', exact: true }).click()

  const loading = alice.page.getByText('Searching technical sources…', { exact: true })
  await expect(loading).toBeVisible()
  await expect(searchInput).toBeDisabled()

  releaseResearchResponse()
  await expect(loading).toBeHidden()
  await expect(alice.page.getByRole('link', { name: results[0].title })).toHaveAttribute('href', results[0].url)
  await expect(searchInput).toBeEnabled()
})

test('Technical Research shows errors and keeps search usable', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const roomName = `Technical research error E2E room ${Date.now()}`
  const errorMessage = 'Technical research is temporarily unavailable. Please try again.'

  await alice.page.route('**/api/actions/rooms.research', async (route) => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: errorMessage }),
    })
  })

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
  const searchInput = alice.page.getByRole('textbox', { name: 'Search technical topics' })
  await searchInput.fill('binary search complexity')
  await alice.page.getByRole('button', { name: 'Search', exact: true }).click()

  await expect(alice.page.getByRole('alert').filter({ hasText: errorMessage })).toBeVisible()
  await expect(searchInput).toBeEnabled()
  await searchInput.fill('I can search again')
  await expect(alice.page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled()
})
