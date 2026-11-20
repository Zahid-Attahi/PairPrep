import { lazy, Suspense, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  Clock3,
  Code2,
  MessageCircleMore,
  Plus,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { getChallenge } from '@/challenges'

const CreateRoomDialog = lazy(() => import('@/components/CreateRoomDialog'))

interface InterviewRoom {
  name: string
  ownerId: string
  teamId: string
  challengeId: string
}

const practiceSteps = [
  { number: '01', title: 'Choose a challenge', description: 'Start with a focused problem matched to your goals.', icon: Code2 },
  { number: '02', title: 'Think out loud', description: 'Practice explaining your approach as you work.', icon: MessageCircleMore },
  { number: '03', title: 'Learn from the session', description: 'Keep useful feedback close to your next practice.', icon: BookOpenCheck },
]

export default function HomePage() {
  const { userId } = useAuth()
  const { records: rooms, status, error } = useQuery<InterviewRoom>('interviewRooms', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <span className="flex size-7 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                <Code2 className="size-4" aria-hidden="true" />
              </span>
              PairPrep <span className="text-border">/</span> Workspace
            </div>
            <p className="mb-2 text-sm font-medium text-primary">Practice with purpose</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your practice workspace.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              A focused place to work through interview challenges, share your thinking, and build confidence one session at a time.
            </p>
          </div>

          <Button ref={createRoomButtonRef} size="lg" onClick={openCreate}>
            <Plus aria-hidden="true" /> Create room
          </Button>
        </header>

        <main className="grid gap-6 py-7 xl:grid-cols-[minmax(0,1.65fr)_minmax(290px,0.85fr)]">
          <section aria-labelledby="rooms-heading" className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <UsersRound className="size-4 text-primary" aria-hidden="true" />
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Practice together</p>
                </div>
                <h2 id="rooms-heading" className="text-lg font-semibold tracking-tight">Interview rooms</h2>
                <p className="mt-1 text-sm text-muted-foreground">Your collaborative sessions, all in one place.</p>
              </div>
              {status === 'ready' && rooms.length > 0 && <Badge variant="outline">{rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}</Badge>}
            </div>

            <div className="border-t border-border bg-background/40">
              {status === 'loading' && (
                <div role="status" className="flex min-h-[230px] items-center justify-center text-sm text-muted-foreground">
                  Loading your rooms…
                </div>
              )}
              {status === 'error' && (
                <EmptyState
                  className="min-h-[230px] px-6 py-10"
                  icon={<UsersRound className="text-destructive" aria-hidden="true" />}
                  title="Rooms could not be loaded"
                  description={error || 'Check your connection and refresh the page to try again.'}
                />
              )}
              {status === 'ready' && rooms.length === 0 && (
                <EmptyState
                  className="min-h-[270px] px-6 py-12"
                  icon={<UsersRound className="text-primary" aria-hidden="true" />}
                  title="Your rooms will show up here"
                  description="Create a room to choose a challenge and invite someone to practice with you. Your sessions will be easy to find whenever you come back."
                  action={{ label: 'Create your first room', onClick: openCreate }}
                />
              )}
              {status === 'ready' && rooms.length > 0 && (
                <ul className="divide-y divide-border">
                  {rooms.map((room) => {
                    const challenge = getChallenge(room.data.challengeId)
                    const isOwner = room.data.ownerId === userId
                    return (
                      <li key={room.recordId}>
                        <Link
                          to={`/rooms/${encodeURIComponent(room.recordId)}`}
                          className="group flex flex-col gap-3 p-5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:px-6"
                        >
                          <span className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <Code2 className="size-4" aria-hidden="true" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium group-hover:text-primary">{room.data.name}</span>
                              <span className="mt-1 block text-sm text-muted-foreground">
                                {challenge ? `${challenge.title} · ${challenge.difficulty}` : 'Challenge unavailable'}
                              </span>
                            </span>
                          </span>
                          <span className="flex items-center justify-between gap-3 pl-12 sm:pl-0">
                            <Badge variant={isOwner ? 'secondary' : 'outline'}>{isOwner ? 'Owner' : 'Collaborator'}</Badge>
                            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          <aside aria-labelledby="practice-loop-heading" className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
            <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Sparkles className="size-5" aria-hidden="true" />
                </div>
                <Badge variant="secondary">The PairPrep loop</Badge>
              </div>
              <h2 id="practice-loop-heading" className="text-xl font-semibold tracking-tight">Small reps. Real progress.</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Make each practice session count by following a simple, repeatable rhythm.</p>
              <ol className="mt-6 space-y-5">
                {practiceSteps.map(({ number, title, description, icon: Icon }, index) => (
                  <li key={number} className="flex gap-3">
                    <div className="relative flex shrink-0 flex-col items-center">
                      <span className="flex size-8 items-center justify-center rounded-full border border-border bg-background text-primary"><Icon className="size-4" aria-hidden="true" /></span>
                      {index < practiceSteps.length - 1 && <span aria-hidden="true" className="absolute top-9 h-5 w-px bg-border" />}
                    </div>
                    <div className="min-w-0 pb-1">
                      <p className="text-sm font-medium"><span className="mr-2 font-mono text-xs text-muted-foreground">{number}</span>{title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-6 flex items-center gap-2 border-t border-border/80 pt-4 text-xs text-muted-foreground">
                <Check className="size-3.5 text-primary" aria-hidden="true" /> Built around how strong interviews feel
                <ArrowRight className="ml-auto size-3.5" aria-hidden="true" />
              </div>
            </div>
          </aside>

          <section aria-labelledby="activity-heading" className="overflow-hidden rounded-2xl border border-border bg-card xl:col-span-2">
            <div className="flex items-center gap-2 p-5 sm:p-6">
              <Clock3 className="size-4 text-primary" aria-hidden="true" />
              <div>
                <h2 id="activity-heading" className="text-lg font-semibold tracking-tight">Recent activity</h2>
                <p className="mt-1 text-sm text-muted-foreground">Pick up where you left off.</p>
              </div>
            </div>
            <div className="border-t border-border bg-background/40">
              <EmptyState className="min-h-[190px] px-6 py-10" icon={<Clock3 aria-hidden="true" />} title="No sessions yet" description="Completed practice sessions and feedback will appear here." />
            </div>
          </section>
        </main>
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
