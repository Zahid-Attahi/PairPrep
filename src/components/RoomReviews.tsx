import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { useLocation } from 'react-router-dom'
import { ClipboardCheck, LockKeyhole } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { callServerAction } from '@/lib/server-actions'

export interface InterviewReview {
  candidateId: string
  roomId: string
  feedback: string
  strengths?: string
  improvements?: string
  score?: number
}

const fields = [
  { name: 'feedback', label: 'Overall summary', placeholder: 'How did you approach the challenge?' },
  { name: 'strengths', label: 'Strengths', placeholder: 'What worked well?' },
  { name: 'improvements', label: 'Areas for improvement', placeholder: 'What will you practice next?' },
] as const

export function RoomReviews({ roomId, completedAt, isOwner }: {
  roomId: string
  completedAt?: string
  isOwner: boolean
}) {
  const { userId } = useAuth()
  const { hash } = useLocation()
  const section = useRef<HTMLElement>(null)
  const { records, status } = useQuery<InterviewReview>('interviewReviews', {
    where: { roomId, candidateId: userId ?? '' },
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (hash === '#reviews') section.current?.scrollIntoView()
  }, [hash])

  async function complete() {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await callServerAction('rooms.complete', { roomId })
      setMessage('Session marked complete.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete the session.')
    } finally {
      setPending(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    setError('')
    setMessage('')
    try {
      await callServerAction('rooms.reviews.create', {
        roomId,
        feedback: data.get('feedback'),
        strengths: data.get('strengths'),
        improvements: data.get('improvements'),
      })
      form.reset()
      setMessage('Review saved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the review.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section ref={section} id="reviews" tabIndex={-1} aria-labelledby="reviews-heading" className="scroll-mt-4 rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="reviews-heading" className="flex items-center gap-2 text-lg font-semibold"><ClipboardCheck className="size-4 text-primary" aria-hidden="true" /> Performance reviews</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {completedAt
              ? <>Completed <time dateTime={completedAt}>{new Date(completedAt).toLocaleDateString()}</time>.</>
              : 'Complete the session to start a self-review.'}
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 text-muted-foreground"><LockKeyhole className="size-3" aria-hidden="true" /> Private to you</Badge>
      </div>
      {!completedAt && isOwner && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/50 p-3.5">
          <p className="text-sm text-muted-foreground">Finished practicing? Add this session to interview history.</p>
          <Button loading={pending} onClick={() => void complete()}>Mark session complete</Button>
        </div>
      )}

      {status === 'loading' && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading reviews…</p>}
      {status === 'error' && <p role="alert" className="mt-4 text-sm text-destructive">Could not load your reviews.</p>}
      {status === 'ready' && completedAt && records.length === 0 && <p className="mt-4 text-sm text-muted-foreground">You haven’t written a review for this session yet.</p>}
      {records.length > 0 && (
        <ul className="mt-4 space-y-3">
          {records.map(({ recordId, createdAt, data }) => (
            <li key={recordId} className="rounded-xl border border-border bg-background/50 p-4">
              <h3 className="text-sm font-semibold">Self-review · <time dateTime={createdAt}>{new Date(createdAt).toLocaleString()}</time></h3>
              {typeof data.score === 'number' && <p className="mt-2 text-sm">Score {data.score}</p>}
              <dl className="mt-3 space-y-3 text-sm">
                {fields.map(({ name, label }) => data[name] && (
                  <div key={name}>
                    <dt className="font-medium">{label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{data[name]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}

      {completedAt && (
        <form onSubmit={(event) => void save(event)} className="mt-5 rounded-xl border border-border bg-background/40 p-4">
          <fieldset disabled={pending} className="space-y-3">
            <legend className="mb-3 text-sm font-semibold">Write a self-review</legend>
            {fields.map(({ name, label, placeholder }) => (
              <label key={name} className="block text-sm font-medium">
                {label}
                <Textarea name={name} placeholder={placeholder} required maxLength={2000} className="mt-1.5 min-h-20 resize-y bg-background" />
              </label>
            ))}
            <Button type="submit" loading={pending}>Save review</Button>
          </fieldset>
        </form>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="mt-3 text-sm text-primary">{message}</p>}
    </section>
  )
}
