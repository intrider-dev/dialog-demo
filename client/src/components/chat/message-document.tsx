import { Download, FileText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function MessageDocument({ document }: { document: { id: string; name: string } }) {
  const url = `/api/documents/${document.id}`
  const className =
    'mt-2 flex w-full items-center gap-2 break-all rounded-lg border p-2 text-left text-xs underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const label = (
    <>
      <FileText className="size-4 shrink-0" aria-hidden="true" />
      {document.name}
    </>
  )
  if (!/\.pdf$/i.test(document.name))
    return (
      <a href={url} download className={className}>
        {label}
      </a>
    )
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={className}>
          {label}
        </button>
      </DialogTrigger>
      <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col gap-3 p-3 sm:max-w-[min(90vw,80rem)]">
        <DialogHeader className="min-w-0 pr-9 text-left">
          <DialogTitle className="break-all text-sm">{document.name}</DialogTitle>
          <DialogDescription className="sr-only">Просмотр PDF-документа.</DialogDescription>
        </DialogHeader>
        <iframe
          src={`${url}?preview=1`}
          title={`Просмотр PDF: ${document.name}`}
          className="min-h-0 w-full flex-1 rounded-lg border bg-muted"
        />
        <a
          href={url}
          download
          className="flex w-fit items-center gap-2 rounded text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="size-4" aria-hidden="true" />
          Скачать PDF
        </a>
      </DialogContent>
    </Dialog>
  )
}
