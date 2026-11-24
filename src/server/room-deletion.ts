export const deleteRoomPath = '/internal/delete-interview-room'
export const createRoomChildPath = '/internal/create-interview-room-child'

export function roomChildScope(collection: unknown, data: unknown) {
  const fields = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  if (collection === 'team_members') return { teamId: fields.teamId }
  if (collection === 'aiCoachMessages' || collection === 'interviewReviews') return { recordId: fields.roomId }
  return null
}

// DeepSpace 0.44.2 stores collections in typed SQLite tables and record-bound
// Yjs fields in yjs_docs. Its record deletion leaves the Yjs rows behind.
// Keep the cascade in one storage transaction, using the SDK's table layout.
export function deleteRoomData(storage: DurableObjectStorage, roomId: string, teamId: string) {
  storage.transactionSync(() => {
    const { sql } = storage
    sql.exec('DELETE FROM c_team_members WHERE col_teamid = ?', teamId)
    sql.exec('DELETE FROM c_aiCoachMessages WHERE col_roomid = ?', roomId)
    sql.exec('DELETE FROM c_interviewReviews WHERE col_roomid = ?', roomId)
    const docPrefix = `interviewRooms:${roomId}:`
    sql.exec('DELETE FROM yjs_docs WHERE substr(doc_key, 1, length(?)) = ?', docPrefix, docPrefix)
    sql.exec('DELETE FROM c_interviewRooms WHERE _row_id = ?', roomId)
  })
}
