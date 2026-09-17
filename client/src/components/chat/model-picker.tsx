import { useEffect, useState } from 'react'
import { Select } from 'radix-ui'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '@/lib/chat'
import { Button } from '@/components/ui/button'

type Catalog = { models: { id: string; name: string }[]; defaultModel: string }

export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value?: string
  onChange: (model: string) => void
  disabled: boolean
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
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
        if (initial) onChange(initial)
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
      <span id="model-label" className="text-xs text-muted-foreground">
        Модель
      </span>
      <Select.Root
        value={value ?? ''}
        disabled={disabled || !catalog}
        onValueChange={(model) => {
          // The hidden form select can emit an empty value while its options mount.
          if (!model) return
          onChange(model)
          try {
            localStorage.setItem('chat-model', model)
          } catch {
            /* Selection remains available in memory. */
          }
        }}
      >
        <Select.Trigger
          aria-labelledby="model-label"
          className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <span className="truncate">
            <Select.Value placeholder="Загрузка моделей…" />
          </span>
          <Select.Icon>
            <ChevronDown className="size-3 shrink-0" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            side="top"
            sideOffset={8}
            className="z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
          >
            <Select.ScrollUpButton className="flex justify-center py-1">
              <ChevronUp className="size-4" />
            </Select.ScrollUpButton>
            <Select.Viewport className="max-h-72 overflow-y-auto p-1">
              {catalog?.models.map((model) => (
                <Select.Item
                  key={model.id}
                  value={model.id}
                  title={model.id}
                  className="relative cursor-default rounded-md py-2 pr-3 pl-7 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <Select.ItemIndicator className="absolute left-2 top-2.5">
                    <Check className="size-3" />
                  </Select.ItemIndicator>
                  <Select.ItemText>{model.name}</Select.ItemText>
                  <div className="truncate text-xs text-muted-foreground">{model.id}</div>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="flex justify-center py-1">
              <ChevronDown className="size-4" />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  )
}
