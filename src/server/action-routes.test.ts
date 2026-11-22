import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { VerifyResult } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker'

vi.mock('deepspace/worker', () => ({
  apiWorkerFetch: vi.fn(),
  lookupOwn: (object: Record<string, unknown>, key: string) =>
    Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined,
  normalizeApiError: vi.fn(),
  splitIntegrationEndpoint: vi.fn(),
  mintUlid: vi.fn(),
}))

import { registerActionRoutes } from './action-routes'

describe('server action request bodies', () => {
it.each([
    ['malformed JSON', '{'],
    ['null JSON', 'null'],
    ['array JSON', '[]'],
    ['string JSON', '"hello"'],
    ['number JSON', '123'],
    ['boolean JSON', 'true'],
  ])('rejects %s with a client error', async (_description, body) => {
    const app = new Hono<AppContext>()
    registerActionRoutes(app, async () => ({ userId: 'signed-in-user' }) as VerifyResult)

    const response = await app.request('/api/actions/rooms.create', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
      },
      body,
    }, {} as Env)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.any(String) })
  })
})
