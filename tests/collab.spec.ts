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
  await expect(bob.page.getByRole('region', { name: 'Collaborative code editor' })).toHaveCount(0)
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

test('only the owner can delete a room and active collaborators return to the dashboard', async ({ users, request }) => {
  expect(await (await request.get('/api/integrations')).json()).toEqual({ mode: 'pairprep-local-mock' })
  const [owner, collaborator] = await users(2)
  const roomName = `__test-${Date.now()}__ Room deletion`
  await owner.page.goto('/home')
  await owner.page.getByRole('button', { name: 'Create room', exact: true }).click()
  const create = owner.page.getByRole('dialog', { name: 'Create an interview room' })
  await create.getByLabel('Room name').fill(roomName)
  await create.getByRole('combobox', { name: 'Coding challenge' }).click()
  await owner.page.getByRole('option', { name: /Two Sum/ }).click()
  await create.getByRole('button', { name: 'Create room', exact: true }).click()
  await expect(owner.page).toHaveURL(/\/rooms\/[^/]+$/)
  const roomUrl = owner.page.url()
  const roomId = new URL(roomUrl).pathname.split('/').at(-1)!

  await collaborator.page.goto('/home')
  await expect(collaborator.page.getByTestId('app-navigation')).toBeVisible()
  await owner.page.getByLabel('Collaborator email').fill(collaborator.email)
  await owner.page.getByRole('button', { name: 'Add collaborator', exact: true }).click()
  await expect(owner.page.getByText(/Collaborator added/)).toBeVisible()
  await collaborator.page.goto(roomUrl)
  await expect(collaborator.page.getByRole('heading', { name: roomName })).toBeVisible()
  await expect(collaborator.page.getByRole('button', { name: 'Room options' })).toHaveCount(0)

  const attemptDelete = (page: Page) => page.evaluate(async (id) => {
    // Use the app's action client so identity is supplied by the signed-in session.
    const { callServerAction } = await import('/src/lib/server-actions.ts')
    return callServerAction('rooms.delete', { roomId: id }).catch((error: Error) => error.message)
  }, roomId)
  expect((await request.post('/api/actions/rooms.delete', { data: { roomId } })).status()).toBe(401)
  const denied = collaborator.page.waitForResponse('**/api/actions/rooms.delete')
  expect(await attemptDelete(collaborator.page)).toMatch(/Only the room owner/)
  expect((await denied).status()).toBe(403)
  await expect(owner.page.getByRole('heading', { name: roomName })).toBeVisible()

  const notes = owner.page.getByRole('textbox', { name: 'Shared interview notes' })
  await notes.fill('Shared notes to delete')
  await expect(collaborator.page.getByRole('textbox', { name: 'Shared interview notes' })).toHaveValue('Shared notes to delete')
  const editor = owner.page.getByRole('region', { name: 'Collaborative code editor' })
  await expect(editor.getByRole('combobox')).toBeEnabled()
  await editor.locator('textarea.inputarea').focus()
  await owner.page.keyboard.insertText('const deleteMe = true')
  await expect(collaborator.page.locator('.view-lines')).toContainText('deleteMe')
  await owner.page.getByRole('textbox', { name: 'Message the interview coach' }).fill('How can I look up the complement?')
  await owner.page.getByRole('button', { name: 'Send message' }).click()
  await expect(owner.page.getByText(/Mock coach:/)).toBeVisible()

  const openDelete = async () => {
    await owner.page.getByRole('button', { name: 'Room options' }).click()
    await owner.page.getByRole('menuitem', { name: 'Delete Room' }).click()
  }
  const confirm = owner.page.getByRole('dialog', { name: 'Delete Room?' })
  await openDelete()
  await expect(confirm).toContainText('This action cannot be undone.')
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toBeHidden()
  await expect(collaborator.page.getByRole('heading', { name: roomName })).toBeVisible()

  await openDelete()
  const confirmDelete = confirm.getByRole('button', { name: 'Delete Room', exact: true })
  await owner.page.route('**/api/actions/rooms.delete', (route) => route.fulfill({
    status: 503,
    json: { success: false, error: 'Could not delete the room. Try again.' },
  }), { times: 1 })
  await confirmDelete.click()
  await expect(confirm.getByRole('alert')).toHaveText('Could not delete the room. Try again.')
  await expect(collaborator.page.getByRole('heading', { name: roomName })).toBeVisible()
  await confirmDelete.click()
  await expect(owner.page).toHaveURL(/\/home$/)
  await expect(owner.page.getByText('Room deleted.', { exact: true })).toBeVisible()
  await expect(collaborator.page).toHaveURL(/\/home$/)
  await expect(collaborator.page.getByText('This room is no longer available.', { exact: true })).toBeVisible()
  for (const { page } of [owner, collaborator]) {
    const rooms = page.getByRole('region', { name: 'Interview rooms' })
    await expect(rooms).toBeVisible()
    await expect(rooms.getByText(roomName, { exact: true })).toHaveCount(0)
    await page.goto(roomUrl)
    await expect(page.getByRole('heading', { name: 'Room unavailable' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Shared interview notes' })).toHaveCount(0)
  }
})

test('two browsers exchange WebRTC media and keep coding while room access is enforced', async ({ users, request }) => {
  test.setTimeout(55_000)
  expect(await (await request.get('/api/integrations')).json()).toEqual({ mode: 'pairprep-local-mock' })
  const [alice, bob] = await users(['Alice', 'Bob'])
  for (const { page } of [alice, bob]) {
    await page.addInitScript(() => {
      const state = {
        deny: false, captures: [] as MediaStreamConstraints[], tracks: [] as MediaStreamTrack[],
        peers: [] as RTCPeerConnection[], sockets: [] as WebSocket[], sent: [] as string[],
      }
      Object.assign(window, { pairprepCallTest: state })
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        state.captures.push(constraints ?? {})
        if (state.deny) throw new DOMException('Test permission denial', 'NotAllowedError')
        const stream = new MediaStream()
        function add(track: MediaStreamTrack, dispose: () => void) {
          const stop = track.stop.bind(track)
          track.stop = () => {
            if (track.readyState === 'ended') return
            stop()
            dispose()
          }
          stream.addTrack(track)
          state.tracks.push(track)
        }
        if (constraints?.audio) {
          const audio = new AudioContext()
          const source = audio.createOscillator()
          const output = audio.createMediaStreamDestination()
          source.connect(output)
          source.start()
          void audio.resume()
          add(output.stream.getAudioTracks()[0], () => { void audio.close() })
        }
        if (constraints?.video) {
          const canvas = document.createElement('canvas')
          canvas.width = 320
          canvas.height = 180
          const context = canvas.getContext('2d')!
          let alternate = false
          const draw = () => {
            context.fillStyle = (alternate = !alternate) ? '#1a6652' : '#3152a1'
            context.fillRect(0, 0, canvas.width, canvas.height)
          }
          draw()
          const timer = setInterval(draw, 100)
          add(canvas.captureStream(10).getVideoTracks()[0], () => clearInterval(timer))
        }
        return stream
      }
      const PeerConnection = RTCPeerConnection
      window.RTCPeerConnection = class extends PeerConnection {
        constructor(configuration?: RTCConfiguration) {
          super(configuration)
          state.peers.push(this)
        }
      }
      const BrowserSocket = WebSocket
      window.WebSocket = class extends BrowserSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          if (this.url.includes('/ws/call/')) state.sockets.push(this)
        }
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          if (this.url.includes('/ws/call/') && typeof data === 'string' && data !== 'ping') {
            state.sent.push(JSON.parse(data).type)
          }
          super.send(data)
        }
      }
    })
  }

  await alice.page.goto('/home')
  await alice.page.getByRole('button', { name: 'Create room', exact: true }).click()
  const dialog = alice.page.getByRole('dialog', { name: 'Create an interview room' })
  await dialog.getByLabel('Room name').fill(`WebRTC room ${Date.now()}`)
  await dialog.getByRole('combobox', { name: 'Coding challenge' }).click()
  await alice.page.getByRole('option', { name: /Two Sum/ }).click()
  await dialog.getByRole('button', { name: 'Create room', exact: true }).click()
  await expect(alice.page).toHaveURL(/\/rooms\/[^/]+$/)
  const roomUrl = alice.page.url()
  const roomId = new URL(roomUrl).pathname.split('/').at(-1)
  await bob.page.goto('/home')
  await bob.page.getByRole('button', { name: 'Account menu' }).click()
  await expect(bob.page.getByTestId('nav-user-email')).toHaveText(bob.email)

  async function canOpenSocket(page: Page) {
    return page.evaluate(async (room) => {
      const { token } = await (await fetch('/api/auth/token', { method: 'POST' })).json()
      return new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`ws://${location.host}/ws/call/${room}`, ['pairprep-call', token])
        socket.onopen = () => { socket.close(); resolve(true) }
        socket.onclose = () => resolve(false)
      })
    }, roomId)
  }
  expect(await canOpenSocket(bob.page)).toBe(false)

  await alice.page.getByLabel('Collaborator email').fill(bob.email)
  await alice.page.getByRole('button', { name: 'Add collaborator', exact: true }).click()
  await expect(alice.page.getByText(/Collaborator added and invitation email sent/)).toBeVisible()
  await bob.page.goto(roomUrl)

  const call = (page: Page) => page.getByRole('region', { name: 'Room call' })
  const media = (page: Page) => page.evaluate(() => (window as any).pairprepCallTest.captures.length)
  expect(await media(alice.page)).toBe(0)
  expect(await media(bob.page)).toBe(0)
  await bob.page.evaluate(() => { (window as any).pairprepCallTest.deny = true })
  await call(bob.page).getByRole('button', { name: 'Join Call', exact: true }).click()
  await expect(call(bob.page).getByRole('alert')).toContainText('Device permission denied')
  await bob.page.evaluate(() => { (window as any).pairprepCallTest.deny = false })

  await call(alice.page).getByRole('button', { name: 'Join Call', exact: true }).click()
  await expect(call(alice.page).getByText('Waiting for another participant…')).toBeVisible()
  await call(bob.page).getByRole('button', { name: 'Join audio only' }).click()
  for (const { page } of [alice, bob]) {
    await expect(call(page).getByText('Peer-to-peer call connected.')).toBeVisible({ timeout: 15_000 })
  }
  const sent = (await Promise.all([alice, bob].map(({ page }) =>
    page.evaluate(() => (window as any).pairprepCallTest.sent as string[])))).flat()
  expect(sent).toEqual(expect.arrayContaining(['offer', 'answer', 'ice']))
  const inbound = (page: Page, kind: string) => page.evaluate(async (kind) => {
    const peer = (window as any).pairprepCallTest.peers.at(-1) as RTCPeerConnection
    const stats = await peer.getStats()
    return [...stats.values()].some((row) => row.type === 'inbound-rtp' && row.kind === kind && row.bytesReceived > 0)
  }, kind)
  await expect.poll(() => inbound(bob.page, 'video')).toBe(true)
  await expect.poll(() => inbound(alice.page, 'audio')).toBe(true)
  await expect(call(bob.page).locator('video[aria-label="You video"]')).toHaveClass(/opacity-0/)
  await call(bob.page).getByRole('button', { name: 'Turn camera on' }).click()
  await expect.poll(() => inbound(alice.page, 'video')).toBe(true)
  const aliceCall = call(alice.page)
  const initialWidth = (await aliceCall.boundingBox())!.width
  const video = aliceCall.getByLabel('Bob video')
  const originalVideo = await video.elementHandle()
  await aliceCall.getByRole('button', { name: 'Expand call' }).click()
  await expect(aliceCall).toHaveAttribute('data-layout', 'expanded')
  expect((await aliceCall.boundingBox())!.width).toBeGreaterThan(initialWidth)
  for (const name of ['You video', 'Bob video']) {
    await expect(aliceCall.getByLabel(name)).toBeVisible()
    await expect(aliceCall.getByLabel(name)).not.toHaveClass(/opacity-0/)
  }
  await aliceCall.getByRole('button', { name: 'Fullscreen call' }).click()
  await expect(aliceCall.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()
  await aliceCall.getByRole('button', { name: 'Mute microphone' }).click()
  await expect(aliceCall.getByRole('button', { name: 'Unmute microphone' })).toBeVisible()
  await aliceCall.getByRole('button', { name: 'Unmute microphone' }).click()
  await aliceCall.getByRole('button', { name: 'Exit fullscreen' }).click()
  await expect(aliceCall).toHaveAttribute('data-fullscreen', 'false')
  await expect(aliceCall).toHaveAttribute('data-layout', 'expanded')

  await aliceCall.getByRole('button', { name: 'Minimize call' }).click()
  await expect(aliceCall).toHaveCSS('position', 'fixed')
  await expect(aliceCall.getByRole('button', { name: 'Turn camera off' })).toBeEnabled()
  await expect(aliceCall.getByRole('button', { name: 'Leave Call' })).toBeEnabled()
  expect(await originalVideo?.evaluate((element: HTMLVideoElement) => element.isConnected && element.srcObject !== null)).toBe(true)
  expect(await media(alice.page)).toBe(1)
  expect(await alice.page.evaluate(() => (window as any).pairprepCallTest.peers.length)).toBe(1)
  await call(bob.page).getByRole('button', { name: 'Turn camera off' }).click()
  await expect(call(alice.page).locator('video[aria-label="Bob video"]')).toHaveClass(/opacity-0/)
  await call(bob.page).getByRole('button', { name: 'Mute microphone' }).click()
  expect(await bob.page.evaluate(() => (window as any).pairprepCallTest.tracks.find((track: MediaStreamTrack) => track.kind === 'audio').enabled)).toBe(false)
  await call(bob.page).getByRole('button', { name: 'Unmute microphone' }).click()

  const editor = (page: Page) => page.getByRole('region', { name: 'Collaborative code editor' })
  for (const { page } of [alice, bob]) {
    await editor(page).scrollIntoViewIfNeeded()
    await expect(editor(page).getByRole('combobox', { name: 'Language' })).toBeEnabled()
    await expect(editor(page).locator('.line-numbers').first()).toHaveText('1')
  }
  await editor(alice.page).locator('textarea.inputarea').focus()
  await alice.page.keyboard.insertText('const codingDuringCall = true')
  await expect(editor(bob.page).locator('.view-lines')).toContainText('codingDuringCall')
  await expect(aliceCall).toBeInViewport()
  await aliceCall.getByRole('button', { name: 'Restore call' }).click()
  await expect(aliceCall).toHaveAttribute('data-layout', 'normal')

  await bob.page.setViewportSize({ width: 820, height: 900 })
  const bobCall = call(bob.page)
  const compactHeight = (await bobCall.boundingBox())!.height
  await bobCall.getByRole('button', { name: 'Expand call' }).click()
  expect((await bobCall.boundingBox())!.height).toBeGreaterThan(compactHeight)
  await bob.page.setViewportSize({ width: 390, height: 844 })
  await bob.page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false })
  })
  await bobCall.getByRole('button', { name: 'Fullscreen call' }).click()
  await expect(bob.page.getByRole('dialog', { name: 'Room call' })).toBeVisible()
  for (const name of ['You video', 'Alice video']) await expect(bobCall.getByLabel(name)).toBeVisible()
  await bob.page.keyboard.press('Escape')
  await expect(bobCall).toHaveAttribute('data-fullscreen', 'false')
  await bobCall.getByRole('button', { name: 'Restore call' }).click()
  await bob.page.setViewportSize({ width: 1280, height: 720 })

  await bob.page.evaluate(() => (window as any).pairprepCallTest.sockets.at(-1).close())
  await expect(call(bob.page).getByText(/Connection interrupted/)).toBeVisible()
  await expect(call(bob.page).getByText('Peer-to-peer call connected.')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => inbound(bob.page, 'video')).toBe(true)

  await bobCall.getByRole('button', { name: 'Minimize call' }).click()
  await bobCall.getByRole('button', { name: 'Leave Call' }).click()
  await expect(bobCall).toHaveAttribute('data-layout', 'normal')
  await expect(call(alice.page).getByText('Waiting for another participant…')).toBeVisible()
  expect(await bob.page.evaluate(() => (window as any).pairprepCallTest.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true)
  await call(bob.page).getByRole('button', { name: 'Join audio only' }).click()
  await expect(call(alice.page).getByText('Peer-to-peer call connected.')).toBeVisible({ timeout: 15_000 })

  await alice.page.getByRole('button', { name: /^Remove / }).click()
  await expect(call(alice.page).getByText('Waiting for another participant…')).toBeVisible()
  await expect(bob.page).toHaveURL(/\/home$/, { timeout: 15_000 })
  expect(await bob.page.evaluate(() => (window as any).pairprepCallTest.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true)
  expect(await canOpenSocket(bob.page)).toBe(false)

  await alice.page.getByLabel('Collaborator email').fill(bob.email)
  await alice.page.getByRole('button', { name: 'Add collaborator' }).click()
  await expect(alice.page.getByText(/Collaborator added/)).toBeVisible()
  await bob.page.goto(roomUrl)
  await call(bob.page).getByRole('button', { name: 'Join audio only' }).click()
  await expect(call(alice.page).getByText('Peer-to-peer call connected.')).toBeVisible()
  await alice.page.getByRole('button', { name: 'Room options' }).click()
  await alice.page.getByRole('menuitem', { name: 'Delete Room' }).click()
  await alice.page.getByRole('dialog', { name: 'Delete Room?' }).getByRole('button', { name: 'Delete Room' }).click()
  for (const { page } of [alice, bob]) {
    await expect(page).toHaveURL(/\/home$/)
    await expect.poll(() => page.evaluate(() => {
      const call = (window as any).pairprepCallTest
      return call.sockets.at(-1).readyState === WebSocket.CLOSED &&
        call.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended')
    })).toBe(true)
    expect(await canOpenSocket(page)).toBe(false)
  }
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
  await expect(bob.page).toHaveURL(/\/home$/, { timeout: 15_000 })
  await expect(bobNotes).toHaveCount(0)
  await bob.page.goto(alice.page.url())
  await expect(bob.page.getByRole('heading', { name: 'Room unavailable' })).toBeVisible()
})

test('the collaborative editor merges concurrent edits, persists language, and revokes access', async ({ users, request }) => {
  expect(await (await request.get('/api/integrations')).json()).toEqual({ mode: 'pairprep-local-mock' })
  const [alice, bob] = await users(['Alice', 'Bob'])
  const roomName = `Collaborative code ${Date.now()}`

  await alice.page.goto('/home')
  await alice.page.getByRole('button', { name: 'Create room', exact: true }).click()
  const dialog = alice.page.getByRole('dialog', { name: 'Create an interview room' })
  await dialog.getByLabel('Room name').fill(roomName)
  await dialog.getByRole('combobox', { name: 'Coding challenge' }).click()
  await alice.page.getByRole('option', { name: /Two Sum/ }).click()
  await dialog.getByRole('button', { name: 'Create room', exact: true }).click()
  await expect(alice.page).toHaveURL(/\/rooms\/[^/]+$/)
  const roomUrl = alice.page.url()
  const roomId = new URL(roomUrl).pathname.split('/').at(-1)

  await bob.page.goto('/home')
  await bob.page.getByRole('button', { name: 'Account menu' }).click()
  await expect(bob.page.getByTestId('nav-user-email')).toHaveText(bob.email)
  await alice.page.getByLabel('Collaborator email').fill(bob.email)
  await alice.page.getByRole('button', { name: 'Add collaborator', exact: true }).click()
  await expect(alice.page.getByText(/Collaborator added and invitation email sent/)).toBeVisible()

  // Hold both browsers' outgoing document updates until they have edited the
  // same initial state. The server and the rest of the WebSocket are real.
  const codeKey = Buffer.from(`interviewRooms:${roomId}:code`)
  const pending: Array<() => void> = []
  let hold = false
  for (const { page } of [alice, bob]) {
    await page.routeWebSocket('**/ws/**', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        if (hold && Buffer.isBuffer(message) && message.includes(codeKey)) {
          pending.push(() => server.send(message))
        } else {
          server.send(message)
        }
      })
    })
  }

  await alice.page.route('**/src/components/RoomCodeEditor.tsx*', async (route) => {
    // Hold the lazy editor module until its loading state has been observed.
    await expect(alice.page.getByText('Loading code editor…', { exact: true })).toBeVisible()
    await route.continue()
  })
  await Promise.all([alice.page.reload(), bob.page.goto(roomUrl)])

  const editor = (page: Page) => page.getByRole('region', { name: 'Collaborative code editor' })
  const language = (page: Page) => editor(page).getByRole('combobox', { name: 'Language' })
  const code = (page: Page) => editor(page).locator('.view-lines')
  // Monaco recycles rendered lines. Read them in visual order, not DOM order.
  const visibleCode = (page: Page) => code(page).locator('.view-line').evaluateAll((lines) =>
    lines.map((line) => ({ top: (line as HTMLElement).offsetTop, text: line.textContent }))
      .sort((left, right) => left.top - right.top)
      .map(({ text }) => text).join('\n'))
  async function typeInEditor(page: Page, value: string) {
    await editor(page).locator('textarea.inputarea').focus()
    await page.keyboard.insertText(value)
  }
  for (const { page } of [alice, bob]) {
    await expect(language(page)).toBeEnabled({ timeout: 15_000 })
    await expect(language(page)).toHaveValue('javascript')
    await expect(editor(page).locator('.line-numbers').first()).toHaveText('1')
    await expect(editor(page).getByRole('button', { name: 'Run Code' })).toBeEnabled()
  }
  await typeInEditor(alice.page, 'const answer = 42')
  await expect(code(bob.page).getByText('const', { exact: true })).toHaveCSS('color', 'rgb(203, 179, 255)')
  await language(alice.page).selectOption('python')
  await expect(language(bob.page)).toHaveValue('python')
  await editor(alice.page).locator('textarea.inputarea').focus()
  await alice.page.keyboard.press('ControlOrMeta+a')
  await alice.page.keyboard.insertText('def calculate():')
  await alice.page.keyboard.press('Enter')
  await alice.page.keyboard.insertText('return 42')
  await expect(code(bob.page)).toContainText('return')
  await expect.poll(() => visibleCode(bob.page)).toMatch(/\n\u00a0{4}return/)
  const syntax = code(bob.page).getByText('def', { exact: true })
  await expect(syntax).toHaveCSS('color', 'rgb(203, 179, 255)')
  await editor(bob.page).locator('textarea.inputarea').focus()
  await bob.page.keyboard.press('ControlOrMeta+a')
  await expect(editor(alice.page).locator('.yRemoteSelection').first()).toBeVisible()
  await bob.page.keyboard.press('ArrowRight')

  hold = true
  await Promise.all([
    typeInEditor(alice.page, '\n# Alice edit\n'),
    typeInEditor(bob.page, '\n# Bob edit\n'),
  ])
  await expect(code(alice.page)).toContainText('Alice edit')
  await expect(code(bob.page)).toContainText('Bob edit')
  await expect(code(alice.page)).not.toContainText('Bob edit')
  await expect(code(bob.page)).not.toContainText('Alice edit')
  expect(pending.length).toBeGreaterThanOrEqual(2)
  hold = false
  pending.splice(0).forEach((send) => send())
  for (const { page } of [alice, bob]) {
    await expect(code(page)).toContainText('Alice edit')
    await expect(code(page)).toContainText('Bob edit')
  }
  await expect.poll(async () => {
    const [aliceCode, bobCode] = await Promise.all([visibleCode(alice.page), visibleCode(bob.page)])
    return aliceCode === bobCode
  }).toBe(true)
  await alice.page.keyboard.press('ControlOrMeta+z')
  await expect(code(bob.page)).not.toContainText('Alice edit')
  await expect(code(bob.page)).toContainText('Bob edit')
  await alice.page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(code(bob.page)).toContainText('Alice edit')

  await language(bob.page).selectOption('java')
  await expect(language(alice.page)).toHaveValue('java')
  await expect(code(alice.page)).toContainText('return')
  await editor(bob.page).locator('textarea.inputarea').focus()
  await bob.page.keyboard.press('ControlOrMeta+End')
  await bob.page.keyboard.insertText('\nclass Practice {}')
  await expect(code(alice.page).getByText('class', { exact: true })).toHaveCSS('color', 'rgb(203, 179, 255)')
  await bob.page.setViewportSize({ width: 390, height: 844 })
  await bob.page.reload()
  await expect(language(bob.page)).toHaveValue('java')
  await expect(code(bob.page)).toContainText('Alice edit')
  await expect(code(bob.page)).toContainText('Bob edit')
  expect(await bob.page.locator('main').first().evaluate((main) => main.scrollWidth)).toBe(390)
  await expect(bob.page.getByRole('textbox', { name: 'Shared interview notes' })).toHaveValue('')

  for (const { page } of [alice, bob]) {
    await expect(language(page).locator('option:checked')).toHaveText('Java (Editor Only)')
    await expect(editor(page).getByText(/Java execution is not supported yet/)).toBeVisible()
    await expect(editor(page).getByRole('button', { name: 'Run Code' })).toBeDisabled()
  }
  await language(alice.page).selectOption('javascript')
  await editor(alice.page).locator('textarea.inputarea').focus()
  await alice.page.keyboard.press('ControlOrMeta+a')
  await alice.page.keyboard.insertText('console.log("Private execution result")')
  await editor(alice.page).getByRole('button', { name: 'Run Code' }).click()
  await expect(editor(alice.page).getByRole('region', { name: 'Execution output' }).getByText('Private execution result', { exact: true })).toBeVisible()
  await expect(editor(bob.page).getByRole('region', { name: 'Execution output' }).getByText('Private execution result', { exact: true })).toHaveCount(0)

  await alice.page.getByRole('button', { name: /^Remove / }).click()
  await expect(bob.page).toHaveURL(/\/home$/, { timeout: 15_000 })
  await expect(editor(bob.page)).toHaveCount(0)
  await bob.page.goto(alice.page.url())
  await expect(bob.page.getByRole('heading', { name: 'Room unavailable' })).toBeVisible()
  const denied = await bob.page.evaluate(async (roomId) => {
    const { callServerAction } = await import('/src/lib/server-actions.ts')
    try {
      await callServerAction('rooms.code.run', { roomId, language: 'java', source: 'class Practice {}' })
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, roomId)
  expect(denied).toBe('Room not found, or you do not have access.')
})

test('runs real browser Python and JavaScript inside the isolated runner', async ({ users }) => {
  const [owner] = await users(1)
  const { page } = owner
  await page.goto('/home')
  await page.getByRole('button', { name: 'Create room', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create an interview room' })
  await dialog.getByLabel('Room name').fill(`Browser runner ${Date.now()}`)
  await dialog.getByRole('combobox', { name: 'Coding challenge' }).click()
  await page.getByRole('option', { name: /Two Sum/ }).click()
  await dialog.getByRole('button', { name: 'Create room', exact: true }).click()

  const editor = page.getByRole('region', { name: 'Collaborative code editor' })
  const output = editor.getByRole('region', { name: 'Execution output' })
  const run = editor.getByRole('button', { name: 'Run Code', exact: true })
  const language = editor.getByRole('combobox', { name: 'Language' })
  async function write(source: string) {
    await editor.locator('textarea.inputarea').focus()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText(source)
  }

  await expect(run).toBeEnabled({ timeout: 15_000 })
  await write('console.log("Hello PairPrep"); console.log(typeof fetch, typeof document, typeof localStorage);')
  await run.click()
  await expect(output.getByText(/Hello PairPrep/)).toBeVisible()
  await expect(output.getByText(/undefined undefined undefined/)).toBeVisible()
  await expect(output.getByText(/Completed.*ms/)).toBeVisible()
  await write('const =')
  await output.getByRole('button', { name: 'Run Again' }).click()
  await expect(output.getByText(/Compilation error/)).toBeVisible()
  await write('throw new Error("JavaScript failure")')
  await run.click()
  await expect(output.getByText(/Runtime error/)).toBeVisible()
  await expect(output.getByText(/JavaScript failure/)).toBeVisible()
  await editor.getByLabel('Standard input (optional)').fill('JavaScript stdin')
  await write('console.log(readLine()); console.log("x".repeat(9000));')
  await run.click()
  await expect(output.locator('pre').filter({ hasText: 'JavaScript stdin' })).toBeVisible()
  await expect(output.getByText('Output was truncated.')).toBeVisible()
  await write('while (true) {}')
  await run.click()
  await expect(output.getByText(/Execution timed out/)).toBeVisible()

  await language.selectOption('python')
  await write('print("Python ready")')
  await run.click()
  await expect(output.getByText('Python ready', { exact: true })).toBeVisible()
  await editor.getByLabel('Standard input (optional)').fill('Ada')
  await write('print("Hello PairPrep")\nprint(input())')
  await run.click()
  await expect(output.getByText(/Hello PairPrep/)).toBeVisible()
  await expect(output.locator('pre').filter({ hasText: 'Ada' })).toBeVisible()
  await write('import js, sys\nsys.modules.pop("js", None)\nimport js\nprint(hasattr(js, "fetch"), hasattr(js, "globalThis"))')
  await run.click()
  await expect(output.getByText('False False', { exact: true })).toBeVisible()
  await write('def :')
  await run.click()
  await expect(output.getByText(/Compilation error/)).toBeVisible()
  await write('raise ValueError("Python failure")')
  await run.click()
  await expect(output.getByText(/Runtime error/)).toBeVisible()
  await expect(output.getByText(/Python failure/)).toBeVisible()
  await page.evaluate(() => { document.cookie = 'pairprep_runner_probe=app-only; Path=/; SameSite=Lax' })
  expect(await page.evaluate(() => document.cookie.includes('pairprep_runner_probe=app-only'))).toBe(true)
  await write('while True: pass')
  await run.click()
  const sandbox = page.frameLocator('iframe[title="Isolated code runner"]').locator('body')
  const isolation = await sandbox.evaluate(async (_body, url) => {
    const blocked = (read: () => unknown) => {
      try { read(); return false } catch { return true }
    }
    const workerScript = URL.createObjectURL(new Blob([
      `fetch(${JSON.stringify(url)}, { credentials: 'include' }).then(() => postMessage(false), () => postMessage(true));`,
    ], { type: 'text/javascript' }))
    const worker = new Worker(workerScript)
    const workerNetworkBlocked = await new Promise((resolve) => {
      worker.onmessage = (event) => resolve(event.data)
      worker.onerror = () => resolve(false)
    })
    worker.terminate()
    URL.revokeObjectURL(workerScript)
    let cookiesBlocked = true
    try { cookiesBlocked = document.cookie === '' } catch { /* Opaque origins may throw instead. */ }
    return {
      origin: self.origin,
      workerNetworkBlocked,
      cookiesBlocked,
      parentBlocked: blocked(() => window.parent.document),
      storageBlocked: blocked(() => localStorage.length),
    }
  }, new URL('/api/auth/ok', page.url()).href)
  expect(isolation).toEqual({
    origin: 'null', workerNetworkBlocked: true, cookiesBlocked: true, parentBlocked: true, storageBlocked: true,
  })
  await expect(output.getByText(/Execution timed out/)).toBeVisible()
  await run.click()
  await output.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(output.getByText('Execution stopped.')).toBeVisible()
  await expect(page.locator('iframe[title="Isolated code runner"]')).toHaveCount(0)
  await write('print("Fresh run")')
  await run.click()
  await expect(output.getByText('Fresh run', { exact: true })).toBeVisible()
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
