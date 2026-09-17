import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, MessageSquare, Plus, ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/use-chat'
import { MessagePair, PendingReply } from '@/components/chat/message-pair'
import { ModelPicker } from '@/components/chat/model-picker'
import { imageAccept, readImage } from '@/lib/images'

function App() {
  const [model, setModel] = useState<string>()
  const [supportsImages, setSupportsImages] = useState(false)
  const chooseModel = useCallback((id: string, supported = false) => {
    setModel(id)
    setSupportsImages(supported)
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
    if (!supportsImages) {
      setImageError('Выберите модель с пометкой «Изображения».')
      return
    }
    if (images.length + files.length > 3) {
      setImageError('Можно прикрепить до 3 изображений.')
      return
    }
    readingLock.current = true
    setReadingImages(true)
    try {
      const loaded = await Promise.all(files.map(readImage))
      addImages(session.sessionId, loaded)
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Не удалось загрузить файл.')
    } finally {
      readingLock.current = false
      setReadingImages(false)
    }
  }
  function submit() {
    if (!readingLock.current && (!images.length || supportsImages)) {
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
            {imageError && (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {imageError}
              </p>
            )}
            {readingImages && (
              <p role="status" className="mb-2 text-xs text-muted-foreground">
                Читаю изображения…
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
                      ? 'До 3 изображений по 2 МБ. Можно вставить из буфера.'
                      : 'Выберите модель с пометкой «Изображения»'
                  }
                  disabled={
                    !supportsImages || busy || !ready || readingImages || images.length >= 3
                  }
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus aria-hidden="true" />
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
                  (!draft.trim() && !images.length) ||
                  (!!images.length && !supportsImages)
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
