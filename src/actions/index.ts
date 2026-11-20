import { mintUlid } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { getChallenge, isChallengeId } from '../challenges'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

interface InterviewRoomData extends Record<string, unknown> {
  name: string
  ownerId: string
  teamId: string
  challengeId: string
}

interface RoomMemberData extends Record<string, unknown> {
  teamId: string
  userId: string
  status: string
}

interface UserData extends Record<string, unknown> {
  email: string
}

interface CoachMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatCompletionData {
  choices?: Array<{ message?: { content?: unknown } }>
}

interface CoachRateLimitData extends Record<string, unknown> {
  userId: string
  windowStart: string
  slot: number
}

interface ExaSearchData {
  results?: unknown
}

const RESEARCH_RESULT_LIMIT = 5

const AI_REQUESTS_PER_USER_PER_HOUR = 20

function failure(error: string) {
  return { success: false as const, error }
}

async function getRoomAccess(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  roomId: string,
  callerId: string,
) {
  const roomResult = await tools.get<InterviewRoomData>('interviewRooms', roomId)
  if (!roomResult.success) return null

  const room = roomResult.data.record.data
  if (room.ownerId === callerId) return room
  if (!room.teamId) return null

  const membershipResult = await tools.query<RoomMemberData>('team_members', {
    where: { teamId: room.teamId, userId: callerId, status: 'active' },
    limit: 1,
  })
  if (!membershipResult.success || membershipResult.data.records.length === 0) return null
  return room
}

async function reserveHourlyAiRequest(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  userId: string,
): Promise<'reserved' | 'limited' | 'unavailable'> {
  const now = new Date()
  const windowStart = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(),
  )).toISOString()
  const reservations = await tools.query<CoachRateLimitData>('aiCoachRateLimits', {
    where: { userId, windowStart },
    limit: AI_REQUESTS_PER_USER_PER_HOUR,
  })
  if (!reservations.success) return 'unavailable'

  const occupied = new Set(reservations.data.records.map((record) => record.data.slot))
  if (occupied.size >= AI_REQUESTS_PER_USER_PER_HOUR) return 'limited'

  // The shared unique index arbitrates concurrent coach and research requests.
  for (let slot = 0; slot < AI_REQUESTS_PER_USER_PER_HOUR; slot += 1) {
    if (occupied.has(slot)) continue
    const reservation = await tools.create('aiCoachRateLimits', { userId, windowStart, slot })
    if (reservation.success) return 'reserved'
    if (!reservation.error?.startsWith('Duplicate:')) return 'unavailable'
  }
  return 'limited'
}

async function reconnectRoomClients(env: Env): Promise<boolean> {
  try {
    const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
    const response = await stub.fetch(
      new Request('https://internal/internal/disconnect-sockets', { method: 'POST' }),
    )
    return response.ok
  } catch {
    return false
  }
}

export const actions: Record<string, ActionHandler<Env>> = {
  'rooms.create': async ({ params, tools, userId }) => {
    const name = typeof params.name === 'string' ? params.name.trim() : ''
    if (!name || name.length > 80) return failure('Enter a room name of 1 to 80 characters.')
    if (!isChallengeId(params.challengeId)) return failure('Choose a valid coding challenge.')

    // The server mints both identifiers. Using the room record ID as teamId
    // gives each room a stable, unique membership scope without a client input.
    const roomId = mintUlid()
    return tools.create(
      'interviewRooms',
      { name, ownerId: userId, teamId: roomId, challengeId: params.challengeId },
      roomId,
    )
  },

  'rooms.invite': async ({ params, tools, userId, env }) => {
    const roomId = typeof params.roomId === 'string' ? params.roomId.trim() : ''
    const email = typeof params.email === 'string' ? params.email.trim().toLowerCase() : ''
    if (!roomId || roomId.length > 128) return failure('A valid room is required.')
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return failure('Enter a valid email address.')
    }

    // ActionTools bypasses per-record RBAC, so explicitly gate every protected read/write.
    const roomResult = await tools.get<InterviewRoomData>('interviewRooms', roomId)
    if (!roomResult.success) return failure('Room not found.')
    const room = roomResult.data.record.data
    if (room.ownerId !== userId) return failure('Only the room owner can invite participants.')
    if (!room.teamId) return failure('Room membership data is invalid.')

    // Only the account email is used for lookup; no user row is returned to the client.
    const usersResult = await tools.query<UserData>('users', { where: { email }, limit: 2 })
    if (!usersResult.success) return failure('Could not look up that PairPrep account.')
    if (usersResult.data.records.length === 0) {
      return failure('No existing PairPrep account matches that email. Ask them to sign in first.')
    }
    if (usersResult.data.records.length > 1) return failure('That email matches more than one account.')

    const invitee = usersResult.data.records[0]
    const inviteeId = invitee.recordId
    const inviteeEmail = invitee.data.email
    if (typeof inviteeEmail !== 'string' || inviteeEmail.trim().toLowerCase() !== email) {
      return failure('Could not verify that email address belongs to the matched PairPrep account.')
    }
    if (inviteeId === room.ownerId) return failure('The room owner is already a participant.')

    const existingMembership = await tools.query<RoomMemberData>('team_members', {
      where: { teamId: room.teamId, userId: inviteeId },
      limit: 1,
    })
    if (!existingMembership.success) return failure('Could not verify room membership.')
    if (existingMembership.data.records.length > 0) {
      return failure('That person is already a collaborator. No new invitation email was sent.')
    }

    // uniqueOn is also enforced by RecordRoom, covering simultaneous invitations
    // that pass the lookup at the same time.
    const created = await tools.create('team_members', {
      teamId: room.teamId,
      userId: inviteeId,
      status: 'active',
    })
    if (!created.success) {
      if (created.error?.startsWith('Duplicate:')) {
        return failure('That person is already a collaborator. No new invitation email was sent.')
      }
      return created
    }

    const appOrigin = seo.origin.replace(/\/+$/, '')
    const roomUrl = `${appOrigin}/rooms/${encodeURIComponent(roomId)}`
    const roomName = room.name.replace(/[\r\n\t]+/g, ' ').trim()
    let emailSent = false
    try {
      const emailResult = await tools.integration('email/send', {
        from: `PairPrep <${APP_NAME}@app.space>`,
        to: inviteeEmail.trim(),
        subject: 'You’re invited to a PairPrep practice room',
        text: `You’ve been added to the PairPrep room “${roomName}”.\n\nOpen the room: ${roomUrl}\n\nSign in to PairPrep to continue.`,
      })
      emailSent = emailResult.success
    } catch {
      // Membership is already active; a delivery failure must not revoke access.
    }

    // DeepSpace 0.44.2's membership-change notifier reads `UserId` while
    // membership fields are `userId`; force a supported reconnect so active
    // clients resubscribe with current team access. The endpoint is app-wide.
    const refreshed = await reconnectRoomClients(env)
    return {
      success: true,
      data: { recordId: created.data.recordId, refreshed, emailSent },
    }
  },

  'rooms.members': async ({ params, tools, userId }) => {
    const roomId = typeof params.roomId === 'string' ? params.roomId.trim() : ''
    if (!roomId || roomId.length > 128) return failure('A valid room is required.')

    const room = await getRoomAccess(tools, roomId, userId)
    if (!room) return failure('Room not found, or you do not have access.')

    const membersResult = await tools.query<RoomMemberData>('team_members', {
      where: { teamId: room.teamId, status: 'active' },
    })
    if (!membersResult.success) return failure('Could not load room participants.')

    // Return only active user IDs; the owner is represented separately by ownerId.
    const userIds = [...new Set(membersResult.data.records
      .map((record) => record.data.userId)
      .filter((memberId) => typeof memberId === 'string' && memberId !== room.ownerId))]
    return { success: true, data: { userIds } }
  },

  'rooms.coach': async ({ params, tools, userId }) => {
    const roomId = typeof params.roomId === 'string' ? params.roomId.trim() : ''
    const message = typeof params.message === 'string' ? params.message.trim() : ''
    if (!userId) return failure('Sign in to use the interview coach.')
    if (!roomId || roomId.length > 128) return failure('A valid room is required.')
    if (!message || message.length > 1200) {
      return failure('Enter a message of 1 to 1,200 characters.')
    }

    // ActionTools bypasses record RBAC; verify room access before using its data.
    const room = await getRoomAccess(tools, roomId, userId)
    if (!room) return failure('Room not found, or you do not have access.')
    const challenge = getChallenge(room.challengeId)
    if (!challenge) return failure('This room’s challenge is unavailable.')

    const rawHistory = params.history
    if (rawHistory !== undefined && !Array.isArray(rawHistory)) {
      return failure('The conversation could not be used. Start a new conversation.')
    }
    const history = (Array.isArray(rawHistory) ? rawHistory : []).slice(-8)
    const messages: CoachMessage[] = []
    for (const item of history) {
      if (
        !item || typeof item !== 'object' ||
        !('role' in item) || !('content' in item) ||
        (item.role !== 'user' && item.role !== 'assistant') ||
        typeof item.content !== 'string' || item.content.length > 1200
      ) {
        return failure('The conversation could not be used. Start a new conversation.')
      }
      messages.push({ role: item.role, content: item.content })
    }
    messages.push({ role: 'user', content: message })

    const reservation = await reserveHourlyAiRequest(tools, userId)
    if (reservation === 'unavailable') return failure('Could not verify the AI coach request limit. Please try again.')
    if (reservation === 'limited') {
      return failure('You’ve reached the limit of 20 AI coach and research requests for this UTC hour. Please try again after the hour resets.')
    }

    const systemMessage = [
      'You are PairPrep’s technical interview coach. Help the candidate reason through the current coding challenge; do not immediately give a complete solution.',
      'Give progressive hints, explain programming concepts clearly, ask relevant follow-up interview questions, and give focused feedback on the candidate’s described approach.',
      'Stay focused on this challenge. Be concise, supportive, and technically accurate. If asked for a complete answer, first offer the next useful hint and invite the candidate to reason through it.',
      `Challenge: ${challenge.title}. Topic: ${challenge.topic}. Difficulty: ${challenge.difficulty}.`,
    ].join('\n')

    const result = await tools.integration<ChatCompletionData>('openai/chat-completion', {
      model: 'gpt-5.6-terra',
      messages: [{ role: 'system', content: systemMessage }, ...messages],
    })
    if (!result.success) return failure('The AI coach is temporarily unavailable. Please try again.')

    const reply = result.data.choices?.[0]?.message?.content
    if (typeof reply !== 'string' || !reply.trim()) {
      return failure('The AI coach did not return a usable response. Please try again.')
    }
    return { success: true, data: { reply: reply.trim() } }
  },

  'rooms.research': async ({ params, tools, userId }) => {
    const roomId = typeof params.roomId === 'string' ? params.roomId.trim() : ''
    const query = typeof params.query === 'string' ? params.query.trim() : ''
    if (!userId) return failure('Sign in to use technical research.')
    if (!roomId || roomId.length > 128) return failure('A valid room is required.')
    if (!query || query.length > 300) {
      return failure('Enter a search query of 1 to 300 characters.')
    }

    // ActionTools bypasses per-record RBAC; verify access before making the paid call.
    const room = await getRoomAccess(tools, roomId, userId)
    if (!room) return failure('Room not found, or you do not have access.')

    const reservation = await reserveHourlyAiRequest(tools, userId)
    if (reservation === 'unavailable') return failure('Could not verify the technical research request limit. Please try again.')
    if (reservation === 'limited') {
      return failure('You’ve reached the limit of 20 AI coach and research requests for this UTC hour. Please try again after the hour resets.')
    }

    let result
    try {
      result = await tools.integration<ExaSearchData>('exa/search', { query })
    } catch {
      return failure('Technical research is temporarily unavailable. Please try again.')
    }
    if (!result.success) {
      return failure('Technical research is temporarily unavailable. Please try again.')
    }
    if (!Array.isArray(result.data.results)) {
      return failure('Technical research returned an unexpected response. Please try again.')
    }

    const results: Array<{ title: string; url: string }> = []
    for (const item of result.data.results) {
      if (!item || typeof item !== 'object' || !('title' in item) || !('url' in item)) continue
      if (typeof item.title !== 'string' || typeof item.url !== 'string') continue
      const title = item.title.trim()
      const url = item.url.trim()
      if (!title || title.length > 300 || url.length > 2048) continue
      try {
        const parsedUrl = new URL(url)
        if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') continue
      } catch {
        continue
      }
      results.push({ title, url })
      if (results.length === RESEARCH_RESULT_LIMIT) break
    }

    return { success: true, data: { results } }
  },
}
