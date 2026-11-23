import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { codeRunLimits, codeRunMessages, isCodeLanguage, type CodeLanguage, type CodeRunResult } from '../lib/code-run'

export const codeRunRatePath = '/internal/reserve-code-run'
export const codeRunBodyLimit = 224 * 1024

const responseDeadlineMs = 15_000
const encoder = new TextEncoder()

interface CodeRunInput {
  language: CodeLanguage
  source: string
  stdin: string
}

/** A separately approved sandbox must enforce these limits and stop the job on abort. */
type CodeExecutor = (input: CodeRunInput, limits: typeof codeRunLimits, signal: AbortSignal) => Promise<unknown>
type Context = Parameters<ActionHandler<Env>>[0]

async function reserveSlot(env: Env, userId: string): Promise<boolean> {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const response = await stub.fetch(new Request(`https://internal${codeRunRatePath}`, {
    method: 'POST',
    headers: { 'X-App-Action': 'true', 'X-User-Id': userId },
  }))
  if (response.status === 429) return false
  if (!response.ok) throw new Error('Could not reserve an execution slot.')
  return true
}

function capOutput(value: string): { text: string; truncated: boolean } {
  const limit = codeRunLimits.outputBytesPerStream
  const bytes = encoder.encode(value.slice(0, limit))
  if (value.length <= limit && bytes.length <= limit) return { text: value, truncated: false }
  return { text: new TextDecoder().decode(bytes.subarray(0, limit), { stream: true }), truncated: true }
}

function normalizeResult(value: unknown): CodeRunResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid runner response.')
  const { status, durationMs, stdout, stderr, compileOutput, truncated } = value as Record<string, unknown>
  if (typeof status !== 'string' || !Object.hasOwn(codeRunMessages, status) ||
      (durationMs !== null && (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > responseDeadlineMs)) ||
      typeof stdout !== 'string' || typeof stderr !== 'string' || typeof compileOutput !== 'string' ||
      typeof truncated !== 'boolean') throw new Error('Invalid runner response.')
  const output = capOutput(stdout)
  const errors = capOutput(stderr)
  const compiler = capOutput(compileOutput)
  return {
    status: status as CodeRunResult['status'],
    durationMs,
    stdout: output.text,
    stderr: errors.text,
    compileOutput: compiler.text,
    truncated: truncated || output.truncated || errors.truncated || compiler.truncated,
  }
}

export function createCodeRunActions(
  authorize: (ctx: Context, roomId: string) => Promise<boolean>,
  execute?: CodeExecutor,
  reserve = reserveSlot,
) {
  function refuse(code: string, error: string) {
    return { success: false as const, code, error }
  }

  async function checkRoom(ctx: Context) {
    if (!ctx.userId) return refuse('unauthorized', 'Sign in to run code.')
    const roomId = typeof ctx.params.roomId === 'string' ? ctx.params.roomId.trim() : ''
    if (!roomId || roomId.length > 128) return refuse('invalid_request', 'A valid room is required.')
    if (!await authorize(ctx, roomId)) return refuse('forbidden', 'Room not found, or you do not have access.')
    return null
  }

  const status: ActionHandler<Env> = async (ctx) =>
    await checkRoom(ctx) ?? { success: true, data: { available: Boolean(execute) } }

  const run: ActionHandler<Env> = async (ctx) => {
    const denied = await checkRoom(ctx)
    if (denied) return denied

    const { language, source, stdin = '' } = ctx.params
    if (!isCodeLanguage(language) || typeof source !== 'string' || !source.trim() ||
        typeof stdin !== 'string' || encoder.encode(source).byteLength > codeRunLimits.sourceBytes ||
        encoder.encode(stdin).byteLength > codeRunLimits.stdinBytes) {
      return refuse('invalid_request', 'Use Java, Python, or JavaScript with up to 32 KiB of code and 4 KiB of standard input.')
    }

    try {
      if (!await reserve(ctx.env, ctx.userId)) {
        return refuse('rate_limited', 'Too many runs. Try again in the next minute.')
      }
    } catch {
      return refuse('unavailable', 'Code execution is currently unavailable.')
    }

    if (!execute) return refuse('unavailable', 'Code execution is unavailable until a sandbox is connected.')

    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort()
        reject(new Error('Runner deadline exceeded.'))
      }, responseDeadlineMs)
    })
    try {
      const result = await Promise.race([execute({ language, source, stdin }, codeRunLimits, abort.signal), deadline])
      return { success: true, data: normalizeResult(result) }
    } catch {
      return abort.signal.aborted
        ? refuse('runner_timeout', 'The sandbox did not respond in time.')
        : refuse('unavailable', 'The sandbox could not complete the request.')
    } finally {
      clearTimeout(timer)
    }
  }

  return { status, run }
}
