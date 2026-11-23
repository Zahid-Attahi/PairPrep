import { Textarea } from '@/components/ui/Textarea'

interface SharedNotesEditorProps {
  value: string
  onChange?: (value: string) => void
  disabled?: boolean
}

export function SharedNotesEditor({ value, onChange, disabled }: SharedNotesEditorProps) {
  const placeholder = 'Capture your approach, edge cases, and follow-up questions…'
  const style = 'min-h-48 bg-background/70 font-mono text-sm leading-7'

  if (!onChange) {
    return <pre className={style + ' whitespace-pre-wrap break-words rounded-lg border border-input p-4'}>{value}</pre>
  }

  return (
    <Textarea
      aria-label="Shared interview notes"
      className={style + ' min-h-72 resize-y p-4'}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  )
}
