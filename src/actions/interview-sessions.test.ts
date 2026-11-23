import { describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'

vi.mock('deepspace/worker', () => ({ mintUlid: vi.fn() }))

import { actions } from './index'

const review = {
  roomId: 'room-1',
  feedback: ' Explained the approach clearly. ',
  strengths: 'Found the edge case.',
  improvements: 'State complexity earlier.',
}

function setup(completedAt?: string) {
  const env = {} as Env
  let activeMember = true
  const tools = {
    get: vi.fn().mockResolvedValue({
      success: true,
      data: { record: { data: { ownerId: 'owner', teamId: 'team-1', challengeId: 'two-sum', completedAt } } },
    }),
    query: vi.fn((_collection: string, { where }: { where: Record<string, unknown> }) => ({
      success: true,
      data: {
        records: activeMember && where.teamId === 'team-1' &&
          (!where.userId || where.userId === 'member')
          ? [{ data: { userId: 'member', status: 'active' } }]
          : [],
      },
    })),
    update: vi.fn().mockResolvedValue({ success: true, data: { recordId: 'room-1' } }),
    create: vi.fn().mockResolvedValue({ success: true, data: { recordId: 'review-1' } }),
    deleteWhere: vi.fn(async (_collection: string, where: Record<string, unknown>) => {
      const deleted = activeMember && where.teamId === 'team-1' && where.userId === 'member' ? 1 : 0
      if (deleted) activeMember = false
      return { success: true, data: { deleted } }
    }),
    integration: vi.fn(),
  }
  return {
    tools,
    run: (name: string, userId: string, params: Record<string, unknown>) =>
      actions[name]({ userId, params, tools: tools as unknown as ActionTools, env, callerJwt: 'test-token' }),
  }
}

describe('interview session actions', () => {
  it('allows only the owner to complete a room and leaves a completed room unchanged', async () => {
    const { run, tools } = setup()
    expect(await run('rooms.complete', 'member', review)).toMatchObject({ success: false })
    expect(await run('rooms.complete', 'outsider', review)).toMatchObject({ success: false })
    expect(tools.update).not.toHaveBeenCalled()
    expect(await run('rooms.complete', 'owner', review)).toMatchObject({ success: true })
    expect(tools.update).toHaveBeenCalledWith('interviewRooms', 'room-1', { completed: 1 })

    const completed = setup('2026-11-20T10:00:00.000Z')
    expect(await completed.run('rooms.complete', 'owner', review)).toMatchObject({ success: true })
    expect(completed.tools.update).not.toHaveBeenCalled()
  })

  it('saves a self-review under the authenticated participant in a completed room', async () => {
    const { run, tools } = setup('2026-11-20T10:00:00.000Z')
    expect(await run('rooms.reviews.create', 'member', {
      ...review, candidateId: 'owner', score: 100,
    })).toEqual({ success: true, data: { recordId: 'review-1' } })
    expect(tools.create).toHaveBeenCalledWith('interviewReviews', {
      ...review, candidateId: 'member', feedback: review.feedback.trim(),
    })
    expect(tools.integration).not.toHaveBeenCalled()
  })

  it('rejects incomplete rooms, outsiders and invalid feedback before creating a review', async () => {
    const open = setup()
    expect(await open.run('rooms.reviews.create', 'owner', review)).toMatchObject({
      success: false, error: 'Complete the session before writing a review.',
    })
    expect(open.tools.create).not.toHaveBeenCalled()

    const { run, tools } = setup('2026-11-20T10:00:00.000Z')
    expect(await run('rooms.reviews.create', 'outsider', review)).toMatchObject({ success: false })
    expect(await run('rooms.reviews.create', 'owner', { ...review, improvements: '  ' })).toMatchObject({ success: false })
    expect(await run('rooms.reviews.create', 'owner', { ...review, strengths: 'x'.repeat(2001) })).toMatchObject({ success: false })
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('rejects participant removals by non-owners and invalid targets', async () => {
    const { run, tools } = setup()
    for (const caller of ['member', 'outsider']) {
      expect(await run('rooms.members.remove', caller, { ...review, participantId: 'member' })).toMatchObject({ success: false })
    }
    for (const participantId of ['owner', '', 42]) {
      expect(await run('rooms.members.remove', 'owner', { ...review, participantId })).toMatchObject({ success: false })
    }
    expect(tools.deleteWhere).not.toHaveBeenCalled()
  })

  it('revokes room actions and accepts repeated removals', async () => {
    const { run, tools } = setup('2026-11-20T10:00:00.000Z')
    const params = { roomId: 'room-1', participantId: 'member' }
    expect(await run('rooms.members', 'member', params)).toMatchObject({ success: true })
    expect(await run('rooms.members.remove', 'owner', params)).toEqual({
      success: true, data: { removed: true, refreshed: true },
    })
    expect(tools.deleteWhere).toHaveBeenCalledWith('team_members', { teamId: 'team-1', userId: 'member' }, 1)
    expect(await run('rooms.members', 'owner', params)).toEqual({ success: true, data: { userIds: [] } })

    for (const [name, input] of [
      ['rooms.members', params],
      ['rooms.reviews.create', review],
      ['rooms.coach', { ...params, message: 'A hint, please.' }],
      ['rooms.coach.clear', params],
      ['rooms.research', { ...params, query: 'Arrays' }],
    ] as const) {
      expect(await run(name, 'member', input)).toEqual({
        success: false, error: 'Room not found, or you do not have access.',
      })
    }
    expect(await run('rooms.members.remove', 'owner', params)).toEqual({
      success: true, data: { removed: false, refreshed: true },
    })
    expect(tools.create).not.toHaveBeenCalled()
    expect(tools.integration).not.toHaveBeenCalled()
  })

  it('reports a failed membership deletion and allows a retry', async () => {
    const { run, tools } = setup()
    tools.deleteWhere.mockRejectedValueOnce(new Error('Storage unavailable'))
    const params = { roomId: 'room-1', participantId: 'member' }

    expect(await run('rooms.members.remove', 'owner', params)).toEqual({
      success: false, error: 'Could not remove the participant. Try again.',
    })
    expect(await run('rooms.members', 'member', params)).toMatchObject({ success: true })
    expect(await run('rooms.members.remove', 'owner', params)).toEqual({
      success: true, data: { removed: true, refreshed: true },
    })
  })
})

describe('provider response handling', () => {
  it('reports an unusable coach response while keeping the user message', async () => {
    const { run, tools } = setup()
    tools.integration.mockResolvedValueOnce({ success: true, data: null })
    expect(await run('rooms.coach', 'owner', { roomId: 'room-1', message: 'A hint, please.' })).toEqual({
      success: false,
      error: 'The AI coach did not return a usable response. Your message was saved; please try again.',
    })
    expect(tools.create.mock.calls.filter(([collection]) => collection === 'aiCoachMessages')).toEqual([
      ['aiCoachMessages', expect.objectContaining({ role: 'user', content: 'A hint, please.' })],
    ])
  })

  it('distinguishes a missing research response from a valid empty result', async () => {
    const { run, tools } = setup()
    tools.integration
      .mockResolvedValueOnce({ success: true, data: null })
      .mockResolvedValueOnce({ success: true, data: { results: [] } })
    const params = { roomId: 'room-1', query: 'JavaScript Map' }
    expect(await run('rooms.research', 'owner', params)).toMatchObject({
      success: false, error: 'Technical research returned an unexpected response. Please try again.',
    })
    expect(await run('rooms.research', 'owner', params)).toEqual({ success: true, data: { results: [] } })
  })
})
