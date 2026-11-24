/**
 * App Worker — explicit assembly for DeepSpace app routes and Durable Objects.
 *
 * Route implementations live under src/server. Keep their registration order
 * here: specific API and WebSocket handlers must precede the SPA fallback.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  armCronRoom,
  CanvasRoom,
  CronRoom,
  JobRoom,
  PresenceRoom,
  RecordRoom,
  resolveAppRole,
  workerErrorHandler,
  YjsRoom,
} from 'deepspace/worker'
import type { DOBindings, DOManifest, Job, JobContext } from 'deepspace/worker'
import { AI_CHATS_SCHEMA } from 'deepspace/schema'
import { registerAgent } from './src/ai/agent.js'
import { buildTools } from './src/ai/tools.js'
import { tasks as cronTasks, runTask as runCronTask } from './src/cron.js'
import { runJob } from './src/jobs.js'
import { schemas } from './src/schemas.js'
import { registerActionRoutes } from './src/server/action-routes.js'
import { codeRunRatePath } from './src/server/code-run.js'
import { reserveCodeRunSlot } from './src/server/code-run-limits.js'
import { createRoomChildPath, deleteRoomData, deleteRoomPath, roomChildScope } from './src/server/room-deletion.js'
import {
  registerAuthAndIntegrationRoutes,
  registerPlatformProxyRoutes,
  registerStaticRoutes,
  resolveAuth,
} from './src/server/http-routes.js'
import { registerRealtimeRoutes } from './src/server/realtime-routes.js'
export { AppCallRoom } from './src/server/call-room.js'

// Dynamic deploy reads this manifest to create the app's DO bindings.
export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
  { binding: 'CRON_ROOMS', className: 'AppCronRoom', sqlite: true },
  { binding: 'JOB_ROOMS', className: 'AppJobRoom', sqlite: true },
  { binding: 'CALL_ROOMS', className: 'AppCallRoom', sqlite: true },
] as const satisfies DOManifest

export class AppRecordRoom extends RecordRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }

  protected override async handleInternalRequest(request: Request, url: URL): Promise<Response | null> {
    if (url.pathname === codeRunRatePath) {
      const userId = request.headers.get('X-User-Id')
      if (request.method !== 'POST' || request.headers.get('X-App-Action') !== 'true' || !userId) {
        return new Response('Not found', { status: 404 })
      }
      return new Response(null, { status: reserveCodeRunSlot(this.state.storage, userId) ? 204 : 429 })
    }
    if (url.pathname === deleteRoomPath || url.pathname === createRoomChildPath) {
      const userId = request.headers.get('X-User-Id')
      if (request.method !== 'POST' || request.headers.get('X-App-Action') !== 'true' || !userId) {
        return new Response('Not found', { status: 404 })
      }
      return this.state.blockConcurrencyWhile(async () => {
        try {
          return url.pathname === deleteRoomPath
            ? await this.deleteInterviewRoom(request, userId)
            : await this.createRoomChild(request, userId)
        } catch (error) {
          console.error('Room data operation failed', error)
          return Response.json({ success: false }, { status: 503 })
        }
      })
    }
    if (url.pathname !== '/internal/revoke-room-member') return super.handleInternalRequest(request, url)
    if (request.method !== 'POST' || request.headers.get('X-App-Action') !== 'true') {
      return new Response('Not found', { status: 404 })
    }

    // RecordRoom 0.44.2 checks access on Yjs joins and writes, but broadcasts
    // to already-joined sockets. Close those sockets before processing another
    // message after a membership deletion.
    return this.state.blockConcurrencyWhile(async () => {
      const roomId = request.headers.get('X-Call-Room')
      const body = await request.clone().json<{ params: { where: { userId: string } } }>()
      if (roomId) {
        const calls = (this.env as Env).CALL_ROOMS
        const callRoom = calls.get(calls.idFromName(`call:${roomId}`))
        const revoked = await callRoom.fetch('https://internal/revoke', {
          method: 'POST', headers: { 'X-Call-User': body.params.where.userId },
        }).catch(() => null)
        if (!revoked?.ok) return Response.json({ success: false, error: 'Call revocation failed.' }, { status: 503 })
      }
      const response = await super.fetch(new Request(new URL('/api/tools/execute', url), request))
      if (response.ok) this.disconnectAllSockets()
      return response
    })
  }

  override async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    // Ignore frames queued on a socket that has already been revoked.
    if (socket.readyState === WebSocket.OPEN) await super.webSocketMessage(socket, message)
  }

  private recordTool(userId: string, tool: string, params: Record<string, unknown>) {
    return super.fetch(new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-App-Action': 'true' },
      body: JSON.stringify({ tool, params }),
    }))
  }

  private async deleteInterviewRoom(request: Request, userId: string) {
    const { roomId } = await request.json<{ roomId: string }>()
    const response = await this.recordTool(userId, 'records.get', { collection: 'interviewRooms', recordId: roomId })
    const room = await response.json<{ data?: { record: { data: { ownerId: string; teamId: string } } } }>()
    const data = room.data?.record.data
    if (response.status === 404 || (data && data.ownerId !== userId)) return new Response(null, { status: 403 })
    if (!response.ok || !data?.teamId) return new Response(null, { status: 503 })

    // The records barrier also holds access checks for joins that read the
    // call generation after this close. Joins with the old generation fail.
    const calls = (this.env as Env).CALL_ROOMS
    const callRoom = calls.get(calls.idFromName(`call:${roomId}`))
    const closed = await callRoom.fetch('https://internal/close-room', { method: 'POST' })
    if (!closed.ok) return new Response(null, { status: 503 })

    deleteRoomData(this.state.storage, roomId, data.teamId)
    this.disconnectAllSockets()
    return new Response(null, { status: 204 })
  }

  private async createRoomChild(request: Request, userId: string) {
    const { params } = await request.json<{ params: { collection: string; data: Record<string, unknown>; recordId?: string } }>()
    const scope = roomChildScope(params.collection, params.data)
    if (!scope || typeof (scope.teamId ?? scope.recordId) !== 'string') {
      return Response.json({ success: false, error: 'A valid room is required.' }, { status: 400 })
    }

    // An in-flight invite, review, or AI reply must not recreate data after a
    // cascade. Share the deletion barrier between the lookup and insert.
    const response = await this.recordTool(userId, 'records.query', { collection: 'interviewRooms', where: scope, limit: 1 })
    const rooms = await response.json<{ data?: { records: unknown[] } }>()
    if (!response.ok || !rooms.data) return Response.json({ success: false }, { status: 503 })
    if (rooms.data.records.length === 0) {
      return Response.json({ success: false, error: 'Room not found, or you do not have access.' }, { status: 404 })
    }
    return this.recordTool(userId, 'records.create', params)
  }
}

export class AppYjsRoom extends YjsRoom<Env> {}
export class AppCanvasRoom extends CanvasRoom<Env> {}
export class AppPresenceRoom extends PresenceRoom<Env> {}

/** Runs the scheduled tasks defined in src/cron.ts. */
export class AppCronRoom extends CronRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tasks: cronTasks })
  }

  protected async onTask(taskName: string): Promise<void> {
    await runCronTask(taskName, this.env)
  }
}

/** Runs durable background work defined in src/jobs.ts. */
export class AppJobRoom extends JobRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      authorizeWrite: async (user) => {
        if (user.userId.startsWith('anon-')) return false
        const role = await resolveAppRole(env, user.userId)
        return role === 'member' || role === 'admin'
      },
    })
  }

  protected async onJob(job: Job, context: JobContext): Promise<unknown> {
    return await runJob(job, context, this.env)
  }
}

export interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  /**
   * Platform service binding in production; deepspace dev supplies the URL
   * fallback. Standard app files use the platform's shared, app-scoped R2
   * bucket rather than a local binding.
   */
  PLATFORM_WORKER?: Fetcher
  PLATFORM_WORKER_URL?: string
  /**
   * HMAC app credential minted on first deploy. Proxy routes omit identity
   * headers when it is absent so upstream services fail closed.
   */
  APP_IDENTITY_TOKEN?: string
  /** API service binding in production with a deepspace-dev URL fallback. */
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  /** Comma-separated exact Expo/native callback URIs (for example, myapp://auth/callback). */
  NATIVE_AUTH_REDIRECT_URIS?: string
  APP_NAME: string
  /** Immutable record-scope and platform identity. */
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
  /**
   * Long-lived owner JWT used for developer-billed server calls. User-billed
   * calls always forward the signed-in caller's JWT instead.
   */
  APP_OWNER_JWT: string
  /**
   * Enables /api/debug/* only when exactly "true". The route still requires
   * an authenticated app owner/admin. deepspace dev/test set it locally.
   */
  ALLOW_DEBUG_ROUTES?: string
}

export type AppContext = { Bindings: Env }

const app = new Hono<AppContext>()
app.use('/api/*', cors())
// A Durable Object exists only once something fetches it, and the CronRoom
// arms its alarm in that first fetch — so wake it from the request path, or a
// deployed schedule waits for a visitor. Once per isolate; no-op without tasks.
app.use('*', async (c, next) => {
  armCronRoom(c.executionCtx, c.env.CRON_ROOMS, `app:${c.env.DEEPSPACE_APP_ID}`, cronTasks)
  await next()
})

// Registration order is part of the worker contract. The wildcard auth route
// follows its special cases, AI precedes platform proxies, and static is last.
registerAuthAndIntegrationRoutes(app)
registerRealtimeRoutes(app)
registerActionRoutes(app, resolveAuth)
// Every scaffold exposes selected tools through HTTP, MCP and browser tools.
// Only copilot owns the collections needed for the in-app chat UI.
registerAgent(app, {
  tools: buildTools,
  inApp: schemas.some((schema) => schema.name === AI_CHATS_SCHEMA.name),
})
registerPlatformProxyRoutes(app)
registerStaticRoutes(app)

// Hono registers ONE error handler (last onError wins), and its default is
// `console.error(err)` — whose message Workers Logs drops, keeping only the
// stack frames. workerErrorHandler logs the string form instead (message
// first, frames and bounded cause chain, method + path for context), keeps a
// response-bearing error's (HTTPException — auth 401s, upload 413s) own
// answer, and returns a generic 500 for the rest.
app.onError(workerErrorHandler('error'))

export default app
