import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { deleteRoomData } from './room-deletion'

function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE c_interviewRooms (_row_id TEXT);
    CREATE TABLE c_team_members (col_teamid TEXT);
    CREATE TABLE c_aiCoachMessages (col_roomid TEXT);
    CREATE TABLE c_interviewReviews (col_roomid TEXT);
    CREATE TABLE yjs_docs (doc_key TEXT);

    INSERT INTO c_interviewRooms VALUES ('room'), ('room-next');
    INSERT INTO c_team_members VALUES ('team'), ('team'), ('team-next');
    INSERT INTO c_aiCoachMessages VALUES ('room'), ('room'), ('room-next');
    INSERT INTO c_interviewReviews VALUES ('room'), ('room-next');
    INSERT INTO yjs_docs VALUES ('interviewRooms:room:notes'), ('interviewRooms:room:code'),
      ('interviewRooms:room-next:code'), ('documents:room:code');
  `)
  const storage = {
    sql: {
      exec: (query: string, ...params: (number | string)[]) => db.prepare(query).run(...params),
    },
    transactionSync: (run: () => void) => {
      db.exec('BEGIN')
      try {
        run()
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as DurableObjectStorage
  return { db, storage }
}

describe('room data cascade', () => {
  it('removes room-scoped records and Yjs documents while preserving other data', () => {
    const { db, storage } = setup()
    try {
      deleteRoomData(storage, 'room', 'team')

      expect(db.prepare('SELECT * FROM c_interviewRooms').all()).toEqual([{ _row_id: 'room-next' }])
      expect(db.prepare('SELECT * FROM c_team_members').all()).toEqual([{ col_teamid: 'team-next' }])
      for (const table of ['c_aiCoachMessages', 'c_interviewReviews']) {
        expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([{ col_roomid: 'room-next' }])
      }
      expect(db.prepare('SELECT * FROM yjs_docs ORDER BY doc_key').all()).toEqual([
        { doc_key: 'documents:room:code' },
        { doc_key: 'interviewRooms:room-next:code' },
      ])
    } finally {
      db.close()
    }
  })

  it('rolls back the cascade if a cleanup step fails', () => {
    const { db, storage } = setup()
    try {
      db.exec(`
        CREATE TRIGGER refuse_room_delete BEFORE DELETE ON c_interviewRooms
        BEGIN SELECT RAISE(ABORT, 'Deletion failed'); END
      `)
      expect(() => deleteRoomData(storage, 'room', 'team')).toThrow('Deletion failed')
      const counts = db.prepare(`
        SELECT (SELECT count(*) FROM c_interviewRooms) AS rooms,
               (SELECT count(*) FROM c_team_members) AS members,
               (SELECT count(*) FROM c_aiCoachMessages) AS messages,
               (SELECT count(*) FROM c_interviewReviews) AS reviews,
               (SELECT count(*) FROM yjs_docs) AS docs
      `).get()
      expect(counts).toEqual({ rooms: 2, members: 3, messages: 3, reviews: 2, docs: 4 })
    } finally {
      db.close()
    }
  })
})
