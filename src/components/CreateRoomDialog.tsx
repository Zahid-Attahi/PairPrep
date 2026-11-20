import { useState, type FormEvent, type RefObject } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { codingChallenges } from '@/challenges'
import { callServerAction } from '@/lib/server-actions'

interface CreateRoomDialogProps {
  open: boolean
  finalFocus: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onCreated: (recordId: string) => void
}

export default function CreateRoomDialog({ open, finalFocus, onClose, onCreated }: CreateRoomDialogProps) {
  const [roomName, setRoomName] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = roomName.trim()
    if (!name) return setCreateError('Enter a room name.')
    if (!challengeId) return setCreateError('Choose a coding challenge.')

    setCreating(true)
    setCreateError('')
    try {
      const result = await callServerAction<{ recordId: string }>('rooms.create', { name, challengeId })
      onCreated(result.recordId)
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Could not create the room.')
    } finally {
      setCreating(false)
    }
  }

  function closeCreate() {
    if (creating) return
    onClose()
    setCreateError('')
  }

  return (
    <Modal open={open} finalFocus={finalFocus} onClose={closeCreate}>
      <Modal.Header>
        <Modal.Title>Create an interview room</Modal.Title>
        <Modal.Description>Choose a challenge to start a focused practice session.</Modal.Description>
      </Modal.Header>
      <form onSubmit={createRoom}>
        <Modal.Body className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="room-name" className="text-sm font-medium">Room name</label>
            <Input id="room-name" autoFocus maxLength={80} value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="e.g. Tuesday practice" required />
          </div>
          <div className="space-y-2">
            <label id="challenge-label" className="text-sm font-medium">Coding challenge</label>
            <Select value={challengeId} onValueChange={setChallengeId}>
              <SelectTrigger aria-labelledby="challenge-label"><SelectValue placeholder="Choose a challenge" /></SelectTrigger>
              <SelectContent>
                {codingChallenges.map((challenge) => (
                  <SelectItem key={challenge.id} value={challenge.id}>{challenge.title} · {challenge.difficulty}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={closeCreate} disabled={creating}>Cancel</Button>
          <Button type="submit" loading={creating}>Create room</Button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}
