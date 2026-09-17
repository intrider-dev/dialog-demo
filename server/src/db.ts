import pg from 'pg'
import { HttpError } from './errors.js'
import type { Prompt } from './gateway.js'

export type Message = {
  request_id: string | null
  user_message: string
  ai_message: string
  sent_at: Date | null
  created_at: Date
}
// Legacy created_at is a UTC timestamp without zone; make that explicit in the API.
const columns =
  "request_id, user_message, ai_message, sent_at, created_at AT TIME ZONE 'UTC' AS created_at"

export function createStore(databaseUrl: string) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  })
  pool.on('error', () => console.error('Database connection interrupted'))
  return {
    pool,
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (session_id uuid, user_message text, ai_message text, created_at timestamp);
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS request_id uuid;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_at timestamptz;
        CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages(session_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS messages_request_idx ON messages(session_id, request_id) WHERE request_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS request_limits (name text PRIMARY KEY, started_at timestamptz NOT NULL, count integer NOT NULL);
      `)
    },
    async health() {
      await pool.query('SELECT 1')
    },
    async history(sessionId: string) {
      const { rows } = await pool.query<Message>(
        `SELECT ${columns} FROM messages WHERE session_id=$1 AND user_message IS NOT NULL AND ai_message IS NOT NULL AND created_at IS NOT NULL
         ORDER BY created_at DESC, request_id DESC NULLS LAST LIMIT 200`,
        [sessionId],
      )
      return rows.reverse()
    },
    async reply(
      sessionId: string,
      requestId: string,
      text: string,
      generate: (context: Prompt[]) => Promise<string>,
      dailyLimit: number,
    ) {
      // Capture receipt before waiting for a connection or a provider response.
      const sentAt = new Date()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // PostgreSQL releases this session lock on COMMIT/ROLLBACK, including failures.
        const lock = await client.query(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
          [sessionId],
        )
        if (!lock.rows[0].acquired)
          throw new HttpError(409, 'Дождитесь ответа на предыдущее сообщение.', 'REQUEST_BUSY')
        const existing = await client.query<Message>(
          `SELECT ${columns} FROM messages WHERE session_id=$1 AND request_id=$2`,
          [sessionId, requestId],
        )
        if (existing.rows[0]) {
          if (existing.rows[0].user_message !== text)
            throw new HttpError(409, 'Этот запрос уже использован.', 'REQUEST_CONFLICT')
          await client.query('COMMIT')
          return existing.rows[0]
        }
        // A separate committed query counts failed provider attempts too; restarting does not reset the daily budget.
        const budget = await pool.query(
          `
          INSERT INTO request_limits (name, started_at, count) VALUES ('global', now(), 1)
          ON CONFLICT (name) DO UPDATE SET
            count = CASE WHEN request_limits.started_at < now() - interval '1 day' THEN 1 ELSE request_limits.count + 1 END,
            started_at = CASE WHEN request_limits.started_at < now() - interval '1 day' THEN now() ELSE request_limits.started_at END
          WHERE request_limits.count < $1 OR request_limits.started_at < now() - interval '1 day'
          RETURNING count`,
          [dailyLimit],
        )
        if (!budget.rowCount)
          throw new HttpError(429, 'Лимит запросов на сегодня исчерпан.', 'DAILY_LIMIT')
        const previous = await client.query<Message>(
          `SELECT ${columns} FROM messages WHERE session_id=$1 AND user_message IS NOT NULL AND ai_message IS NOT NULL AND created_at IS NOT NULL
           ORDER BY created_at DESC, request_id DESC NULLS LAST LIMIT 20`,
          [sessionId],
        )
        const context: Prompt[] = previous.rows.reverse().flatMap((row) => [
          { role: 'user' as const, content: row.user_message },
          { role: 'assistant' as const, content: row.ai_message },
        ])
        while (context.reduce((sum, message) => sum + message.content.length, text.length) > 24000)
          context.splice(0, 2)
        const answer = await generate([...context, { role: 'user', content: text }])
        // Use the same server clock for both timestamps: the Docker host may have a different clock.
        const result = await client.query<Message>(
          `INSERT INTO messages(session_id, request_id, user_message, ai_message, sent_at, created_at)
           VALUES($1,$2,$3,$4,$5,timezone('UTC', $6::timestamptz)) RETURNING ${columns}`,
          [sessionId, requestId, text, answer, sentAt, new Date()],
        )
        await client.query('COMMIT')
        return result.rows[0]!
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
}
export type Store = ReturnType<typeof createStore>
