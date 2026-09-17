import { Bot, UserRound, FileText } from 'lucide-react'
import type { Message, PendingMessage } from '@/types/chat'
import { MessageTime } from './message-time'
import { MessageImages } from './message-images'
import { MessageDocument } from './message-document'
import { Markdown } from './markdown'

export function MessagePair({ message, animate = false }: { message: Message; animate?: boolean }) {
  return (
    <div className={animate ? 'space-y-5 message-enter' : 'space-y-5'}>
      <div className="ml-auto max-w-[90%] rounded-2xl bg-muted px-4 py-3 text-sm">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <UserRound className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span>Вы</span>
        </div>
        <div className="whitespace-pre-wrap break-words">{message.user_message}</div>
        {message.documents?.map((document) => (
          <MessageDocument key={document.id} document={document} />
        ))}
        <MessageImages sources={(message.image_ids ?? []).map((id) => `/api/images/${id}`)} />
        <div className="mt-1 text-right">
          {/* Older rows only have the time the completed pair was saved. */}
          <MessageTime
            value={message.sent_at ?? message.created_at}
            label={message.sent_at ? 'Отправлено' : 'Сохранено'}
          />
        </div>
      </div>
      <article className="pr-4 text-sm leading-7">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Bot className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span>Ответ</span>
          <MessageTime value={message.created_at} label="Получен ответ" />
        </div>
        <Markdown>{message.ai_message}</Markdown>
      </article>
    </div>
  )
}

export function PendingReply({ message }: { message: PendingMessage }) {
  return (
    <div className="space-y-5">
      <div className="ml-auto max-w-[90%] rounded-2xl bg-muted px-4 py-3 text-sm">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <UserRound className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span>Вы</span>
        </div>
        <div className="whitespace-pre-wrap break-words">{message.text}</div>
        {message.documents?.map((document, index) => (
          <div key={index} className="mt-2 flex items-center gap-2 break-all text-xs">
            <FileText className="size-4 shrink-0" aria-hidden="true" />
            {document.name}
          </div>
        ))}
        <MessageImages sources={message.images ?? []} />
        <div className="mt-1 text-right">
          <MessageTime value={message.sentAt} label="Отправлено" />
        </div>
      </div>
      <p
        role="status"
        className="loading-status flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Bot className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        Готовлю ответ…
      </p>
    </div>
  )
}
