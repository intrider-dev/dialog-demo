const shortTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const fullTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'medium' })

export function MessageTime({ value, label }: { value: string; label: string }) {
  const date = new Date(value)
  // UTC from the API is displayed in the browser's local time zone.
  const description = `${label}: ${fullTime.format(date)}`

  return (
    <time
      dateTime={value}
      title={description}
      aria-label={description}
      className="text-[11px] font-normal tabular-nums text-muted-foreground"
    >
      {shortTime.format(date)}
    </time>
  )
}
