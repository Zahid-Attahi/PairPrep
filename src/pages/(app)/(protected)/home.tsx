import { lazy, Suspense, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  Code2,
  Plus,
  UsersRound,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { getChallenge } from '@/challenges'
import type { InterviewReview } from '@/components/RoomReviews'

const CreateRoomDialog = lazy(() => import('@/components/CreateRoomDialog'))

interface InterviewRoom {
  name: string
  ownerId: string
  teamId: string
  challengeId: string
  completedAt?: string
}

interface CompletedInterviewRoom extends InterviewRoom {
  completedAt: string
}

export default function HomePage() {
  const { userId } = useAuth()
  const { records: rooms, status, error } = useQuery<InterviewRoom>('interviewRooms', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const { records: reviews, status: reviewsStatus } = useQuery<InterviewReview>('interviewReviews', {
    where: { candidateId: userId ?? '' },
  })
  const { records: completedRooms, status: historyStatus } = useQuery<CompletedInterviewRoom>('interviewRooms', {
    where: { completed: 1 },
    orderBy: 'completedAt',
    orderDir: 'desc',
  })
  const reviewedRoomIds = new Set(reviews.map(({ data }) => data.roomId))
  const navigate = useNavigate()
  const createRoomButtonRef = useRef<HTMLButtonElement>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createDialogLoaded, setCreateDialogLoaded] = useState(false)

  function openCreate() {
    setCreateDialogLoaded(true)
    setCreateOpen(true)
  }

  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-11 lg:px-8">
        <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-[2.75rem]">Practice workspace</h1>
            <p className="mt-2 text-sm text-muted-foreground">Start a coding session, continue practicing, or revisit your feedback.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button ref={createRoomButtonRef} size="lg" onClick={openCreate}>
              <Plus aria-hidden="true" /> Create room
            </Button>
            <a href="#interview-history" className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground lg:hidden">
              View history
            </a>
          </div>
        </header>

        <div className="grid items-start gap-7 py-7 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
          <section aria-labelledby="rooms-heading" className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UsersRound className="size-4 text-primary" aria-hidden="true" />
                <h2 id="rooms-heading" className="text-lg font-semibold tracking-tight">Interview rooms</h2>
              </div>
              {status === 'ready' && rooms.length > 0 && <Badge variant="outline">{rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}</Badge>}
            </div>

            <div className="min-w-0">
              {status === 'loading' && (
                <div role="status" className="flex min-h-[230px] items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
                  Loading your rooms…
                </div>
              )}
              {status === 'error' && (
                <EmptyState
                  className="min-h-[230px] rounded-xl border border-border bg-card px-6 py-10"
                  icon={<UsersRound className="text-destructive" aria-hidden="true" />}
                  title="Rooms could not be loaded"
                  description={error || 'Check your connection and refresh the page to try again.'}
                />
              )}
              {status === 'ready' && rooms.length === 0 && (
                <EmptyState
                  className="min-h-[250px] rounded-xl border border-dashed border-border bg-card px-6 py-10"
                  icon={<UsersRound className="text-primary" aria-hidden="true" />}
                  title="No interview rooms yet"
                  description="Choose a challenge and invite a partner to your first practice session."
                  action={{ label: 'Create your first room', onClick: openCreate }}
                />
              )}
              {status === 'ready' && rooms.length > 0 && (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {rooms.map((room) => {
                    const challenge = getChallenge(room.data.challengeId)
                    const isOwner = room.data.ownerId === userId
                    return (
                      <li key={room.recordId}>
                        <Link
                          to={`/rooms/${encodeURIComponent(room.recordId)}`}
                          className="group flex h-full min-h-40 flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/45 hover:bg-secondary/60"
                        >
                          <span className="flex items-start justify-between">
                            <span className="grid size-9 place-items-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                              <Code2 className="size-4" aria-hidden="true" />
                            </span>
                            <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block break-words font-semibold">{room.data.name}</span>
                            <span className="mt-1 block text-sm text-muted-foreground">
                              {challenge ? `${challenge.title} · ${challenge.difficulty}` : 'Challenge unavailable'}
                            </span>
                          </span>
                          <span className="mt-auto flex flex-wrap gap-2">
                            <Badge variant="outline">{isOwner ? 'Owner' : 'Collaborator'}</Badge>
                            {room.data.completedAt && <Badge variant="secondary">Complete</Badge>}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          <section id="interview-history" tabIndex={-1} aria-labelledby="activity-heading" className="min-w-0 scroll-mt-4">
            <div className="mb-3 flex items-center gap-2">
              <Clock3 className="size-4 text-primary" aria-hidden="true" />
              <div>
                <h2 id="activity-heading" className="text-lg font-semibold tracking-tight">Interview history</h2>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {historyStatus === 'loading' && <p role="status" className="p-5 text-sm text-muted-foreground">Loading interview history…</p>}
              {historyStatus === 'error' && <p role="alert" className="p-5 text-sm text-destructive">Could not load interview history.</p>}
              {historyStatus === 'ready' && completedRooms.length === 0 && (
                <EmptyState className="min-h-[190px] px-6 py-10" icon={<Clock3 aria-hidden="true" />} title="No completed sessions yet" description="When a room owner marks a practice session complete, it will appear here for current participants." />
              )}
              {historyStatus === 'ready' && completedRooms.length > 0 && (
                <ul className="divide-y divide-border">
                  {completedRooms.map(({ recordId, data }) => {
                    const roomUrl = `/rooms/${encodeURIComponent(recordId)}`
                    const reviewed = reviewedRoomIds.has(recordId)
                    return (
                      <li key={recordId} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 p-5 sm:px-6">
                        <div className="min-w-0">
                          <Link className="break-words font-medium hover:text-primary hover:underline" to={roomUrl}>{data.name}</Link>
                          <p className="mt-1 text-sm text-muted-foreground">
                            <time dateTime={data.completedAt}>{new Date(data.completedAt).toLocaleDateString()}</time>
                          </p>
                        </div>
                        {reviewsStatus === 'ready' && (
                          <Link to={`${roomUrl}#reviews`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                            {reviewed ? 'View reviews' : 'Write a review'} <ArrowRight className="size-3.5" aria-hidden="true" />
                          </Link>
                        )}
                        {reviewsStatus === 'loading' && <span className="text-sm text-muted-foreground">Loading review status…</span>}
                        {reviewsStatus === 'error' && <span className="text-sm text-muted-foreground">Review status unavailable</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      {createDialogLoaded && (
        <Suspense
          fallback={(
            <div
              role="status"
              aria-live="polite"
              className="fixed bottom-4 right-4 z-50 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-md"
            >
              Opening the room form…
            </div>
          )}
        >
          <CreateRoomDialog
            open={createOpen}
            finalFocus={createRoomButtonRef}
            onClose={() => setCreateOpen(false)}
            onCreated={(recordId) => {
              setCreateOpen(false)
              navigate(`/rooms/${encodeURIComponent(recordId)}`)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
