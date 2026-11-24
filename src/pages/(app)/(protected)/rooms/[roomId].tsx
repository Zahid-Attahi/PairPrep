import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useQuery, useRecordContext, useUserLookup, useYjsText } from 'deepspace'
import { ArrowLeft, Bot, Check, ClipboardCheck, Code2, ExternalLink, FileText, MailPlus, MoreHorizontal, RotateCcw, Search, Send, Trash2, UserRound, UsersRound, Video } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/DropdownMenu'
import { useToast } from '@/components/ui/Toast'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { RoomReviews } from '@/components/RoomReviews'
import { RoomCall } from '@/components/RoomCall'
import { SharedNotesEditor } from '@/components/SharedNotesEditor'
import { getChallenge } from '@/challenges'
import { callServerAction } from '@/lib/server-actions'

const RoomCodeEditor = lazy(() => import('@/components/RoomCodeEditor'))

interface InterviewRoom {
  name: string
  ownerId: string
  teamId: string
  challengeId: string
  completedAt?: string
}

interface CoachMessage {
  role: 'user' | 'assistant'
  content: string
}

interface StoredCoachMessage extends CoachMessage {
  userId: string
  roomId: string
  createdAt: string
}

interface ResearchResult {
  title: string
  url: string
}

function TechnicalResearch({ roomId }: { roomId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ResearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const searchQuery = query.trim()
    if (!searchQuery || loading) return

    setLoading(true)
    setError('')
    setResults(null)
    try {
      const data = await callServerAction<{ results: ResearchResult[] }>('rooms.research', {
        roomId,
        query: searchQuery,
      })
      setResults(data.results)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Technical research is temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="research" tabIndex={-1} aria-labelledby="research-heading" className="min-w-0 scroll-mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 id="research-heading" className="flex items-center gap-2 text-lg font-semibold"><Search className="size-4 text-primary" aria-hidden="true" /> Technical research</h2>
      <p className="mt-1 text-sm text-muted-foreground">Search for sources on programming concepts, algorithms, and technologies.</p>

      <form onSubmit={(event) => void search(event)} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="research-query" className="sr-only">Search technical topics</label>
        <Input
          id="research-query"
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 300))}
          maxLength={300}
          placeholder="e.g. When to use a hash map"
          disabled={loading}
        />
        <Button type="submit" loading={loading} disabled={!query.trim()} className="shrink-0">
          <Search className="mr-2 size-4" aria-hidden="true" /> Search
        </Button>
      </form>

      {loading && <p role="status" className="mt-5 text-sm text-muted-foreground">Searching technical sources…</p>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {results && results.length === 0 && <p role="status" className="mt-5 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No results found. Try a different search.</p>}
      {results && results.length > 0 && (
        <ol className="mt-5 divide-y divide-border rounded-xl border border-border">
          {results.map((result, index) => (
            <li key={`${result.url}-${index}`} className="p-4 first:rounded-t-xl last:rounded-b-xl">
              <a href={result.url} target="_blank" rel="noreferrer" className="group inline-flex max-w-full items-start gap-2 text-sm font-medium text-primary hover:underline">
                <span className="break-words">{result.title}</span>
                <ExternalLink className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              </a>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{result.url}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Results from Exa.</p>
    </section>
  )
}

function InterviewCoach({ roomId, userId }: { roomId: string; userId: string }) {
  const conversation = useQuery<StoredCoachMessage>('aiCoachMessages', {
    where: { userId, roomId },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 500,
  })
  const messages = conversation.records
    .filter(({ data }) =>
      (data.role === 'user' || data.role === 'assistant') && typeof data.content === 'string'
    )
    .reverse()

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')
  const [cleared, setCleared] = useState(false)
  const busy = useRef(false)
  const transcript = useRef<HTMLOListElement>(null)
  const latestMessageId = messages.at(-1)?.recordId
  const canSend = !loading && !clearing && conversation.status === 'ready'

  useEffect(() => {
    const list = transcript.current
    if (list) list.scrollTop = list.scrollHeight
  }, [latestMessageId])

  async function sendMessage(event?: FormEvent<HTMLFormElement>, prompt?: string) {
    event?.preventDefault()
    const content = (prompt ?? input).trim()
    if (!content || busy.current || !canSend) return

    busy.current = true
    setLoading(true)
    setError('')
    setCleared(false)
    setInput('')
    try {
      await callServerAction<{ reply: string }>('rooms.coach', {
        roomId,
        message: content,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The AI coach is temporarily unavailable.')
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  async function clearConversation() {
    if (busy.current || !canSend || messages.length === 0) return
    busy.current = true
    setClearing(true)
    setError('')
    setCleared(false)
    try {
      await callServerAction<{ cleared: boolean }>('rooms.coach.clear', { roomId })
      setInput('')
      setCleared(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear your conversation.')
    } finally {
      busy.current = false
      setClearing(false)
    }
  }

  return (
    <section id="coach" tabIndex={-1} aria-labelledby="coach-heading" className="min-w-0 scroll-mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="coach-heading" className="flex items-center gap-2 text-lg font-semibold"><Bot className="size-4 text-primary" aria-hidden="true" /> AI interview coach</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ask for a hint, discuss a concept, or get feedback on your approach.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void clearConversation()} disabled={loading || clearing || messages.length === 0 || conversation.status !== 'ready'}>
          <RotateCcw className="mr-2 size-4" aria-hidden="true" /> {clearing ? 'Clearing…' : 'Clear conversation'}
        </Button>
      </div>

      {conversation.status === 'loading' ? (
        <p role="status" className="mt-5 text-sm text-muted-foreground">Loading your conversation…</p>
      ) : conversation.status === 'error' ? (
        <p role="alert" className="mt-5 text-sm text-destructive">Could not load your saved conversation. Please refresh the room.</p>
      ) : messages.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-background/50 p-4">
          <p className="text-sm font-medium">What would you like to work on?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {['Give me a small hint.', 'Ask me a follow-up question.', 'I’ll describe my approach for feedback.'].map((prompt) => (
              <Button key={prompt} type="button" variant="outline" size="sm" onClick={() => void sendMessage(undefined, prompt)} disabled={!canSend}>
                {prompt}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <ol ref={transcript} aria-live="polite" className="mt-5 max-h-[28rem] space-y-3 overflow-y-auto rounded-xl border border-border bg-background/50 p-4">
          {messages.map(({ recordId, data: message }) => (
            <li key={recordId} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}>
              {message.role === 'assistant' && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="size-4" aria-hidden="true" /></span>}
              <p className={`min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-3 py-2.5 text-sm leading-6 ${message.role === 'user' ? 'border border-primary/25 bg-primary/10 text-foreground' : 'border border-border bg-card'}`}>
                {message.content}
              </p>
              {message.role === 'user' && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserRound className="size-4" aria-hidden="true" /></span>}
            </li>
          ))}
        </ol>
      )}

      {loading && <p role="status" className="mt-3 text-sm text-muted-foreground">Coach is thinking…</p>}
      {cleared && <p role="status" className="mt-3 text-sm text-primary">Conversation cleared.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <form onSubmit={(event) => void sendMessage(event)} className="mt-4 flex items-end gap-2">
        <label htmlFor="coach-message" className="sr-only">Message the interview coach</label>
        <Textarea id="coach-message" className="min-h-12 max-h-36 resize-y bg-background" placeholder="Ask about this challenge…" value={input} onChange={(event) => setInput(event.target.value.slice(0, 1200))} maxLength={1200} disabled={!canSend} />
        <Button type="submit" loading={loading} disabled={!input.trim() || !canSend} aria-label="Send message" className="shrink-0">
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </form>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Coach and research share a limit of 20 requests per UTC hour. Shared notes stay in the room.
      </p>
    </section>
  )
}

function CollaborativeRoomNotes({ roomId }: { roomId: string }) {
  const { text, setText, synced, canWrite } = useYjsText('interviewRooms', roomId, 'notes')
  const { status: connectionStatus } = useRecordContext()
  const connected = connectionStatus === 'connected'
  const canEdit = connected && synced && canWrite

  const statusMessage = connectionStatus === 'disconnected'
    ? 'Connection lost. Editing is paused while PairPrep reconnects.'
    : !synced
      ? 'Loading shared notes. Editing stays disabled until the current text is synced.'
      : !canWrite
        ? 'You can view these notes, but your room permissions do not allow edits.'
        : 'Changes sync live with the other participants.'

  return (
    <section id="notes" tabIndex={-1} aria-labelledby="notes-heading" className="min-w-0 scroll-mt-4 rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="notes-heading" className="flex items-center gap-2 text-lg font-semibold"><FileText className="size-4 text-primary" aria-hidden="true" /> Shared interview notes</h2>
        <Badge variant={connected && synced ? 'success' : 'outline'}>
          {connectionStatus === 'disconnected'
            ? 'Reconnecting'
            : !connected
              ? 'Connecting'
              : synced
                ? 'Live'
                : 'Syncing'}
        </Badge>
      </div>
      <p role="status" className="mt-2 text-sm text-muted-foreground">{statusMessage}</p>
      <div className="mt-4">
        <SharedNotesEditor value={text} onChange={setText} disabled={!canEdit} />
      </div>
    </section>
  )
}

export default function RoomDetailPage() {
  const { roomId } = useParams<{ roomId: string }>()
  return <RoomDetail key={roomId} roomId={roomId} />
}

function RoomDetail({ roomId }: { roomId?: string }) {
  const navigate = useNavigate()
  const { success, info } = useToast()
  const { userId } = useAuth()
  const { records, status, error } = useQuery<InterviewRoom>('interviewRooms')
  const { getName, usersLoaded } = useUserLookup()
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [membersStatus, setMembersStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [membersError, setMembersError] = useState('')
  const [email, setEmail] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviting, setInviting] = useState(false)
  const [removingId, setRemovingId] = useState('')
  const [removalError, setRemovalError] = useState('')
  const [removalMessage, setRemovalMessage] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const hasViewedRoom = useRef(false)

  const currentRoom = records.find((record) => record.recordId === roomId)
  const [lastRoom, setLastRoom] = useState<typeof currentRoom>()
  // Keep the workspace mounted during a records reconnect. A fresh query that
  // omits the room still removes the workspace immediately.
  if (status === 'ready' && currentRoom !== lastRoom) setLastRoom(currentRoom)
  const room = status === 'loading' ? lastRoom : currentRoom

  useEffect(() => {
    if (status !== 'ready') return
    if (currentRoom) hasViewedRoom.current = true
    else if (hasViewedRoom.current && !deleting) {
      hasViewedRoom.current = false
      info('This room is no longer available.')
      void navigate('/home', { replace: true })
    }
  }, [currentRoom, deleting, info, navigate, status])

  useEffect(() => {
    if (status !== 'ready' || !room) {
      setMemberIds([])
      setMembersError('')
      setMembersStatus(status === 'loading' ? 'loading' : 'idle')
      return
    }

    let cancelled = false
    setMembersStatus('loading')
    setMembersError('')
    void callServerAction<{ userIds: string[] }>('rooms.members', { roomId: room.recordId })
      .then(({ userIds }) => {
        if (cancelled) return
        setMemberIds(userIds)
        setMembersStatus('ready')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setMembersError(cause instanceof Error ? cause.message : 'Could not load participants.')
        setMembersStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [room?.recordId, status])

  if (status === 'loading' && !room) {
    return <main className="mx-auto max-w-4xl px-4 py-12 text-sm text-muted-foreground sm:px-6">Loading room…</main>
  }

  if (status === 'error') {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          Could not load this room{error ? `: ${error}` : '.'}
        </p>
        <Link to="/home" className="mt-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to workspace</Link>
      </main>
    )
  }

  // Room reads are permission-filtered by RecordRoom. Missing and unauthorized IDs
  // intentionally share the same message so the route does not disclose room existence.
  if (!room) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <EmptyState title="Room unavailable" description="This room may not exist, or you may not have access to it." />
        <div className="text-center"><Link to="/home" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to workspace</Link></div>
      </main>
    )
  }

  const { name, ownerId, challengeId } = room.data
  const roomRecordId = room.recordId
  const challenge = getChallenge(challengeId)
  const isOwner = ownerId === userId
  const participantIds = [...new Set([ownerId, ...memberIds])]

  function participantName(participantId: string) {
    if (participantId === userId) return 'You'
    return getName(participantId) || (participantId === ownerId ? 'Room owner' : 'Collaborator')
  }

  async function deleteRoom() {
    if (!isOwner || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await callServerAction('rooms.delete', { roomId: roomRecordId })
      success('Room deleted.')
      void navigate('/home', { replace: true })
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete the room. Try again.')
      setDeleting(false)
    }
  }

  async function removeParticipant(participantId: string) {
    if (inviting || removingId) return
    setRemovingId(participantId)
    setRemovalError('')
    setRemovalMessage('')
    try {
      const result = await callServerAction<{ removed: boolean; refreshed: boolean }>(
        'rooms.members.remove',
        { roomId: roomRecordId, participantId },
      )
      setMemberIds((ids) => ids.filter((id) => id !== participantId))
      setRemovalMessage(result.removed ? 'Participant removed.' : 'This person was already removed.')
      if (!result.refreshed) setRemovalError('Live connections could not be refreshed. Reopen the room to check its current participant list.')
    } catch (cause) {
      setRemovalError(cause instanceof Error ? cause.message : 'Could not remove the participant.')
    } finally {
      setRemovingId('')
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inviting || removingId) return
    setInviting(true)
    setInviteError('')
    setInviteMessage('')
    try {
      const result = await callServerAction<{ recordId: string; refreshed: boolean; emailSent: boolean }>(
        'rooms.invite',
        { roomId: roomRecordId, email },
      )
      setEmail('')
      setInviteMessage(result.emailSent
        ? `Collaborator added and invitation email sent. ${result.refreshed ? 'Connected clients are reconnecting with updated access.' : 'They may need to refresh PairPrep to see the room.'}`
        : 'Collaborator added and has room access, but the invitation email could not be sent. Share the room link with them directly.')
      setMembersStatus('loading')
      try {
        const members = await callServerAction<{ userIds: string[] }>('rooms.members', { roomId: roomRecordId })
        setMemberIds(members.userIds)
        setMembersStatus('ready')
        setMembersError('')
      } catch {
        setMembersStatus('error')
        setMembersError('Could not refresh the participant list.')
      }
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : 'Could not add that collaborator.')
    } finally {
      setInviting(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <Link to="/home" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to workspace
        </Link>
        {isOwner && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger ref={menuTrigger} render={<Button size="icon" variant="outline" aria-label="Room options" />}>
                <MoreHorizontal aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={() => { setDeleteError(''); setDeleteOpen(true) }}>
                  <Trash2 aria-hidden="true" /> Delete Room
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={deleteOpen} onOpenChange={(open) => { if (!deleting) setDeleteOpen(open) }}>
              <DialogContent hideClose initialFocus={cancelDelete} finalFocus={menuTrigger}>
                <DialogHeader>
                  <DialogTitle>Delete Room?</DialogTitle>
                  <DialogDescription className="break-words">
                    Permanently delete “{name}” and its shared notes, code, AI conversations, and reviews. Everyone will lose access. This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
                <DialogFooter>
                  <DialogClose render={<Button ref={cancelDelete} variant="outline" disabled={deleting} />}>Cancel</DialogClose>
                  <Button variant="destructive" loading={deleting} onClick={() => void deleteRoom()}>Delete Room</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>

      <header className="mt-4 grid items-center gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.65fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{isOwner ? 'You own this room' : 'Collaborator'}</Badge>
            <Badge variant={room.data.completedAt ? 'success' : 'secondary'}>{room.data.completedAt ? 'Complete' : 'In progress'}</Badge>
          </div>
          <h1 className="mt-3 break-words text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{name}</h1>
        </div>
        <div className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-background/60 p-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Code2 className="size-4" aria-hidden="true" /></span>
          <div>
            <p className="text-xs text-muted-foreground">Coding challenge</p>
            <p className="mt-0.5 font-semibold">{challenge?.title || 'Challenge unavailable'}</p>
            {challenge && <p className="mt-1 text-xs text-muted-foreground">{challenge.topic} · {challenge.difficulty}</p>}
          </div>
        </div>
      </header>

      <nav aria-label="Room sections" className="my-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card/60 p-1.5">
        {[
          { id: 'coding', label: 'Code editor', icon: Code2 },
          { id: 'call', label: 'Room call', icon: Video },
          { id: 'notes', label: 'Shared notes', icon: FileText },
          { id: 'participants', label: 'Participants', icon: UsersRound },
          { id: 'coach', label: 'AI Coach', icon: Bot },
          { id: 'research', label: 'Research', icon: Search },
          { id: 'reviews', label: 'Reviews', icon: ClipboardCheck },
        ].map(({ id, label, icon: Icon }) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:text-sm">
            <Icon className="size-3.5" aria-hidden="true" />{label}
          </a>
        ))}
      </nav>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-5 lg:has-[[data-layout=expanded]]:grid-cols-[minmax(0,1fr)_minmax(28rem,52%)]">
        <Suspense fallback={<section id="coding" role="status" className="grid min-h-80 place-items-center rounded-2xl border border-border bg-card text-sm text-muted-foreground">Loading code editor…</section>}>
          <RoomCodeEditor roomId={roomRecordId} />
        </Suspense>
        <aside aria-label="Room access" className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-4">
          <RoomCall key={roomRecordId} roomId={roomRecordId} nameFor={participantName} />
          <section id="participants" tabIndex={-1} aria-labelledby="participants-heading" className="scroll-mt-4 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="participants-heading" className="flex items-center gap-2 text-base font-semibold"><UsersRound className="size-4 text-primary" aria-hidden="true" /> Participants</h2>
              <Badge variant="outline">{participantIds.length}</Badge>
            </div>
            <ul className="mt-5 divide-y divide-border">
              {participantIds.map((participantId) => (
                <li key={participantId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-secondary text-xs font-semibold text-primary" aria-hidden="true">
                      {participantName(participantId).charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{usersLoaded ? participantName(participantId) : participantId === userId ? 'You' : participantId === ownerId ? 'Room owner' : 'Collaborator'}</p>
                      <p className="text-xs text-muted-foreground">{participantId === ownerId ? 'Owner' : 'Collaborator'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isOwner && participantId !== ownerId && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Remove ${participantName(participantId)}`}
                        loading={removingId === participantId}
                        disabled={inviting || Boolean(removingId) || membersStatus !== 'ready'}
                        onClick={() => void removeParticipant(participantId)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {membersStatus === 'ready' && memberIds.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No collaborators have joined this room.</p>}
            {membersStatus === 'loading' && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading active collaborators…</p>}
            {membersStatus === 'error' && <p role="alert" className="mt-4 text-sm text-destructive">{membersError}</p>}
            {removalError && <p role="alert" className="mt-4 text-sm text-destructive">{removalError}</p>}
            {removalMessage && <p role="status" className="mt-4 text-sm text-primary">{removalMessage}</p>}
          </section>

          {isOwner ? (
            <section aria-labelledby="invite-heading" className="rounded-2xl border border-border bg-card p-4">
              <h2 id="invite-heading" className="flex items-center gap-2 text-base font-semibold"><MailPlus className="size-4 text-primary" aria-hidden="true" /> Invite a collaborator</h2>
              <p className="mt-2 text-sm leading-5 text-muted-foreground">Enter the email of someone with a PairPrep account.</p>
              <form onSubmit={invite} className="mt-5 space-y-3">
                <label htmlFor="invite-email" className="sr-only">Collaborator email</label>
                <Input id="invite-email" type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
                {inviteError && <p role="alert" className="text-sm text-destructive">{inviteError}</p>}
                {inviteMessage && <p role="status" className="flex gap-2 text-sm text-primary"><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{inviteMessage}</p>}
                <Button type="submit" loading={inviting} disabled={Boolean(removingId)} className="w-full">Add collaborator</Button>
              </form>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">PairPrep grants room access and emails a link.</p>
            </section>
          ) : null}
        </aside>
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:space-y-5">
          <CollaborativeRoomNotes roomId={roomRecordId} />
          <InterviewCoach roomId={roomRecordId} userId={userId ?? ''} />
          <TechnicalResearch roomId={roomRecordId} />
          <RoomReviews key={userId} roomId={roomRecordId} isOwner={isOwner} completedAt={room.data.completedAt} />
        </div>
      </div>
    </div>
  )
}
