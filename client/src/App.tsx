import { useEffect, useRef, useState } from 'react'
import { ArrowUp, MessageSquare, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/use-chat'
import { MessagePair, PendingReply } from '@/components/chat/message-pair'
import { ModelPicker } from '@/components/chat/model-picker'

function App() {
  const [model, setModel] = useState<string>()
  const {
    session,
    messages,
    draft,
    setDraft,
    pending,
    busy,
    ready,
    error,
    animateId,
    send,
    newSession,
    load,
  } = useChat()
  const bottom = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    bottom.current?.scrollIntoView({
      block: 'end',
      behavior: animateId && !reduced ? 'smooth' : 'instant',
    })
  }, [messages, pending, error, animateId])
  useEffect(() => {
    if (!busy && ready) input.current?.focus()
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
            disabled={!session || !ready || busy}
          >
            <Plus aria-hidden="true" />
            Новый диалог
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-4 sm:px-8" aria-label="Переписка">
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
          <div ref={bottom} />
        </div>
      </main>
      <footer className="px-4 pb-4 pt-3 sm:px-8">
        <form
          className="mx-auto max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault()
            void send(model)
          }}
        >
          <ModelPicker value={model} onChange={setModel} disabled={busy} />
          <div className="composer rounded-2xl border bg-background p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
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
                  void send(model)
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Enter отправить · Shift + Enter перенос
              </span>
              <Button
                type="submit"
                size="icon"
                aria-label="Отправить сообщение"
                disabled={!session?.configured || !ready || busy || !draft.trim()}
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
