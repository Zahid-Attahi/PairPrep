import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutations } from 'deepspace'

type ProtectedField = 'ownerId' | 'teamId'

function MutationProbe() {
  const [searchParams] = useSearchParams()
  const roomId = searchParams.get('roomId') ?? ''
  const { ready, putConfirmed } = useMutations('interviewRooms')
  const [results, setResults] = useState<Partial<Record<ProtectedField, string>>>({})

  async function attemptUpdate(field: ProtectedField) {
    const replacement = `__test-protected-${field}__`
    try {
      await putConfirmed(roomId, { [field]: replacement })
      setResults((current) => ({ ...current, [field]: 'Update unexpectedly succeeded.' }))
    } catch (error) {
      setResults((current) => ({
        ...current,
        [field]: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Development room mutation probe</h1>
      <p data-testid="mutation-probe-ready" role="status">
        {ready && roomId ? 'Ready' : 'Waiting for the room connection…'}
      </p>
      <button
        type="button"
        disabled={!ready || !roomId || Boolean(results.ownerId)}
        onClick={() => void attemptUpdate('ownerId')}
      >
        Attempt ownerId update
      </button>
      {results.ownerId && <p data-testid="ownerId-update-result" role="status">{results.ownerId}</p>}
      <button
        type="button"
        disabled={!ready || !roomId || Boolean(results.teamId)}
        onClick={() => void attemptUpdate('teamId')}
      >
        Attempt teamId update
      </button>
      {results.teamId && <p data-testid="teamId-update-result" role="status">{results.teamId}</p>}
    </main>
  )
}

export default MutationProbe
