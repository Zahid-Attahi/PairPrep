const windowMs = 60_000
const userLimit = 5
const appLimit = 30

function takeSlot(sql: SqlStorage, window: number, subject: string, limit: number): boolean {
  return sql.exec(
    `INSERT INTO pairprep_code_run_limits (minute, subject, hits) VALUES (?, ?, 1)
     ON CONFLICT (minute, subject) DO UPDATE SET hits = hits + 1
     WHERE hits < ?
     RETURNING hits`,
    window, subject, limit,
  ).toArray().length > 0
}

class LimitReached extends Error {}

export function reserveCodeRunSlot(
  storage: Pick<DurableObjectStorage, 'sql' | 'transactionSync'>,
  userId: string,
  now = Date.now(),
): boolean {
  const sql = storage.sql
  const minute = Math.floor(now / windowMs)
  sql.exec(`CREATE TABLE IF NOT EXISTS pairprep_code_run_limits (
    minute INTEGER NOT NULL, subject TEXT NOT NULL, hits INTEGER NOT NULL,
    PRIMARY KEY (minute, subject)
  )`)

  try {
    return storage.transactionSync(() => {
      sql.exec('DELETE FROM pairprep_code_run_limits WHERE minute < ?', minute)
      if (!takeSlot(sql, minute, `user:${userId}`, userLimit) ||
          !takeSlot(sql, minute, 'app', appLimit)) throw new LimitReached()
      return true
    })
  } catch (error) {
    if (error instanceof LimitReached) return false
    throw error
  }
}
