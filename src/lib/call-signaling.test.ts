import { expect, it } from 'vitest'
import { parseCallSignal } from './call-signaling'

it('accepts session-bound offer, answer, and ICE messages and strips unrelated fields', () => {
  for (const type of ['offer', 'answer']) {
    expect(parseCallSignal(JSON.stringify({ type, session: 'call-1', sdp: 'v=0', token: 'ignored' })))
      .toEqual({ type, session: 'call-1', sdp: 'v=0' })
  }
  expect(parseCallSignal(JSON.stringify({
    type: 'ice', session: 'call-1', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
  }))).toMatchObject({ type: 'ice', candidate: { candidate: 'candidate:1', sdpMLineIndex: 0 } })
})

it('rejects forged server events, malformed frames, and oversized signaling', () => {
  const invalid = [
    '{', 'null', JSON.stringify({ type: 'peer-left', session: 'call-1' }),
    JSON.stringify({ type: 'offer', session: 'call-1', sdp: 'x'.repeat(24_001) }),
    JSON.stringify({ type: 'ice', session: 'call-1', candidate: { candidate: 'test', sdpMLineIndex: -1 } }),
    JSON.stringify({ type: 'media', session: 'call-1', camera: true, microphone: 'true' }),
  ]
  for (const frame of invalid) expect(parseCallSignal(frame)).toBeNull()
})
