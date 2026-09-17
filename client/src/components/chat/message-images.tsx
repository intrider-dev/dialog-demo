import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function MessageImages({ sources }: { sources: string[] }) {
  if (!sources.length) return null
  return (
    <div className="my-2 flex flex-wrap gap-2">
      {sources.map((src, index) => (
        <Dialog key={`${src.slice(0, 60)}-${index}`}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={`Увеличить изображение ${index + 1}`}
              className="max-w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <img
                src={src}
                alt={`Вложение ${index + 1}`}
                loading="lazy"
                className="max-h-48 max-w-full rounded-lg border object-contain"
              />
            </button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100%-2rem)] max-w-[calc(100%-2rem)] gap-3 p-3 sm:max-w-[min(90vw,100rem)]">
            <DialogHeader className="pr-9">
              <DialogTitle className="text-sm">
                Изображение {index + 1} из {sources.length}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Увеличенное вложение. Нажмите Escape или кнопку закрытия, чтобы вернуться в чат.
              </DialogDescription>
            </DialogHeader>
            <img
              src={src}
              alt={`Вложение ${index + 1}, увеличенный просмотр`}
              className="mx-auto max-h-[calc(100dvh-8rem)] max-w-full rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      ))}
    </div>
  )
}
