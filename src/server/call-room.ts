import { callProtocol, parseCallSignal, type CallMessage } from '../lib/call-signaling'

interface Peer {
  userId: string
  session: string | null
  offerer: boolean
  window: number
  frames: number
}

export class AppCallRoom {
  private generation = 0

  constructor(private readonly state: DurableObjectState) {
    void state.blockConcurrencyWhile(async () => {
      this.generation = await state.storage.get<number>('generation') ?? 0
    })
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private peers(exclude?: WebSocket): Array<[WebSocket, Peer]> {
    return this.state.getWebSockets().flatMap((ws): Array<[WebSocket, Peer]> => {
      const peer = ws.deserializeAttachment() as Peer | null
      return ws !== exclude && ws.readyState === WebSocket.OPEN && peer ? [[ws, peer]] : []
    })
  }

  private send(ws: WebSocket, message: CallMessage) {
    try { ws.send(JSON.stringify(message)) } catch { /* A concurrent close is handled by webSocketClose. */ }
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/generation' && request.method === 'GET') return Response.json(this.generation)
    if (pathname === '/revoke' && request.method === 'POST') {
      const userId = request.headers.get('X-Call-User')
      if (!userId) return new Response(null, { status: 400 })
      // The app's records object holds its concurrency barrier while calling
      // this endpoint and removing membership. In-flight joins carry the
      // generation they read before checking room access.
      this.generation += 1
      for (const [socket, peer] of this.peers()) {
        if (peer.userId !== userId) continue
        this.depart(socket)
        socket.close(4403, 'Room access revoked')
      }
      await this.state.storage.put('generation', this.generation)
      return new Response(null, { status: 204 })
    }

    const userId = request.headers.get('X-Call-User')
    if (pathname !== '/join' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || !userId) {
      return new Response(null, { status: 404 })
    }
    const peers = this.peers()
    const [client, server] = Object.values(new WebSocketPair())
    const response = new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': callProtocol } })
    const stale = request.headers.get('X-Call-Generation') !== String(this.generation)
    if (stale || peers.length >= 2 || peers.some(([, peer]) => peer.userId === userId)) {
      server.accept()
      server.close(stale ? 1012 : 4409, stale ? 'Call membership changed' : 'Call full or already joined')
      return response
    }

    this.state.acceptWebSocket(server)
    const session = peers.length ? crypto.randomUUID() : null
    server.serializeAttachment({ userId, session, offerer: false, window: 0, frames: 0 } satisfies Peer)
    const existing = peers[0]
    if (existing && session) {
      const [socket, peer] = existing
      socket.serializeAttachment({ ...peer, session, offerer: true })
      this.send(server, { type: 'peer', session, peerId: peer.userId, offerer: false })
      this.send(socket, { type: 'peer', session, peerId: userId, offerer: true })
    } else {
      this.send(server, { type: 'waiting' })
    }
    return response
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const peer = socket.deserializeAttachment() as Peer | null
    if (!peer?.session || typeof raw !== 'string') return
    const window = Math.floor(Date.now() / 10_000)
    const frames = peer.window === window ? peer.frames + 1 : 1
    if (frames > 150) {
      this.depart(socket)
      socket.close(1008, 'Signaling rate exceeded')
      return
    }
    socket.serializeAttachment({ ...peer, window, frames })
    const signal = parseCallSignal(raw)
    if (!signal || signal.session !== peer.session ||
        (signal.type === 'offer' && !peer.offerer) || (signal.type === 'answer' && peer.offerer)) return
    const remote = this.peers(socket).find(([, other]) => other.session === peer.session)
    if (remote) this.send(remote[0], signal)
  }

  private depart(socket: WebSocket) {
    const peer = socket.deserializeAttachment() as Peer | null
    socket.serializeAttachment(null)
    if (!peer?.session) return
    for (const [remote, other] of this.peers(socket)) {
      if (other.session !== peer.session) continue
      remote.serializeAttachment({ ...other, session: null })
      this.send(remote, { type: 'peer-left' })
    }
  }

  webSocketClose(socket: WebSocket) {
    this.depart(socket)
    socket.close()
  }

  webSocketError(socket: WebSocket) {
    this.depart(socket)
    socket.close(1011, 'Signaling connection closed')
  }
}
