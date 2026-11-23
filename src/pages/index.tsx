import { ArrowDown, ArrowRight, Bot, ClipboardCheck, Code2, FileText, Search, UsersRound } from 'lucide-react'
import { Brand } from '../components/Brand'
import { Seo } from '../components/Seo'
import { SharedNotesEditor } from '../components/SharedNotesEditor'
import { Badge } from '../components/ui/Badge'
import { getChallenge } from '../challenges'
import { seo } from '../seo'

const features = [
  { icon: UsersRound, title: 'Work through it together', description: 'Invite a partner to a private room and edit shared notes as you explain your approach.' },
  { icon: Bot, title: 'Get a hint when you’re stuck', description: 'Ask AI Coach a question or request a follow-up. Your conversation is saved in the room.' },
  { icon: Search, title: 'Research a technical topic', description: 'Find links for unfamiliar algorithms, data structures, and programming concepts.' },
  { icon: ClipboardCheck, title: 'Reflect after each session', description: 'Save a private review of your strengths and areas to improve, then revisit it from your history.' },
]

const steps = [
  { title: 'Choose a challenge', description: 'Create a private room around a coding problem and invite someone to practice with you.' },
  { title: 'Explain your approach', description: 'Work together in shared notes. Ask the coach for a hint or look up a concept as needed.' },
  { title: 'Capture what you learned', description: 'Mark the session complete and write a private review of what to practice next.' },
]

const exampleNotes = [
  'Approach',
  'Store each value and index in a map.',
  'Check for target − value before inserting.',
  '',
  'Edge case',
  'Duplicate values can form a valid pair.',
].join('\n')

function WorkspacePreview() {
  const challenge = getChallenge('two-sum')
  return (
    <figure id="workspace-preview" className="min-w-0 scroll-mt-6">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_70px_#0006]">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/60 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Code2 className="size-4 text-primary" aria-hidden="true" /> Interview room
          </span>
          <span className="font-mono text-xs text-muted-foreground">Example session</span>
        </div>
        <div className="grid gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold tracking-tight">{challenge?.title ?? 'Two Sum'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{challenge?.topic}</p>
            </div>
            <Badge variant="outline">{challenge?.difficulty}</Badge>
          </div>
          <div className="min-w-0 rounded-xl border border-border bg-secondary/30 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-medium"><FileText className="size-4 text-primary" aria-hidden="true" /> Shared interview notes</span>
              <Badge variant="success" className="gap-1.5"><span className="size-1.5 rounded-full bg-current" /> Live</Badge>
            </div>
            <SharedNotesEditor value={exampleNotes} />
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Bot className="size-4" aria-hidden="true" /></span>
            <div>
              <p className="text-xs font-semibold">AI Coach</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">What could you store to look up the complement in one step?</p>
            </div>
          </div>
        </div>
      </div>
    </figure>
  )
}

// Keep this page static so the preview needs no auth or realtime connection.
export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" id="top">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:rounded-lg focus:bg-card focus:p-3">Skip to content</a>
        <header className="border-b border-border bg-background">
          <nav aria-label="Main navigation" className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
            <a href="/" aria-label="PairPrep home"><Brand /></a>
            <div className="hidden items-center gap-7 text-sm text-muted-foreground sm:flex">
              <a href="#features" className="hover:text-foreground">Features</a>
              <a href="#how-it-works" className="hover:text-foreground">How it works</a>
            </div>
            <a href="/home?signin=1" className="rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-secondary">Sign in</a>
          </nav>
        </header>
        <main id="main-content">
          <section className="landing-grid border-b border-border">
            <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)] lg:gap-14 lg:py-20">
              <div>
                <h1 aria-label="Practice technical interviews together." className="max-w-xl text-[clamp(2.5rem,5.7vw,4.65rem)] font-semibold leading-[1.04] tracking-[-0.065em]">
                  Practice technical interviews <span className="text-primary">together.</span>
                </h1>
                <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground sm:text-lg">
                  Work through coding challenges with a partner, get focused hints, and reflect on what to improve before your next interview.
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <a href="/home" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85">
                    Get started <ArrowRight className="size-4" aria-hidden="true" />
                  </a>
                  <a href="#workspace-preview" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-secondary">
                    See the workspace <ArrowDown className="size-4 text-muted-foreground" aria-hidden="true" />
                  </a>
                </div>
              </div>
              <WorkspacePreview />
            </div>
          </section>
          <section id="features" aria-labelledby="features-title" className="mx-auto max-w-7xl scroll-mt-6 px-5 py-14 sm:px-8 sm:py-18">
            <h2 id="features-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Tools for a better practice session</h2>
            <div className="mt-7 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, description }) => (
                <article key={title} className="bg-card p-5 sm:p-6">
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                  <h3 className="mt-4 text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                </article>
              ))}
            </div>
          </section>
          <section id="how-it-works" aria-labelledby="steps-title" className="scroll-mt-6 border-y border-border bg-card/60">
            <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
              <h2 id="steps-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">How PairPrep works</h2>
              <ol className="mt-6 grid gap-5 md:grid-cols-3">
                {steps.map(({ title, description }, index) => (
                  <li key={title} className="flex gap-3 border-t border-border pt-4">
                    <span className="mt-0.5 font-mono text-sm text-primary" aria-hidden="true">0{index + 1}</span>
                    <div>
                      <h3 className="font-semibold">{title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </main>
        <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5 px-5 py-7 sm:px-8">
          <a href="/" aria-label="PairPrep home"><Brand /></a>
          <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-3 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#how-it-works" className="hover:text-foreground">How it works</a>
            <a href="/home" className="hover:text-foreground">Open workspace</a>
          </nav>
        </footer>
      </div>
    </>
  )
}
