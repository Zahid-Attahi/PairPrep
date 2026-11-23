import { describe, expect, it, vi } from 'vitest'
import { createCodeRunActions } from './code-run'
import { codeRunLimits, type CodeRunResult } from '../lib/code-run'

const input = { roomId: 'room-1', language: 'javascript', source: 'console.log(42)', stdin: 'test input\n' }
const response: CodeRunResult = {
  status: 'success', stdout: '42\n', stderr: '', compileOutput: '', durationMs: 12, truncated: false,
}

function setup() {
  const authorize = vi.fn(async () => true)
  const reserve = vi.fn(async () => true)
  const execute = vi.fn(async (..._args: Parameters<NonNullable<Parameters<typeof createCodeRunActions>[1]>>): Promise<unknown> => response)
  const actions = createCodeRunActions(authorize, execute, reserve)
  const context = (params: Record<string, unknown> = input, userId = 'user-1') =>
    ({ params, userId }) as Parameters<typeof actions.run>[0]
  return { authorize, reserve, execute, actions, context }
}

describe('code run request and result handling', () => {
  it.each(['java', 'python', 'javascript'])('passes %s source and stdin with fixed limits and no auth context', async (language) => {
    const { actions, context, execute } = setup()
    expect(await actions.run(context({ ...input, language, memoryMiB: 1_000, network: 'enabled' }))).toEqual({
      success: true, data: response,
    })
    expect(execute).toHaveBeenCalledWith(
      { language, source: input.source, stdin: input.stdin },
      codeRunLimits,
      expect.any(AbortSignal),
    )
    expect(codeRunLimits).toMatchObject({ memoryMiB: 256, runWallTimeMs: 3_000, network: 'disabled' })
  })

  it.each([
    { status: 'compile_error', compileOutput: 'Fixture: syntax error' },
    { status: 'runtime_error', stderr: 'Fixture: uncaught exception' },
    { status: 'timed_out', durationMs: 3_000 },
  ] satisfies Partial<CodeRunResult>[])('returns the sandbox outcome $status', async (outcome) => {
    const { actions, context, execute } = setup()
    execute.mockResolvedValueOnce({ ...response, stdout: '', ...outcome })
    expect(await actions.run(context())).toMatchObject({ success: true, data: outcome })
  })

  it('bounds output in UTF-8 without splitting a character', async () => {
    const { actions, context, execute } = setup()
    execute.mockResolvedValueOnce({ ...response, stdout: 'a' + '😀'.repeat(4096) })
    expect(await actions.run(context())).toMatchObject({
      success: true, data: { stdout: 'a' + '😀'.repeat(2047), truncated: true },
    })
  })

  it('rejects invalid input, unauthenticated calls, and revoked membership before reservation', async () => {
    const { actions, context, execute, authorize, reserve } = setup()
    expect(await actions.run(context(input, ''))).toMatchObject({ success: false, code: 'unauthorized' })
    expect(authorize).not.toHaveBeenCalled()
    expect(await actions.run(context({ ...input, language: 'shell' }))).toMatchObject({ code: 'invalid_request' })
    expect(await actions.run(context({ ...input, stdin: '😀'.repeat(1025) }))).toMatchObject({ code: 'invalid_request' })
    authorize.mockResolvedValue(false)
    expect(await actions.status(context())).toMatchObject({ code: 'forbidden' })
    expect(await actions.run(context())).toMatchObject({ code: 'forbidden' })
    expect(reserve).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects exhausted quota before any execution', async () => {
    const { actions, context, execute, reserve } = setup()
    reserve.mockResolvedValueOnce(false)
    expect(await actions.run(context())).toMatchObject({ success: false, code: 'rate_limited' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails closed when an execution adapter is absent', async () => {
    const { context, authorize, reserve } = setup()
    const actions = createCodeRunActions(authorize, undefined, reserve)
    expect(await actions.status(context())).toEqual({ success: true, data: { available: false } })
    expect(await actions.run(context())).toMatchObject({ success: false, code: 'unavailable' })
  })

  it('caps the wait for an unresponsive sandbox and signals abort', async () => {
    vi.useFakeTimers()
    try {
      const { actions, context, execute } = setup()
      execute.mockImplementationOnce(() => new Promise(() => {}))
      const run = actions.run(context())
      await vi.advanceTimersByTimeAsync(15_000)
      expect(await run).toMatchObject({ success: false, code: 'runner_timeout' })
      expect(execute.mock.calls[0]?.[2].aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
