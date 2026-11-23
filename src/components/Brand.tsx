import { Code2 } from 'lucide-react'

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5 text-base font-semibold tracking-tight">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Code2 className="size-[19px]" aria-hidden="true" />
      </span>
      PairPrep
    </span>
  )
}
