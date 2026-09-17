// ISO timestamps come from the server; sent_at is absent in older local caches.
export type Message = {
  request_id: string | null
  user_message: string
  ai_message: string
  sent_at?: string | null
  created_at: string
}

export type Session = { sessionId: string; configured: boolean }
export type Pending = { requestId: string; message: string; model?: string }
export type PendingMessage = { text: string; sentAt: string }
