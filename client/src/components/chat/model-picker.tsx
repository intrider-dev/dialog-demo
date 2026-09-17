import { useEffect, useState } from 'react'
import { Popover } from 'radix-ui'
import { Command } from 'cmdk'
import { Check, ChevronDown, Cpu, Search, ImageIcon } from 'lucide-react'
import { api } from '@/lib/chat'
import { Button } from '@/components/ui/button'
import type { Model } from '@/types/chat'

type Catalog = { models: Model[]; defaultModel: string }

export function ModelPicker({
  value,
  onChange,
  disabled,
  requireImages = false,
}: {
  value?: string
  onChange: (model: string, supportsImages?: boolean) => void
  disabled: boolean
  requireImages?: boolean
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let active = true
    void api<Catalog>('models').then(
      (data) => {
        if (!active) return
        if (
          !Array.isArray(data?.models) ||
          !data.models.length ||
          !data.models.every(
            (model) => typeof model?.id === 'string' && model.id && typeof model.name === 'string',
          )
        ) {
          setError('Не удалось прочитать список моделей.')
          return
        }
        setCatalog(data)
        let saved: string | null = null
        try {
          saved = localStorage.getItem('chat-model')
        } catch {
          /* The picker also works when storage is disabled. */
        }
        const initial =
          data.models.find((model) => model.id === saved)?.id ??
          data.models.find((model) => model.id === data.defaultModel)?.id ??
          data.models[0]?.id
        if (initial)
          onChange(
            initial,
            Boolean(data.models.find((model) => model.id === initial)?.supportsImages),
          )
      },
      (reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Не удалось загрузить модели.')
      },
    )
    return () => {
      active = false
    }
  }, [attempt, onChange])

  if (error)
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span role="status">{error}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setError('')
            setAttempt((current) => current + 1)
          }}
        >
          Повторить загрузку
        </Button>
      </div>
    )
  return (
    <div className="mb-3 flex min-w-0 items-center gap-2">
      <span
        id="model-label"
        className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Cpu className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        Модель
      </span>
      <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
        <Popover.Trigger
          type="button"
          role="combobox"
          aria-expanded={open && !disabled}
          disabled={disabled || !catalog}
          aria-labelledby="model-label"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
            }
          }}
          className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <span className="truncate">
            {catalog?.models.find((model) => model.id === value)?.name ?? 'Загрузка моделей…'}
          </span>
          <ChevronDown className="size-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label="Выбор модели"
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={16}
            className="z-50 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
          >
            <Command
              label="Поиск модели"
              defaultValue={value}
              loop
              filter={(id, query, keywords) =>
                `${id} ${keywords?.join(' ') ?? ''}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase())
                  ? 1
                  : 0
              }
            >
              <div className="flex items-center gap-2 border-b px-3">
                <Search
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <Command.Input
                  placeholder="Название модели или провайдер…"
                  className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <Command.List
                label="Модели"
                className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-3rem))] overflow-y-auto overscroll-contain p-1"
              >
                <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
                  <p role="status">Модели не найдены. Попробуйте другой запрос.</p>
                </Command.Empty>
                {catalog?.models.map((model) => (
                  <Command.Item
                    key={model.id}
                    value={model.id}
                    keywords={[model.name]}
                    disabled={requireImages && !model.supportsImages}
                    title={model.id}
                    onSelect={() => {
                      onChange(model.id, Boolean(model.supportsImages))
                      setOpen(false)
                      try {
                        localStorage.setItem('chat-model', model.id)
                      } catch {
                        /* Selection remains available in memory. */
                      }
                    }}
                    className="relative cursor-pointer rounded-lg py-2.5 pr-3 pl-8 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-40 data-[disabled=true]:cursor-not-allowed"
                  >
                    {model.id === value && (
                      <Check
                        className="absolute left-2.5 top-3.5 size-3.5"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{model.name}</span>
                      {model.supportsImages && (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <ImageIcon className="size-3" aria-hidden="true" />
                          Изображения
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{model.id}</div>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
