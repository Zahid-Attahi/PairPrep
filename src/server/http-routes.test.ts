import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext, Env } from '../../worker'

const mocks = vi.hoisted(() => ({
  apiWorkerFetch: vi.fn(),
  authWorkerFetch: vi.fn(),
  verifyJwt: vi.fn(),
}))

vi.mock('deepspace/worker', () => ({
  apiWorkerFetch: mocks.apiWorkerFetch,
  authWorkerFetch: mocks.authWorkerFetch,
  BROWSER_PROXY_ROUTES: [],
  integrationPath: (name: string, endpoint: string) => `${name}/${endpoint}`,
  isPlatformReservedPath: vi.fn(),
  lookupOwn: (object: Record<string, unknown>, key: string) =>
    Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined,
  platformWorkerFetch: vi.fn(),
  resolveAppRole: vi.fn(),
  resolveSessionReadAuth: vi.fn(),
  SESSION_COOKIE: '__Secure-better-auth.session_token',
  verifyAgentToken: vi.fn(),
  verifyJwt: mocks.verifyJwt,
  nativeAuthCallback: vi.fn(),
  nativeAuthExchange: vi.fn(),
  nativeAuthMe: vi.fn(),
  nativeAuthSignOut: vi.fn(),
  nativeAuthStart: vi.fn(),
  nativeAuthToken: vi.fn(),
}))

import { registerAuthAndIntegrationRoutes } from './http-routes'

describe('browser session cookies', () => {
  const localCookie = 'pairprep.local_session'
  const sdkCookie = '__Secure-better-auth.session_token'
  const app = new Hono<AppContext>()
  registerAuthAndIntegrationRoutes(app)

  beforeEach(() => {
    mocks.authWorkerFetch.mockReset()
  })

  it.each([
    ['http://localhost:5173', localCookie, false],
    ['http://127.0.0.1:5173', localCookie, false],
    ['http://[::1]:5173', localCookie, false],
    ['https://localhost:5173', sdkCookie, true],
    ['https://pairprep.example', sdkCookie, true],
    ['http://pairprep.example', sdkCookie, true],
  ])('persists the OAuth session before redirecting from %s', async (origin, name, secure) => {
    mocks.authWorkerFetch.mockResolvedValueOnce(Response.json({ sessionToken: 'fake+signed/session' }))
    const response = await app.request(`${origin}/api/auth/oauth-complete?code=one-time-code`)
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(`${origin}/home`)
    const cookie = response.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain(`${name}=fake%2Bsigned%2Fsession;`)
    expect(cookie).toContain('Path=/; HttpOnly; SameSite=Lax')
    expect(cookie.includes('; Secure')).toBe(secure)
  })

  it('stores proxied sign-in cookies locally and sends the SDK cookie back for session checks', async () => {
    const origin = 'http://localhost:5173'
    const headers = new Headers()
    headers.append('Set-Cookie', `${sdkCookie}=signed%2Fvalue; Domain=auth.example; Path=/; HttpOnly; Secure; SameSite=Lax`)
    headers.append('Set-Cookie', 'other=1; Path=/; Secure')
    mocks.authWorkerFetch.mockResolvedValueOnce(Response.json({}, { headers }))
    const login = await app.request(`${origin}/api/auth/sign-in/email`, { method: 'POST' })
    expect(login.headers.getSetCookie()).toEqual([
      `${localCookie}=signed%2Fvalue; Path=/; HttpOnly; SameSite=Lax`,
      'other=1; Path=/; Secure',
    ])

    mocks.authWorkerFetch.mockResolvedValueOnce(Response.json({ user: { id: 'test-user' } }))
    const session = await app.request(`${origin}/api/auth/get-session`, {
      headers: { Cookie: `other=1; ${sdkCookie}=stale; ${localCookie}=signed%2Fvalue` },
    })
    expect(await session.json()).toEqual({ user: { id: 'test-user' } })
    expect(mocks.authWorkerFetch.mock.lastCall?.[2].headers.get('Cookie')).toBe(`${sdkCookie}=signed%2Fvalue; other=1`)
  })

  it('expires both the local and pre-existing secure session cookie on localhost sign-out', async () => {
    mocks.authWorkerFetch.mockResolvedValueOnce(Response.json({ success: true }))
    const response = await app.request('http://localhost:5173/api/auth/sign-out', {
      method: 'POST',
      headers: { Cookie: `${localCookie}=signed` },
    })
    expect(mocks.authWorkerFetch.mock.lastCall?.[2].headers.get('Cookie')).toBe(`${sdkCookie}=signed`)
    expect(response.headers.getSetCookie()).toEqual([
      `${sdkCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
      `${localCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    ])
  })
})

describe('developer-billed provider proxy access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyJwt.mockResolvedValue({ result: { userId: 'signed-in-user' } })
  })

it.each([
    ['/api/integrations/openai/chat-completion', { messages: [] }],
    ['/api/integrations/exa/search', { query: 'hash maps' }],
    ['/api/integrations/email/send', { to: 'someone@example.com' }],
    ['/api/integrations/OpenAI/chat-completion', { messages: [] }],
    ['/api/integrations/ExA/search', { query: 'hash maps' }],
    ['/api/integrations/Email/send', { to: 'someone@example.com' }],
  ])('blocks direct browser calls to %s', async (path, body) => {
    const app = new Hono<AppContext>()
    registerAuthAndIntegrationRoutes(app)

    const response = await app.request(path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, {} as Env)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'This integration is only available through authorized PairPrep actions.',
    })
    expect(mocks.apiWorkerFetch).not.toHaveBeenCalled()
  })
})
