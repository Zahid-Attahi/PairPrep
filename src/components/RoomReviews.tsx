import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { useLocation } from 'react-router-dom'
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
  { name: 'feedback', label: 'Overall summary' },
  { name: 'strengths', label: 'Strengths' },
  { name: 'improvements', label: 'Areas for improvement' },
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
    <section ref={section} id="reviews" tabIndex={-1} aria-labelledby="reviews-heading" className="mt-6 scroll-mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 id="reviews-heading" className="text-lg font-semibold">Performance reviews</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {completedAt
          ? <>Completed <time dateTime={completedAt}>{new Date(completedAt).toLocaleDateString()}</time>. Your self-reviews are private.</>
          : 'The room owner can mark the session complete when practice is finished.'}
      </p>
      {!completedAt && isOwner && <Button className="mt-4" variant="outline" loading={pending} onClick={() => void complete()}>Mark session complete</Button>}

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
        <form onSubmit={(event) => void save(event)} className="mt-5 space-y-3 border-t border-border pt-4">
          <fieldset disabled={pending} className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">Write a self-review</legend>
            {fields.map(({ name, label }) => (
              <label key={name} className="block text-sm font-medium">
                {label}
                <Textarea name={name} required maxLength={2000} className="mt-1 min-h-20" />
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
