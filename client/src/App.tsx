import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  MessageSquare,
  Plus,
  ImagePlus,
  FilePlus2,
  FileText,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/use-chat'
import { MessagePair, PendingReply } from '@/components/chat/message-pair'
import { ModelPicker } from '@/components/chat/model-picker'
import { documentAccept, readDocument, type DocumentAttachment } from '@/lib/documents'
import { imageAccept, readImage } from '@/lib/images'

function App() {
  const [model, setModel] = useState<string>()
  const [supportsImages, setSupportsImages] = useState(false)
  const [supportsDocuments, setSupportsDocuments] = useState(false)
  const documentInput = useRef<HTMLInputElement>(null)
  const chooseModel = useCallback((id: string, supported = false, documentsSupported = false) => {
    setModel(id)
    setSupportsImages(supported)
    setSupportsDocuments(documentsSupported)
  }, [])
  const [readingImages, setReadingImages] = useState(false)
  const [imageError, setImageError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const readingLock = useRef(false)
  const {
    session,
    messages,
    draft,
    setDraft,
    images,
    setImages,
    addImages,
    documents,
    setDocuments,
    addDocuments,
    pending,
    busy,
    ready,
    error,
    animateId,
    send,
    newSession,
    load,
  } = useChat()
  async function attach(files: File[]) {
    if (!files.length || busy || !ready || !session || readingLock.current) return
    setImageError('')
    const documentFiles = files.filter((file) => /\.(pdf|txt|md|csv|json)$/i.test(file.name))
    const imageFiles = files.filter((file) => !documentFiles.includes(file))
    if (documentFiles.some((file) => /\.pdf$/i.test(file.name)) && !supportsDocuments) {
      setImageError('Выберите модель со значком документа для отправки PDF.')
      return
    }
    if (documents.length + documentFiles.length > 3) {
      setImageError('Можно прикрепить до 3 документов.')
      return
    }
    if (imageFiles.length && !supportsImages) {
      setImageError('Выберите модель с пометкой «Изображения».')
      return
    }
    if (images.length + imageFiles.length > 3) {
      setImageError('Можно прикрепить до 3 изображений.')
      return
    }
    readingLock.current = true
    setReadingImages(true)
    try {
      const loaded: string[] = []
      const loadedDocuments: DocumentAttachment[] = []
      for (const file of documentFiles) loadedDocuments.push(await readDocument(file))
      for (const file of imageFiles) loaded.push(await readImage(file))
      addDocuments(session.sessionId, loadedDocuments)
      addImages(session.sessionId, loaded)
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Не удалось загрузить файл.')
    } finally {
      readingLock.current = false
      setReadingImages(false)
    }
  }
  function submit() {
    if (
      !readingLock.current &&
      (!images.length || supportsImages) &&
      (!documents.some((d) => /\.pdf$/i.test(d.name)) || supportsDocuments)
    ) {
      following.current = true
      void send(model)
    }
  }
  const following = useRef(true)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const chatScroll = useRef<HTMLElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  function scrollDown(smooth = true) {
    following.current = true
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chatScroll.current?.scrollTo({
      top: chatScroll.current.scrollHeight,
      behavior: smooth && !reduced ? 'smooth' : 'instant',
    })
  }
  function trackScroll(event: React.UIEvent<HTMLElement>) {
    const { scrollHeight, clientHeight, scrollTop } = event.currentTarget
    const remaining = scrollHeight - clientHeight - scrollTop
    const nearBottom = remaining < 80
    following.current = nearBottom
    setShowScrollDown(remaining > 1)
  }
  useEffect(() => {
    following.current = true
    scrollDown(false)
  }, [session?.sessionId])
  useEffect(() => {
    if (following.current) scrollDown(Boolean(animateId))
  }, [messages, pending, error, animateId])
  useEffect(() => {
    if (!busy && ready) input.current?.focus({ preventScroll: true })
  }, [busy, ready])

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="border-b px-4 sm:px-8">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
              <MessageSquare className="size-4" aria-hidden="true" />
            </span>
            <span className="font-semibold tracking-tight">Диалог</span>
          </div>
          <Button
            variant="ghost"
            onClick={() => void newSession()}
            disabled={!session || !ready || busy || readingImages}
          >
            <Plus aria-hidden="true" />
            Новый диалог
          </Button>
        </div>
      </header>
      <main
        ref={chatScroll}
        id="chat-messages"
        className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-8"
        aria-label="Переписка"
        onScroll={trackScroll}
      >
        <div className="mx-auto max-w-3xl py-8">
          {!messages.length && !pending && (
            <div className="py-12 sm:py-20">
              <p className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Место для ваших вопросов
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">С чего начнём?</h1>
              <p className="mt-4 max-w-md text-muted-foreground">
                Задайте вопрос, разберите идею или попросите помочь с текстом. Продолжить разговор
                можно в любой момент.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {['Объясни сложную тему', 'Помоги с идеей', 'Составь план'].map((text) => (
                  <Button
                    key={text}
                    variant="outline"
                    onClick={() => {
                      setDraft(text)
                      input.current?.focus()
                    }}
                  >
                    {text}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-8">
            {messages.map((message, index) => (
              <MessagePair
                key={message.request_id ?? `${message.created_at}-${index}`}
                message={message}
                animate={message.request_id === animateId}
              />
            ))}
            {pending && <PendingReply message={pending} />}
          </div>
          {error && (
            <p
              role="alert"
              className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {!ready && error && (
            <Button className="mt-3" variant="outline" onClick={() => void load()}>
              Обновить диалог
            </Button>
          )}
          {session && !session.configured && (
            <p role="status" className="mt-6 text-sm text-muted-foreground">
              Сервис пока не настроен. Отправка сообщений станет доступна после подключения.
            </p>
          )}
        </div>
      </main>
      <footer className="chat-footer relative z-10 bg-background px-4 pb-4 pt-3 sm:px-8">
        {showScrollDown && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute -top-12 left-1/2 -translate-x-1/2 rounded-full bg-background shadow-md"
            aria-label="К последним сообщениям"
            aria-controls="chat-messages"
            onClick={() => scrollDown()}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
        )}
        <form
          className="mx-auto max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.items)
              .filter((item) => item.kind === 'file')
              .map((item) => item.getAsFile())
              .filter((file): file is File => Boolean(file))
            if (files.length) {
              if (!event.clipboardData.getData('text/plain')) event.preventDefault()
              void attach(files)
            }
          }}
        >
          <ModelPicker
            value={model}
            onChange={chooseModel}
            disabled={busy || readingImages}
            requireImages={images.length > 0}
            requireDocuments={documents.some((d) => /\.pdf$/i.test(d.name))}
          />
          <div className="composer rounded-2xl border bg-background p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
            {!!images.length && (
              <div className="mb-3 flex flex-wrap gap-2">
                {images.map((src, index) => (
                  <div key={index} className="relative">
                    <img
                      src={src}
                      alt={`Вложение ${index + 1}`}
                      className="size-20 rounded-lg border object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Удалить изображение ${index + 1}`}
                      disabled={busy || readingImages}
                      onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                      className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full border bg-background shadow-sm"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {!!documents.length && (
              <div className="mb-3 flex flex-wrap gap-2">
                {documents.map((document, index) => (
                  <div
                    key={index}
                    className="flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                  >
                    <FileText className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate" title={document.name}>
                      {document.name}
                    </span>
                    <button
                      type="button"
                      aria-label={`Удалить документ ${document.name}`}
                      disabled={busy || readingImages}
                      onClick={() =>
                        setDocuments((current) => current.filter((_, i) => i !== index))
                      }
                      className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {imageError && (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {imageError}
              </p>
            )}
            {readingImages && (
              <p role="status" className="mb-2 text-xs text-muted-foreground">
                Подготавливаю вложения…
              </p>
            )}
            <label htmlFor="message" className="sr-only">
              Ваше сообщение
            </label>
            <textarea
              ref={input}
              id="message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Напишите сообщение…"
              rows={2}
              maxLength={4000}
              disabled={busy || !ready}
              className="block max-h-40 min-h-16 w-full resize-y bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground disabled:opacity-60 sm:text-sm"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  submit()
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Выбрать изображения"
                  accept={imageAccept}
                  multiple
                  disabled={!supportsImages || busy || !ready || readingImages}
                  onChange={(event) => {
                    void attach(Array.from(event.target.files ?? []))
                    event.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Прикрепить изображения"
                  title={
                    supportsImages
                      ? 'До 3 изображений. Большие файлы сжимаются автоматически. Можно вставить из буфера.'
                      : 'Выберите модель с пометкой «Изображения»'
                  }
                  disabled={
                    !supportsImages || busy || !ready || readingImages || images.length >= 3
                  }
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus aria-hidden="true" />
                </Button>
                <input
                  ref={documentInput}
                  type="file"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Выбрать документы"
                  accept={documentAccept}
                  multiple
                  disabled={busy || !ready || readingImages}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? [])
                    event.target.value = ''
                    if (files.some((file) => !/\.(pdf|txt|md|csv|json)$/i.test(file.name))) {
                      setImageError(
                        'Поддерживаются PDF, TXT, MD, CSV и JSON. Другой документ сохраните в PDF.',
                      )
                      return
                    }
                    void attach(files)
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Прикрепить документы"
                  title="До 3 документов по 5 МБ: PDF, TXT, MD, CSV, JSON. Текст до 20 000 символов. Для PDF выберите модель со значком документа."
                  disabled={busy || !ready || readingImages || documents.length >= 3}
                  onClick={() => documentInput.current?.click()}
                >
                  <FilePlus2 aria-hidden="true" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  Enter отправить · Shift + Enter перенос
                </span>
              </div>
              <Button
                type="submit"
                size="icon"
                aria-label="Отправить сообщение"
                disabled={
                  !session?.configured ||
                  !ready ||
                  busy ||
                  readingImages ||
                  (!draft.trim() && !images.length && !documents.length) ||
                  (!!images.length && !supportsImages) ||
                  (documents.some((d) => /\.pdf$/i.test(d.name)) && !supportsDocuments)
                }
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            История сохраняется в этом браузере и на сервере. Ответы могут содержать ошибки.
          </p>
        </form>
      </footer>
    </div>
  )
}
export default App
