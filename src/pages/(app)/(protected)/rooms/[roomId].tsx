import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, useQuery, useRecordContext, useUserLookup, useYjsText } from 'deepspace'
import { ArrowLeft, Bot, Check, Code2, ExternalLink, FileText, MailPlus, RotateCcw, Search, Send, Sparkles, UserRound, UsersRound } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { getChallenge } from '@/challenges'
import { callServerAction } from '@/lib/server-actions'

interface InterviewRoom {
  name: string
  ownerId: string
  teamId: string
  challengeId: string
}

interface CoachMessage {
  role: 'user' | 'assistant'
  content: string
}

const COACH_REQUEST_LIMIT = 20

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
    <section aria-labelledby="research-heading" className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-2 flex items-center gap-2 text-primary"><Search className="size-4" aria-hidden="true" /><span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Explore the topic</span></div>
      <h2 id="research-heading" className="text-lg font-semibold">Technical research</h2>
      <p className="mt-1 text-sm text-muted-foreground">Find trusted web sources on programming concepts, algorithms, and technologies.</p>

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
              <a href={result.url} target="_blank" rel="noreferrer" className="group inline-flex max-w-full items-start gap-2 font-medium text-primary hover:underline">
                <span className="break-words">{result.title}</span>
                <ExternalLink className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              </a>
              <p className="mt-1 break-all text-xs text-muted-foreground">{result.url}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Search results are provided by Exa. Only source titles and URLs are shown. Research and AI coach requests share a 20-request-per-account UTC-hour limit.</p>
    </section>
  )
}

function InterviewCoach({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestCount = useRef(0)
  const atLimit = requestCount.current >= COACH_REQUEST_LIMIT

  async function sendMessage(event?: FormEvent<HTMLFormElement>, prompt?: string) {
    event?.preventDefault()
    const content = (prompt ?? input).trim()
    if (!content || loading || requestCount.current >= COACH_REQUEST_LIMIT) return

    setLoading(true)
    setError('')
    setInput('')
    requestCount.current += 1
    const nextMessages = [...messages, { role: 'user' as const, content }]
    setMessages(nextMessages)
    try {
      const result = await callServerAction<{ reply: string }>('rooms.coach', {
        roomId,
        message: content,
        history: messages.slice(-8),
      })
      setMessages([...nextMessages, { role: 'assistant', content: result.reply }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The AI coach is temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }

  function clearConversation() {
    if (loading) return
    setMessages([])
    setInput('')
    setError('')
  }

  return (
    <section aria-labelledby="coach-heading" className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary"><Sparkles className="size-4" aria-hidden="true" /><span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Practice with intention</span></div>
          <h2 id="coach-heading" className="text-lg font-semibold">AI interview coach</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ask for a hint, discuss a concept, or get feedback on your approach.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={clearConversation} disabled={loading || messages.length === 0}>
          <RotateCcw className="mr-2 size-4" aria-hidden="true" /> New conversation
        </Button>
      </div>

      {messages.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-background/50 p-4">
          <p className="text-sm font-medium">What would you like to work on?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {['Give me a small hint.', 'Ask me a follow-up question.', 'I’ll describe my approach for feedback.'].map((prompt) => (
              <Button key={prompt} type="button" variant="outline" size="sm" onClick={() => void sendMessage(undefined, prompt)} disabled={loading || atLimit}>
                {prompt}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <ol aria-live="polite" className="mt-5 max-h-[28rem] space-y-3 overflow-y-auto rounded-xl border border-border bg-background/50 p-4">
          {messages.map((message, index) => (
            <li key={`${index}-${message.role}`} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}>
              {message.role === 'assistant' && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="size-4" aria-hidden="true" /></span>}
              <p className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2.5 text-sm leading-6 ${message.role === 'user' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card'}`}>
                {message.content}
              </p>
              {message.role === 'user' && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserRound className="size-4" aria-hidden="true" /></span>}
            </li>
          ))}
          {loading && <li role="status" className="flex items-center gap-3 text-sm text-muted-foreground"><Bot className="size-4" aria-hidden="true" /> Coach is thinking…</li>}
        </ol>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <form onSubmit={(event) => void sendMessage(event)} className="mt-4 flex items-end gap-2">
        <label htmlFor="coach-message" className="sr-only">Message the interview coach</label>
        <Textarea id="coach-message" className="min-h-12 max-h-36 resize-y bg-background" placeholder="Ask about this challenge…" value={input} onChange={(event) => setInput(event.target.value.slice(0, 1200))} maxLength={1200} disabled={loading || atLimit} />
        <Button type="submit" loading={loading} disabled={!input.trim() || atLimit} aria-label="Send message" className="shrink-0">
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </form>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {atLimit ? 'You’ve reached the 20-message limit for this page session. Reload the room to start again.' : `${COACH_REQUEST_LIMIT - requestCount.current} coach requests remaining in this page session. Your shared notes are never sent to the coach.`}
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
    <section aria-labelledby="notes-heading" className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <FileText className="size-4" aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Work through it together</span>
          </div>
          <h2 id="notes-heading" className="text-lg font-semibold">Shared interview notes</h2>
        </div>
        <Badge variant={connected && synced ? 'secondary' : 'outline'}>
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
      <Textarea
        aria-label="Shared interview notes"
        className="mt-4 min-h-64 resize-y bg-background/60 leading-6"
        placeholder="Capture your approach, edge cases, and follow-up questions…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={!canEdit}
      />
    </section>
  )
}

export default function RoomDetailPage() {
  const { roomId } = useParams<{ roomId: string }>()
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

  const room = records.find((record) => record.recordId === roomId)

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

  if (status === 'loading') {
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

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <Link to="/home" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to workspace
      </Link>

      <header className="mt-7 rounded-2xl border border-border bg-card p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isOwner ? 'secondary' : 'outline'}>{isOwner ? 'You own this room' : 'Collaborator'}</Badge>
          {challenge && <Badge variant="outline">{challenge.difficulty}</Badge>}
        </div>
        <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{name}</h1>
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-background/60 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Code2 className="size-4" aria-hidden="true" /></span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Coding challenge</p>
            <p className="mt-1 font-medium">{challenge?.title || 'Challenge unavailable'}</p>
            {challenge && <p className="mt-1 text-sm text-muted-foreground">{challenge.topic}</p>}
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <section aria-labelledby="participants-heading" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2 text-primary"><UsersRound className="size-4" aria-hidden="true" /><span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">In this room</span></div>
              <h2 id="participants-heading" className="text-lg font-semibold">Participants</h2>
            </div>
            <Badge variant="outline">{participantIds.length}</Badge>
          </div>
          <ul className="mt-5 divide-y divide-border">
            {participantIds.map((participantId) => (
              <li key={participantId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span className="min-w-0 truncate text-sm font-medium">{usersLoaded ? participantName(participantId) : participantId === userId ? 'You' : participantId === ownerId ? 'Room owner' : 'Collaborator'}</span>
                <Badge variant={participantId === ownerId ? 'secondary' : 'outline'}>{participantId === ownerId ? 'Owner' : 'Collaborator'}</Badge>
              </li>
            ))}
          </ul>
          {membersStatus === 'loading' && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading active collaborators…</p>}
          {membersStatus === 'error' && <p role="alert" className="mt-4 text-sm text-destructive">{membersError}</p>}
        </section>

        {isOwner ? (
          <section aria-labelledby="invite-heading" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-2 flex items-center gap-2 text-primary"><MailPlus className="size-4" aria-hidden="true" /><span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Practice together</span></div>
            <h2 id="invite-heading" className="text-lg font-semibold">Invite a collaborator</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">Add someone who already has a PairPrep account. They’ll see this room after signing in.</p>
            <form onSubmit={invite} className="mt-5 space-y-3">
              <label htmlFor="invite-email" className="sr-only">Collaborator email</label>
              <Input id="invite-email" type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
              {inviteError && <p role="alert" className="text-sm text-destructive">{inviteError}</p>}
              {inviteMessage && <p role="status" className="flex gap-2 text-sm text-primary"><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{inviteMessage}</p>}
              <Button type="submit" loading={inviting} className="w-full">Add collaborator</Button>
            </form>
            <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">Adding a collaborator grants room access immediately. PairPrep will email the matched account with a link to this room.</p>
          </section>
        ) : (
          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-2 flex items-center gap-2 text-primary"><Check className="size-4" aria-hidden="true" /><span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">You’re in</span></div>
            <h2 className="text-lg font-semibold">Ready to practice</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">You have access to this room as a collaborator. Add your thinking to the shared notes below.</p>
          </section>
        )}
      </div>

      <CollaborativeRoomNotes roomId={roomRecordId} />
      <InterviewCoach roomId={roomRecordId} />
      <TechnicalResearch roomId={roomRecordId} />
    </main>
  )
}
