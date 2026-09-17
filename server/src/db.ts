import pg from 'pg'
import { HttpError } from './errors.js'
import type { Prompt } from './gateway.js'
import type { PreparedDocument } from './documents.js'
import { imagePrompt, documentPrompt } from './gateway.js'
import type { PreparedImage } from './images.js'
import { randomUUID } from 'node:crypto'

export type Message = {
  request_id: string | null
  user_message: string
  ai_message: string
  sent_at: Date | null
  created_at: Date
  image_ids: string[]
  image_hashes: string[]
  documents: { id: string; name: string }[]
  document_hashes: string[]
}
// Legacy created_at is a UTC timestamp without zone; make that explicit in the API.
const columns =
  "request_id, user_message, ai_message, sent_at, image_ids, image_hashes, documents, document_hashes, created_at AT TIME ZONE 'UTC' AS created_at"

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
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_ids uuid[] NOT NULL DEFAULT '{}';
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_hashes text[] NOT NULL DEFAULT '{}';
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]';
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS document_hashes text[] NOT NULL DEFAULT '{}';
        CREATE TABLE IF NOT EXISTS message_documents (id uuid PRIMARY KEY, session_id uuid NOT NULL, name text NOT NULL, data bytea NOT NULL, text_content text);
        CREATE TABLE IF NOT EXISTS message_images (id uuid PRIMARY KEY, session_id uuid NOT NULL, data bytea NOT NULL);
        CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages(session_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS messages_request_idx ON messages(session_id, request_id) WHERE request_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS request_limits (name text PRIMARY KEY, started_at timestamptz NOT NULL, count integer NOT NULL);
      `)
    },
    async health() {
      await pool.query('SELECT 1')
    },
    async image(sessionId: string, id: string): Promise<Buffer | null> {
      const { rows } = await pool.query(
        'SELECT data FROM message_images WHERE session_id=$1 AND id=$2',
        [sessionId, id],
      )
      return rows[0]?.data ?? null
    },
    async document(sessionId: string, id: string) {
      const { rows } = await pool.query<{ name: string; data: Buffer }>(
        'SELECT name, data FROM message_documents WHERE session_id=$1 AND id=$2',
        [sessionId, id],
      )
      return rows[0] ?? null
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
      images: PreparedImage[] = [],
      supportsImages = false,
      documents: PreparedDocument[] = [],
      supportsDocuments = false,
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
          if (
            existing.rows[0].user_message !== text ||
            JSON.stringify(existing.rows[0].image_hashes) !==
              JSON.stringify(images.map((image) => image.hash)) ||
            JSON.stringify(existing.rows[0].document_hashes) !==
              JSON.stringify(documents.map((d) => d.hash))
          )
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
        const rows = previous.rows.reverse()
        const context: Prompt[] = rows.flatMap((row) => [
          { role: 'user' as const, content: row.user_message },
          { role: 'assistant' as const, content: row.ai_message },
        ])
        while (
          context.reduce((sum, message) => sum + message.content.length, text.length) > 24000
        ) {
          context.splice(0, 2)
          rows.shift()
        }
        // Include at most three images in context, newest first. Text-only models receive text history.
        let remaining = supportsImages ? 3 - images.length : 0
        for (let i = rows.length - 1; i >= 0 && remaining > 0; i--) {
          const ids = rows[i]!.image_ids.slice(-remaining)
          if (!ids.length) continue
          const stored = await client.query<{ id: string; data: Buffer }>(
            'SELECT id, data FROM message_images WHERE session_id=$1 AND id=ANY($2::uuid[])',
            [sessionId, ids],
          )
          const buffers = ids.flatMap((id) =>
            stored.rows.filter((row) => row.id === id).map((row) => row.data),
          )
          context[i * 2] = imagePrompt(rows[i]!.user_message, buffers)
          remaining -= buffers.length
        }
        let documentSlots = 3 - documents.length
        for (let i = rows.length - 1; i >= 0 && documentSlots > 0; i--) {
          const ids = rows[i]!.documents.slice(-documentSlots).map((d) => d.id)
          if (!ids.length) continue
          const stored = await client.query<{
            id: string
            name: string
            data: Buffer
            text_content: string | null
          }>(
            'SELECT id, name, data, text_content FROM message_documents WHERE session_id=$1 AND id=ANY($2::uuid[])',
            [sessionId, ids],
          )
          const attached = ids.flatMap((id) =>
            stored.rows
              .filter((d) => d.id === id && (supportsDocuments || d.text_content !== null))
              .map((d) => ({
                name: d.name,
                data: d.data,
                text: d.text_content ?? undefined,
                hash: '',
              })),
          )
          context[i * 2] = documentPrompt(context[i * 2]!, attached)
          documentSlots -= attached.length
        }
        const answer = await generate([
          ...context,
          documentPrompt(
            imagePrompt(
              text,
              images.map((image) => image.data),
            ),
            documents,
          ),
        ])
        const imageIds: string[] = []
        for (const image of images) {
          const id = randomUUID()
          await client.query('INSERT INTO message_images(id,session_id,data) VALUES($1,$2,$3)', [
            id,
            sessionId,
            image.data,
          ])
          imageIds.push(id)
        }
        const documentMetadata: { id: string; name: string }[] = []
        for (const document of documents) {
          const id = randomUUID()
          await client.query(
            'INSERT INTO message_documents(id,session_id,name,data,text_content) VALUES($1,$2,$3,$4,$5)',
            [id, sessionId, document.name, document.data, document.text ?? null],
          )
          documentMetadata.push({ id, name: document.name })
        }
        // Use the same server clock for both timestamps: the Docker host may have a different clock.
        const result = await client.query<Message>(
          `INSERT INTO messages(session_id, request_id, user_message, ai_message, sent_at, created_at, image_ids, image_hashes, documents, document_hashes)
           VALUES($1,$2,$3,$4,$5,timezone('UTC', $6::timestamptz),$7,$8,$9,$10) RETURNING ${columns}`,
          [
            sessionId,
            requestId,
            text,
            answer,
            sentAt,
            new Date(),
            imageIds,
            images.map((image) => image.hash),
            JSON.stringify(documentMetadata),
            documents.map((d) => d.hash),
          ],
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
