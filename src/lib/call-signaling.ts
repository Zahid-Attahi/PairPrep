export const callProtocol = 'pairprep-call'

export type CallSignal =
  | { type: 'offer' | 'answer'; session: string; sdp: string }
  | { type: 'ice'; session: string; candidate: RTCIceCandidateInit }
  | { type: 'media'; session: string; camera: boolean; microphone: boolean }

export type CallMessage = CallSignal
  | { type: 'waiting' }
  | { type: 'peer'; session: string; peerId: string; offerer: boolean }
  | { type: 'peer-left' }

export function parseCallSignal(raw: string): CallSignal | null {
  if (raw.length > 32_768) return null
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data.session !== 'string' || data.session.length > 64) return null
    const { type, session } = data
    if ((type === 'offer' || type === 'answer') && typeof data.sdp === 'string' && data.sdp.length <= 24_000) {
      return { type, session, sdp: data.sdp }
    }
    if (type === 'media' && typeof data.camera === 'boolean' && typeof data.microphone === 'boolean') {
      return { type, session, camera: data.camera, microphone: data.microphone }
    }
    const candidate = data.candidate
    if (type === 'ice' && candidate && typeof candidate.candidate === 'string' && candidate.candidate.length <= 2_048 &&
        (candidate.sdpMid == null || (typeof candidate.sdpMid === 'string' && candidate.sdpMid.length <= 64)) &&
        (candidate.sdpMLineIndex == null || (Number.isInteger(candidate.sdpMLineIndex) && candidate.sdpMLineIndex >= 0 && candidate.sdpMLineIndex <= 16)) &&
        (candidate.usernameFragment == null || (typeof candidate.usernameFragment === 'string' && candidate.usernameFragment.length <= 256))) {
      return { type, session, candidate: {
        candidate: candidate.candidate, sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex, usernameFragment: candidate.usernameFragment,
      } }
    }
  } catch {
    // Malformed signaling frames are ignored.
  }
  return null
}
