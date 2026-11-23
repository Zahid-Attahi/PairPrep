/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { reserveCodeRunSlot } from './code-run-limits'

it('enforces the per-user and app quotas atomically and rotates the minute window', () => {
  const db = new DatabaseSync(':memory:')
  const storage = {
    sql: {
      exec(query: string, ...values: Array<string | number>) {
        const rows = db.prepare(query).all(...values)
        return { toArray: () => rows }
      },
    },
    transactionSync<T>(callback: () => T) {
      db.exec('BEGIN')
      try {
        const result = callback()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as Parameters<typeof reserveCodeRunSlot>[0]
  try {
    const now = 60_000
    for (let user = 0; user < 6; user += 1) {
      for (let run = 0; run < 5; run += 1) {
        expect(reserveCodeRunSlot(storage, `user-${user}`, now)).toBe(true)
      }
      expect(reserveCodeRunSlot(storage, `user-${user}`, now)).toBe(false)
    }
    expect(reserveCodeRunSlot(storage, 'another-user', now)).toBe(false)
    expect(db.prepare("SELECT hits FROM pairprep_code_run_limits WHERE subject = 'user:another-user'").get()).toBeUndefined()
    expect(reserveCodeRunSlot(storage, 'user-0', now + 60_000)).toBe(true)
    expect(db.prepare('SELECT count(*) AS count FROM pairprep_code_run_limits WHERE minute = 1').get()).toMatchObject({ count: 0 })
  } finally {
    db.close()
  }
})
