import type { DocumentAttachment } from '@/lib/documents'
// ISO timestamps come from the server; sent_at is absent in older local caches.
export type Message = {
  request_id: string | null
  user_message: string
  ai_message: string
  sent_at?: string | null
  created_at: string
  image_ids?: string[]
  documents?: { id: string; name: string }[]
}

export type Session = { sessionId: string; configured: boolean }
export type Pending = {
  requestId: string
  message: string
  model?: string
  images?: string[]
  documents?: DocumentAttachment[]
}
export type PendingMessage = {
  text: string
  sentAt: string
  images?: string[]
  documents?: DocumentAttachment[]
}
export type Model = {
  id: string
  name: string
  supportsImages?: boolean
  supportsDocuments?: boolean
}
