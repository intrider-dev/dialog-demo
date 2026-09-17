import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  useEffect(() => {
    if (status === 'idle') return
    const timer = window.setTimeout(() => setStatus('idle'), 2500)
    return () => window.clearTimeout(timer)
  }, [status])
  return (
    <div className="my-5 overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/60 px-4 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">{language || 'Код'}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code)
              setStatus('copied')
            } catch {
              setStatus('error')
            }
          }}
        >
          {status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {status === 'copied' ? 'Скопировано' : 'Копировать код'}
        </Button>
      </div>
      <pre
        tabIndex={0}
        aria-label="Блок кода"
        className="overflow-x-auto p-4 text-[13px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <code>{code}</code>
      </pre>
      {status === 'error' && (
        <p role="status" className="px-4 pb-3 text-xs text-muted-foreground">
          Не удалось скопировать. Выделите код вручную.
        </p>
      )}
      <span className="sr-only" role="status">
        {status === 'copied' ? 'Код скопирован' : ''}
      </span>
    </div>
  )
}

// Markdown becomes React elements. Raw HTML stays text; remote images never load automatically.
const components: Components = {
  pre: ({ children }) => {
    const child = Children.toArray(children)[0]
    const props = isValidElement<{ children?: ReactNode; className?: string }>(child)
      ? child.props
      : {}
    return (
      <CodeBlock
        code={String(props.children ?? '').replace(/\n$/, '')}
        language={props.className?.replace(/^language-/, '') ?? ''}
      />
    )
  },
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground focus-visible:outline-2"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => (
    <span className="text-muted-foreground">[Изображение{alt ? `: ${alt}` : ''}]</span>
  ),
  hr: () => <Separator className="my-6" />,
  table: ({ children }) => (
    <div className="my-5 overflow-hidden rounded-xl border">
      <Table>{children}</Table>
    </div>
  ),
  thead: ({ children }) => <TableHeader className="bg-muted/60">{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children, style }) => (
    <TableHead style={style} className="border-r last:border-r-0 px-4 py-3 font-semibold">
      {children}
    </TableHead>
  ),
  td: ({ children, style }) => (
    <TableCell style={style} className="border-r last:border-r-0 px-4 py-3">
      {children}
    </TableCell>
  ),
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
