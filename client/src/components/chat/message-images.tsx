export function MessageImages({ sources }: { sources: string[] }) {
  if (!sources.length) return null
  return (
    <div className="my-2 flex flex-wrap gap-2">
      {sources.map((src, index) => (
        <a
          key={`${src.slice(0, 60)}-${index}`}
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label={`Открыть изображение ${index + 1}`}
        >
          <img
            src={src}
            alt={`Вложение ${index + 1}`}
            loading="lazy"
            className="max-h-48 max-w-full rounded-lg border object-contain"
          />
        </a>
      ))}
    </div>
  )
}
