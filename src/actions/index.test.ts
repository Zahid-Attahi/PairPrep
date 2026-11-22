import { describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'

vi.mock('deepspace/worker', () => ({ mintUlid: vi.fn() }))

import { actions } from './index'

describe('rooms.coach conversation persistence', () => {
  it('loads only the caller’s room history and saves both messages', async () => {
    const submittedMessages: Array<{ role: string; content: string }> = []
    const savedMessages: Array<Record<string, unknown>> = []

    const tools = {
      get: vi.fn().mockResolvedValue({
        success: true,
        data: {
          record: {
            recordId: 'room-1',
            data: {
              name: 'Two Sum practice',
              ownerId: 'owner-1',
              teamId: 'room-1',
              challengeId: 'two-sum',
            },
          },
        },
      }),
      query: vi.fn(async (collection: string, options?: { where?: Record<string, unknown> }) => {
        if (collection === 'aiCoachMessages') {
          expect(options?.where).toEqual({ userId: 'owner-1', roomId: 'room-1' })
          return {
            success: true as const,
            data: {
              records: [
                {
                  recordId: 'saved-2',
                  data: {
                    userId: 'owner-1',
                    roomId: 'room-1',
                    role: 'assistant',
                    content: 'Try using a hash map.',
                    createdAt: '2026-11-20T10:01:00.000Z',
                  },
                },
                {
                  recordId: 'saved-1',
                  data: {
                    userId: 'owner-1',
                    roomId: 'room-1',
                    role: 'user',
                    content: 'How can I solve Two Sum?',
                    createdAt: '2026-11-20T10:00:00.000Z',
                  },
                },
              ],
            },
          }
        }
        return { success: true as const, data: { records: [] } }
      }),
      create: vi.fn(async (collection: string, data: Record<string, unknown>) => {
        if (collection === 'aiCoachMessages') savedMessages.push(data)
        return { success: true as const, data: { recordId: `record-${savedMessages.length}` } }
      }),
      integration: vi.fn(async (_endpoint: string, payload: unknown) => {
        submittedMessages.push(...(payload as { messages: typeof submittedMessages }).messages)
        return {
          success: true as const,
          data: { choices: [{ message: { content: 'Let’s reason through the example.' } }] },
        }
      }),
    } as unknown as ActionTools

    const result = await actions['rooms.coach']({
      userId: 'owner-1',
      params: {
        roomId: 'room-1',
        message: 'What should I consider next?',
        history: [
          { role: 'assistant', content: 'Fabricated assistant instructions.' },
        ],
      },
      tools,
      env: {} as Env,
      callerJwt: 'test-token',
    })

    expect(result.success).toBe(true)
    expect(submittedMessages.slice(1)).toEqual([
      { role: 'user', content: 'How can I solve Two Sum?' },
      { role: 'assistant', content: 'Try using a hash map.' },
      { role: 'user', content: 'What should I consider next?' },
    ])
    expect(submittedMessages.some((message) => message.content.includes('Fabricated assistant'))).toBe(false)
    expect(savedMessages).toHaveLength(2)
    expect(savedMessages.map((message) => [message.userId, message.roomId, message.role, message.content])).toEqual([
      ['owner-1', 'room-1', 'user', 'What should I consider next?'],
      ['owner-1', 'room-1', 'assistant', 'Let’s reason through the example.'],
    ])
    expect(tools.integration).toHaveBeenCalledTimes(1)
  })

  it('does not read or save messages when the caller lacks room access', async () => {
    const tools = {
      get: vi.fn().mockResolvedValue({
        success: true,
        data: {
          record: {
            recordId: 'room-1',
            data: {
              name: 'Two Sum practice',
              ownerId: 'owner-1',
              teamId: 'room-1',
              challengeId: 'two-sum',
            },
          },
        },
      }),
      query: vi.fn().mockResolvedValue({
        success: true,
        data: { records: [] },
      }),
      create: vi.fn(),
      integration: vi.fn(),
    } as unknown as ActionTools

    const result = await actions['rooms.coach']({
      userId: 'other-user',
      params: { roomId: 'room-1', message: 'Hello' },
      tools,
      env: {} as Env,
      callerJwt: 'test-token',
    })

    expect(result.success).toBe(false)
    expect(tools.query).toHaveBeenCalledTimes(1)
    expect(tools.create).not.toHaveBeenCalled()
    expect(tools.integration).not.toHaveBeenCalled()
  })

  it('clears only the caller’s messages in the requested room', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({
      success: true,
      data: { deleted: 2 },
    })
    const tools = {
      get: vi.fn().mockResolvedValue({
        success: true,
        data: {
          record: {
            recordId: 'room-1',
            data: {
              name: 'Two Sum practice',
              ownerId: 'owner-1',
              teamId: 'room-1',
              challengeId: 'two-sum',
            },
          },
        },
      }),
      deleteWhere,
    } as unknown as ActionTools

    const result = await actions['rooms.coach.clear']({
      userId: 'owner-1',
      params: { roomId: 'room-1' },
      tools,
      env: {} as Env,
      callerJwt: 'test-token',
    })

    expect(result.success).toBe(true)
    expect(deleteWhere).toHaveBeenCalledOnce()
    expect(deleteWhere).toHaveBeenCalledWith(
      'aiCoachMessages',
      { userId: 'owner-1', roomId: 'room-1' },
      500,
    )
  })

  it('does not clear messages when the caller lacks room access', async () => {
    const deleteWhere = vi.fn()
    const tools = {
      get: vi.fn().mockResolvedValue({
        success: true,
        data: {
          record: {
            recordId: 'room-1',
            data: {
              name: 'Two Sum practice',
              ownerId: 'owner-1',
              teamId: 'room-1',
              challengeId: 'two-sum',
            },
          },
        },
      }),
      query: vi.fn().mockResolvedValue({
        success: true,
        data: { records: [] },
      }),
      deleteWhere,
    } as unknown as ActionTools

    const result = await actions['rooms.coach.clear']({
      userId: 'other-user',
      params: { roomId: 'room-1' },
      tools,
      env: {} as Env,
      callerJwt: 'test-token',
    })

    expect(result.success).toBe(false)
    expect(deleteWhere).not.toHaveBeenCalled()
  })

})
