import { getAuthToken } from 'deepspace'
import { callProtocol, type CallMessage, type CallSignal } from './call-signaling'

type Phase = 'connecting' | 'waiting' | 'connected' | 'reconnecting'
type MediaState = { camera: boolean; microphone: boolean }
type Peer = {
  id: string
  session: string
  pc: RTCPeerConnection
  video?: RTCRtpSender
  candidates: RTCIceCandidateInit[]
  stream: MediaStream
}

const publicStun = 'stun:stun.l.google.com:19302'

export function connectRoomCall(roomId: string, stream: MediaStream, events: {
  phase: (phase: Phase) => void
  remote: (id: string | null, stream: MediaStream | null) => void
  media: (state: MediaState) => void
  ended: (message: string) => void
}) {
  let socket: WebSocket | undefined
  let peer: Peer | undefined
  let closed = false
  let retry = 0
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let mediaTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  function clearPeer() {
    clearTimeout(mediaTimer)
    const previous = peer
    peer = undefined
    previous?.pc.close()
    events.remote(null, null)
    events.media({ camera: false, microphone: false })
  }

  function leave() {
    if (closed) return
    closed = true
    clearTimeout(reconnect)
    clearInterval(heartbeat)
    const previous = socket
    socket = undefined
    previous?.close()
    clearPeer()
    stream.getTracks().forEach((track) => track.stop())
  }

  function end(message: string) {
    leave()
    events.ended(message)
  }

  function send(signal: CallSignal) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(signal))
  }

  function announceMedia() {
    if (!peer) return
    send({
      type: 'media', session: peer.session,
      microphone: stream.getAudioTracks().some((track) => track.enabled && track.readyState === 'live'),
      camera: stream.getVideoTracks().some((track) => track.enabled && track.readyState === 'live'),
    })
  }

  function startPeer(message: Extract<CallMessage, { type: 'peer' }>) {
    clearPeer()
    const stun = import.meta.env.VITE_CALL_STUN_URL ?? publicStun
    const pc = new RTCPeerConnection({ iceServers: stun ? [{ urls: stun }] : [] })
    const current: Peer = { id: message.peerId, session: message.session, pc, candidates: [], stream: new MediaStream() }
    if (message.offerer) {
      const options: RTCRtpTransceiverInit = { direction: 'sendrecv', streams: [stream] }
      pc.addTransceiver(stream.getAudioTracks()[0] ?? 'audio', options)
      current.video = pc.addTransceiver(stream.getVideoTracks()[0] ?? 'video', options).sender
    }
    peer = current
    events.phase('connecting')
    events.remote(current.id, current.stream)
    mediaTimer = setTimeout(() => {
      if (peer === current && pc.connectionState !== 'connected') {
        end('A direct connection could not be established. This network may require a TURN relay.')
      }
    }, 18_000)
    pc.ontrack = ({ track }) => {
      if (peer === current) current.stream.addTrack(track)
    }
    pc.onicecandidate = ({ candidate }) => {
      if (peer === current && candidate) send({ type: 'ice', session: current.session, candidate: candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      if (peer !== current) return
      if (pc.connectionState === 'connected') {
        clearTimeout(mediaTimer)
        events.phase('connected')
      } else if (pc.connectionState === 'disconnected') {
        events.phase('reconnecting')
        clearTimeout(mediaTimer)
        mediaTimer = setTimeout(() => { if (peer === current) socket?.close() }, 6_000)
      } else if (pc.connectionState === 'failed') {
        end('A direct connection failed. This network may require a TURN relay.')
      }
    }
    announceMedia()
    return current
  }

  async function receive(message: CallMessage) {
    if (message.type === 'waiting' || message.type === 'peer-left') {
      retry = 0
      clearPeer()
      events.phase('waiting')
      return
    }
    if (message.type === 'peer') {
      retry = 0
      const current = startPeer(message)
      if (!message.offerer) return
      await current.pc.setLocalDescription(await current.pc.createOffer())
      const sdp = current.pc.localDescription?.sdp
      if (peer === current && sdp) send({ type: 'offer', session: current.session, sdp })
      return
    }

    const current = peer
    if (!current || current.session !== message.session) return
    if (message.type === 'media') {
      events.media(message)
    } else if (message.type === 'ice') {
      if (!current.pc.remoteDescription) {
        if (current.candidates.length < 128) current.candidates.push(message.candidate)
      } else {
        await current.pc.addIceCandidate(message.candidate).catch(() => {})
      }
    } else {
      await current.pc.setRemoteDescription({ type: message.type, sdp: message.sdp })
      for (const candidate of current.candidates.splice(0)) {
        await current.pc.addIceCandidate(candidate).catch(() => {})
      }
      if (message.type !== 'offer' || peer !== current) return
      // The answerer uses the transceivers associated with the remote offer.
      // Transceivers created locally before applying it may stay unassociated.
      for (const transceiver of current.pc.getTransceivers()) {
        const kind = transceiver.receiver.track.kind
        transceiver.direction = 'sendrecv'
        transceiver.sender.setStreams(stream)
        if (kind === 'video') current.video = transceiver.sender
        await transceiver.sender.replaceTrack(stream.getTracks().find((track) => track.kind === kind) ?? null)
      }
      await current.pc.setLocalDescription(await current.pc.createAnswer())
      const sdp = current.pc.localDescription?.sdp
      if (peer === current && sdp) send({ type: 'answer', session: current.session, sdp })
    }
  }

  async function connect() {
    const token = await getAuthToken().catch(() => null)
    if (closed) return
    if (!token) return end('Sign in again to join the call.')
    const url = new URL(`/ws/call/${encodeURIComponent(roomId)}`, window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    let connection: WebSocket
    try {
      connection = new WebSocket(url, [callProtocol, token])
    } catch {
      return end('Could not open the call connection.')
    }
    socket = connection
    let incoming = Promise.resolve()
    let lastReply = Date.now()
    connection.onmessage = ({ data }) => {
      lastReply = Date.now()
      if (data === 'pong') return
      incoming = incoming.then(async () => {
        if (socket === connection && !closed) await receive(JSON.parse(data) as CallMessage)
      }).catch(() => {
        if (socket === connection && !closed) end('Could not negotiate the call. Join again to retry.')
      })
    }
    heartbeat = setInterval(() => {
      if (Date.now() - lastReply > 15_000) connection.close()
      else if (connection.readyState === WebSocket.OPEN) connection.send('ping')
    }, 5_000)
    connection.onclose = ({ code }) => {
      if (socket !== connection || closed) return
      socket = undefined
      clearInterval(heartbeat)
      clearPeer()
      if (code === 4403) return end('You no longer have access to this call.')
      if (code === 4409) return end('Two people are already in the call, or you joined from another tab.')
      if (retry >= 3) return end('Signaling disconnected. Check your connection and room access, then join again.')
      events.phase('reconnecting')
      reconnect = setTimeout(() => { void connect() }, 500 * 2 ** retry++)
    }
  }

  events.phase('connecting')
  void connect()
  return {
    leave,
    announceMedia,
    replaceVideo: async (track: MediaStreamTrack | null) => {
      const current = peer
      try { await current?.video?.replaceTrack(track) } catch (error) {
        if (peer === current) throw error
      }
    },
  }
}
