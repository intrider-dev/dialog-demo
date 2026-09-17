import type { DocumentAttachment } from '@/lib/documents'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  api,
  cached,
  getSession,
  isMessage,
  pendingRequest,
  save,
  savePending,
} from '@/lib/chat'
import type { Message, Session, Pending, PendingMessage } from '@/types/chat'

export function useChat() {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [documents, setDocuments] = useState<DocumentAttachment[]>([])
  const [images, setImages] = useState<string[]>([])
  const [pending, setPending] = useState<PendingMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [animateId, setAnimateId] = useState<string | null>(null)
  // A ref closes the gap before React renders a disabled submit button.
  const lock = useRef(false)
  // Ignore history responses that arrive after a newer load or a session change.
  const version = useRef(0)
  // Keep retries working even when the browser refuses localStorage writes.
  const retry = useRef<{ sessionId: string; request: Pending } | null>(null)
  const loadedSession = useRef<string | null>(null)
  const hydratedSession = useRef<string | null>(null)

  const load = useCallback(async (background = false) => {
    if (lock.current) return
    const currentVersion = ++version.current
    // Returning from the OS file picker fires focus before its change event.
    // A same-session background refresh must keep the composer available.
    if (!background) setReady(false)
    setError('')
    try {
      const current = await getSession()
      if (currentVersion !== version.current) return
      if (loadedSession.current && loadedSession.current !== current.sessionId) {
        setReady(false)
        setDraft('')
        setImages([])
        setDocuments([])
      }
      loadedSession.current = current.sessionId
      setSession(current)
      setMessages(cached(current.sessionId))
      const data = await api<{ sessionId: string; messages: Message[] }>(
        'messages',
        undefined,
        current.sessionId,
      )
      if (currentVersion !== version.current) return
      if (
        data.sessionId !== current.sessionId ||
        !Array.isArray(data.messages) ||
        !data.messages.every(isMessage)
      )
        throw new Error('Не удалось прочитать историю.')
      setMessages(data.messages)
      save(current.sessionId, data.messages)
      const unfinished = pendingRequest(current.sessionId)
      const restoreDraft = hydratedSession.current !== current.sessionId
      hydratedSession.current = current.sessionId
      // Hydrate once per session; focus refreshes must not undo local edits after a failed send.
      if (restoreDraft)
        retry.current = unfinished ? { sessionId: current.sessionId, request: unfinished } : null
      if (
        unfinished &&
        data.messages.some((message) => message.request_id === unfinished.requestId)
      ) {
        savePending(current.sessionId, null)
        retry.current = null
        if (restoreDraft) {
          setDraft('')
          setImages([])
          setDocuments([])
        }
      } else if (unfinished && restoreDraft) {
        setDraft(unfinished.message)
        setImages(unfinished.images ?? [])
        setDocuments(unfinished.documents ?? [])
      }
      setReady(true)
    } catch (e) {
      if (currentVersion === version.current)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить историю.')
    }
  }, [])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void load()
    })
    const refresh = () => {
      void load(true)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'chat-session-changed') refresh()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      active = false
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- This is a request generation counter, not a DOM ref.
      version.current++
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [load])

  async function send(model?: string) {
    if (
      !session?.configured ||
      !ready ||
      lock.current ||
      (!draft.trim() && !images.length && !documents.length) ||
      draft.length > 4000
    )
      return
    lock.current = true
    version.current++
    const text = draft.trim()
    const previous =
      retry.current?.sessionId === session.sessionId
        ? retry.current.request
        : pendingRequest(session.sessionId)
    const request =
      previous?.message === text &&
      previous.model === model &&
      JSON.stringify(previous.images ?? []) === JSON.stringify(images) &&
      JSON.stringify(previous.documents ?? []) === JSON.stringify(documents)
        ? previous
        : {
            requestId: crypto.randomUUID(),
            message: text,
            ...(model ? { model } : {}),
            ...(images.length ? { images } : {}),
            ...(documents.length ? { documents } : {}),
          }
    savePending(session.sessionId, request)
    retry.current = { sessionId: session.sessionId, request }
    setBusy(true)
    setError('')
    setPending({ text, sentAt: new Date().toISOString(), images, documents })
    setDraft('')
    setImages([])
    setDocuments([])
    try {
      const result = await api<{ sessionId: string; message: Message }>(
        'messages',
        request,
        session.sessionId,
      )
      if (result.sessionId !== session.sessionId || !isMessage(result.message))
        throw new Error('Не удалось прочитать ответ.')
      const next = [
        ...messages.filter((message) => message.request_id !== request.requestId),
        result.message,
      ].slice(-200)
      setMessages(next)
      setAnimateId(request.requestId)
      save(session.sessionId, next)
      savePending(session.sessionId, null)
      retry.current = null
    } catch (e) {
      setDraft(text)
      setImages(images)
      setDocuments(documents)
      setError(e instanceof Error ? e.message : 'Ошибка соединения.')
      if (e instanceof ApiError && e.code === 'SESSION_CHANGED') {
        setSession(null)
        setMessages([])
        setReady(false)
      }
    } finally {
      setPending(null)
      setBusy(false)
      lock.current = false
    }
  }
  async function newSession() {
    if (!session || !ready || lock.current) return
    lock.current = true
    version.current++
    setBusy(true)
    setError('')
    try {
      const current = await api<Session>('session', {}, session.sessionId)
      loadedSession.current = current.sessionId
      hydratedSession.current = current.sessionId
      setSession(current)
      setMessages([])
      setDraft('')
      setImages([])
      setDocuments([])
      setAnimateId(null)
      retry.current = null
      save(current.sessionId, [])
      try {
        localStorage.setItem('chat-session-changed', current.sessionId)
      } catch {
        /* Optional cross-tab notification. */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось начать новый диалог.')
      if (e instanceof ApiError && e.code === 'SESSION_CHANGED') {
        setSession(null)
        setMessages([])
        setReady(false)
      }
    } finally {
      setBusy(false)
      lock.current = false
    }
  }
  return {
    session,
    messages,
    draft,
    setDraft,
    images,
    setImages,
    documents,
    setDocuments,
    addDocuments: (sessionId: string, added: DocumentAttachment[]) => {
      if (loadedSession.current === sessionId) setDocuments((current) => [...current, ...added])
    },
    addImages: (sessionId: string, added: string[]) => {
      // Ignore file reads that finish after another tab has changed the session.
      if (loadedSession.current === sessionId) setImages((current) => [...current, ...added])
    },
    pending,
    busy,
    ready,
    error,
    animateId,
    send,
    newSession,
    load,
  }
}
