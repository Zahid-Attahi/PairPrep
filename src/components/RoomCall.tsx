import { useEffect, useRef, useState } from 'react'
import { Expand, Maximize, Mic, MicOff, Minimize, Minus, Phone, PhoneOff, Shrink, UserRound, Video, VideoOff } from 'lucide-react'
import { connectRoomCall } from '@/lib/room-call'
import { Button } from '@/components/ui/Button'

type Phase = 'idle' | 'requesting' | 'connecting' | 'waiting' | 'connected' | 'reconnecting'
type CallLayout = 'normal' | 'expanded' | 'minimized'
type Connection = ReturnType<typeof connectRoomCall>
const descriptions: Record<Phase, string> = {
  idle: 'Join with video or audio only.',
  requesting: 'Waiting for device permission…',
  connecting: 'Connecting the call…',
  waiting: 'Waiting for another participant…',
  connected: 'Peer-to-peer call connected.',
  reconnecting: 'Connection interrupted. Reconnecting…',
}

function deviceError(error: unknown) {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Device permission denied. Allow access in your browser and try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Camera or microphone unavailable. Check your devices, or try audio only.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'Could not open a device. Close other apps using it and try again.'
  return 'Could not access your camera or microphone.'
}

function CallTile({ name, stream, camera, microphone, local }: {
  name: string; stream: MediaStream | null; camera: boolean; microphone: boolean; local?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [needsPlayback, setNeedsPlayback] = useState(false)
  useEffect(() => {
    const element = video.current
    if (!element) return
    let active = true
    element.srcObject = stream
    setNeedsPlayback(false)
    if (stream) void element.play().catch(() => { if (active && !local) setNeedsPlayback(true) })
    return () => { active = false; element.srcObject = null }
  }, [stream, local])

  return (
    <div className="relative aspect-video min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-background group-data-[fullscreen=true]/call:h-full group-data-[fullscreen=true]/call:w-full">
      <video ref={video} aria-label={`${name} video`} autoPlay playsInline muted={local} className={`h-full w-full object-cover group-data-[layout=expanded]/call:object-contain group-data-[fullscreen=true]/call:object-contain ${camera ? '' : 'opacity-0'}`} />
      {!camera && <div className="pointer-events-none absolute inset-0 grid place-items-center text-muted-foreground"><UserRound aria-hidden="true" /></div>}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/85 px-2 py-1.5 text-xs">
        <span className="truncate">{name}</span>
        {microphone ? <Mic className="size-3 shrink-0" aria-label="Microphone on" /> : <MicOff className="size-3 shrink-0" aria-label="Microphone muted" />}
      </div>
      {needsPlayback && (
        <Button className="absolute left-2 top-2" size="sm" onClick={() => {
          void video.current?.play().then(() => setNeedsPlayback(false)).catch(() => {})
        }}>Play call audio</Button>
      )}
    </div>
  )
}

export function RoomCall({ roomId, nameFor }: { roomId: string; nameFor: (id: string) => string }) {
  const [layout, setLayout] = useState<CallLayout>('normal')
  const [fullscreen, setFullscreen] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const layoutToggle = useRef<HTMLButtonElement>(null)
  const fullscreenToggle = useRef<HTMLButtonElement>(null)
  const fullscreenFallback = useRef<HTMLDialogElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [local, setLocal] = useState<MediaStream | null>(null)
  const [remote, setRemote] = useState<{ id: string; stream: MediaStream } | null>(null)
  const [remoteMedia, setRemoteMedia] = useState({ camera: false, microphone: false })
  const [camera, setCamera] = useState(false)
  const [microphone, setMicrophone] = useState(true)
  const [cameraBusy, setCameraBusy] = useState(false)
  const connection = useRef<Connection | null>(null)
  const joinRequest = useRef<symbol | null>(null)
  const cameraRequest = useRef<symbol | null>(null)

  useEffect(() => () => {
    joinRequest.current = null
    cameraRequest.current = null
    connection.current?.leave()
    connection.current = null
  }, [])

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === panel.current || Boolean(fullscreenFallback.current?.open))
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  function exitFullscreen() {
    if (fullscreenFallback.current?.open) fullscreenFallback.current.close()
    if (panel.current && document.fullscreenElement === panel.current) {
      void document.exitFullscreen().catch(() => {})
    }
  }

  async function toggleFullscreen() {
    if (fullscreen) {
      exitFullscreen()
      return
    }

    const element = panel.current
    if (!element) return
    if (document.fullscreenEnabled && element.requestFullscreen) {
      try {
        await element.requestFullscreen()
        return
      } catch {
        // Some browsers restrict fullscreen requests. Use an in-page modal.
      }
    }
    const dialog = fullscreenFallback.current
    if (!dialog || !connection.current) return
    dialog.showModal()
    setFullscreen(true)
    fullscreenToggle.current?.focus()
  }

  function leave() {
    exitFullscreen()
    setLayout('normal')
    joinRequest.current = null
    cameraRequest.current = null
    connection.current?.leave()
    connection.current = null
    setPhase('idle')
    setLocal(null)
    setRemote(null)
    setCamera(false)
    setCameraBusy(false)
    setMicrophone(true)
  }

  async function join(video: boolean) {
    if (joinRequest.current || connection.current) return
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setError('Calling requires a supported browser on HTTPS or localhost.')
      return
    }
    const request = Symbol()
    joinRequest.current = request
    setPhase('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true, video: video ? { width: { ideal: 640 }, height: { ideal: 360 } } : false,
      })
      if (joinRequest.current !== request) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      joinRequest.current = null
      setLocal(stream)
      setCamera(stream.getVideoTracks().length > 0)
      connection.current = connectRoomCall(roomId, stream, {
        phase: setPhase,
        remote: (id, stream) => setRemote(id && stream ? { id, stream } : null),
        media: setRemoteMedia,
        ended: (message) => { leave(); setError(message) },
      })
    } catch (cause) {
      if (joinRequest.current !== request) return
      leave()
      setError(deviceError(cause))
    }
  }

  async function toggleCamera() {
    const current = connection.current
    if (!local || !current || cameraRequest.current) return
    const request = Symbol()
    cameraRequest.current = request
    setCameraBusy(true)
    setError('')
    let added: MediaStreamTrack | undefined
    try {
      if (camera) {
        for (const track of local.getVideoTracks()) {
          track.stop()
          local.removeTrack(track)
        }
        setCamera(false)
        await current.replaceVideo(null)
      } else {
        const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } } })
        added = media.getVideoTracks()[0]
        if (cameraRequest.current !== request || !added) {
          media.getTracks().forEach((track) => track.stop())
          return
        }
        local.addTrack(added)
        await current.replaceVideo(added)
        if (cameraRequest.current !== request) { added.stop(); return }
        setCamera(true)
      }
      current.announceMedia()
    } catch (cause) {
      if (added) { added.stop(); local.removeTrack(added) }
      if (cameraRequest.current === request) setError(deviceError(cause))
    } finally {
      if (cameraRequest.current === request) {
        cameraRequest.current = null
        setCameraBusy(false)
      }
    }
  }

  function toggleMicrophone() {
    if (!local) return
    for (const track of local.getAudioTracks()) track.enabled = !microphone
    setMicrophone(!microphone)
    connection.current?.announceMedia()
  }

  return (
    // The fallback wraps the existing panel so opening it preserves the video elements.
    <dialog
      ref={fullscreenFallback}
      aria-labelledby="call-heading"
      className="not-open:contents open:fixed open:inset-0 open:m-0 open:h-dvh open:max-h-none open:w-full open:max-w-none open:bg-card open:p-0 open:text-foreground"
      onClose={() => setFullscreen(document.fullscreenElement === panel.current)}
    >
      <div id="call" tabIndex={-1} className="scroll-mt-4">
        <section
          ref={panel}
          aria-labelledby="call-heading"
          data-layout={layout}
          data-fullscreen={fullscreen}
          className={`group/call rounded-2xl border border-border bg-card p-4 ${fullscreen
            ? 'flex h-dvh w-full flex-col overflow-y-auto rounded-none text-foreground sm:p-6'
            : layout === 'minimized'
              ? 'fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 max-h-[65dvh] w-[min(17rem,calc(100vw-1.5rem))] overflow-y-auto p-2.5 shadow-xl'
              : ''}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-1">
            <h2 id="call-heading" className="flex items-center gap-2 text-base font-semibold"><Video className="size-4 text-primary" aria-hidden="true" /> Room call</h2>
            {local && (
              <div role="group" aria-label="Call layout" className="flex gap-0.5">
                {!fullscreen && <>
                  <Button ref={layoutToggle} size="icon" variant="ghost" onClick={() => setLayout(layout === 'normal' ? 'expanded' : 'normal')} aria-label={layout === 'normal' ? 'Expand call' : 'Restore call'} title={layout === 'normal' ? 'Expand call' : 'Restore call'}>
                    {layout === 'normal' ? <Expand aria-hidden="true" /> : <Shrink aria-hidden="true" />}
                  </Button>
                  {layout !== 'minimized' && (
                    <Button size="icon" variant="ghost" onClick={() => {
                      setLayout('minimized')
                      layoutToggle.current?.focus({ preventScroll: true })
                    }} aria-label="Minimize call" title="Minimize call">
                      <Minus aria-hidden="true" />
                    </Button>
                  )}
                </>}
                <Button ref={fullscreenToggle} size="icon" variant="ghost" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen call'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen call'}>
                  {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
                </Button>
              </div>
            )}
          </div>
          <p role="status" className="mt-2 text-sm text-muted-foreground">{descriptions[phase]}</p>
          {phase === 'idle' ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void join(true)}><Phone aria-hidden="true" /> Join Call</Button>
              <Button size="sm" variant="outline" onClick={() => void join(false)}>Join audio only</Button>
            </div>
          ) : (
            <>
              {local && <div className={`mt-3 grid gap-2 ${fullscreen
                ? 'min-h-32 flex-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1'
                : layout === 'expanded' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-2'}`}>
                <CallTile name="You" stream={local} camera={camera} microphone={microphone} local />
                <CallTile name={remote ? nameFor(remote.id) : 'Waiting for peer'} stream={remote?.stream ?? null} camera={remoteMedia.camera} microphone={remoteMedia.microphone} />
              </div>}
              <div className="mt-3 flex flex-wrap gap-2">
                {local && <>
                  <Button size="sm" variant="outline" onClick={toggleMicrophone} aria-label={microphone ? 'Mute microphone' : 'Unmute microphone'}>
                    {microphone ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
                  </Button>
                  <Button size="sm" variant="outline" loading={cameraBusy} onClick={() => void toggleCamera()} aria-label={camera ? 'Turn camera off' : 'Turn camera on'}>
                    {camera ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
                  </Button>
                </>}
                <Button size="sm" variant="destructive" onClick={leave}><PhoneOff aria-hidden="true" /> Leave Call</Button>
              </div>
            </>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        </section>
      </div>
    </dialog>
  )
}
