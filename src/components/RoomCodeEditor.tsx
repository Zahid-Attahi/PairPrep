import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRecordContext, useYjsField } from 'deepspace'
import { Code2, Play, RotateCw, Square } from 'lucide-react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/editor/browser/coreCommands.js'
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js'
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js'
import 'monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation.js'
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js'
import 'monaco-editor/esm/vs/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js'
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'
import { MonacoBinding } from 'y-monaco'
import { UndoManager } from 'yjs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { codeLanguages, codeRunLimits, codeRunMessages, isCodeLanguage, type CodeRunResult } from '@/lib/code-run'
import { runBrowserCode } from '@/runner/browser-runner'
import './room-code-editor.css'

Object.assign(globalThis, { MonacoEnvironment: { getWorker: () => new EditorWorker() } })

monaco.editor.defineTheme('pairprep', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '91a5a0' },
    { token: 'keyword', foreground: 'cbb3ff' },
    { token: 'string', foreground: '91e8b5' },
    { token: 'number', foreground: 'f8ce94' },
  ],
  colors: {
    'editor.background': '#101315',
    'editor.foreground': '#f1f5f3',
    'editorLineNumber.foreground': '#91a19f',
    'editorLineNumber.activeForeground': '#d5e6e1',
    'editorCursor.foreground': '#91e8b5',
    'editor.selectionBackground': '#33564b',
    'editor.lineHighlightBackground': '#182022',
    'editorIndentGuide.background1': '#303b3d',
  },
})

export default function RoomCodeEditor({ roomId }: { roomId: string }) {
  const { doc, awareness, synced, canWrite } = useYjsField('interviewRooms', roomId, 'code')
  const { status } = useRecordContext()
  const metadata = doc.getMap<unknown>('metadata')
  const sharedLanguage = metadata.get('language')
  const language = isCodeLanguage(sharedLanguage) ? sharedLanguage : 'javascript'
  const ready = status === 'connected' && synced
  const editable = ready && canWrite
  const editorHost = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const editorConfiguration = useRef({ editable, language })
  const runnerAvailable = language !== 'java'
  const [stdin, setStdin] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [result, setResult] = useState<CodeRunResult | null>(null)
  const runInFlight = useRef<AbortController | null>(null)

  useEffect(() => () => runInFlight.current?.abort(), [roomId])

  async function runCode() {
    const model = editor.current?.getModel()
    if (!model || !ready || !runnerAvailable || runInFlight.current) return
    const source = model.getValue()
    const selectedLanguage = model.getLanguageId()
    const encoder = new TextEncoder()
    if (!source.trim() || !isCodeLanguage(selectedLanguage) || selectedLanguage === 'java' ||
        encoder.encode(source).byteLength > codeRunLimits.sourceBytes ||
        encoder.encode(stdin).byteLength > codeRunLimits.stdinBytes) {
      setResult(null)
      setRunError('Enter code and stay within 32 KiB of source and 4 KiB of standard input.')
      return
    }

    const controller = new AbortController()
    runInFlight.current = controller
    setRunning(true)
    setResult(null)
    setRunError('')
    try {
      const result = await runBrowserCode({ language: selectedLanguage, source, stdin }, controller.signal)
      if (!controller.signal.aborted) setResult(result)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Could not run this code.')
    } finally {
      runInFlight.current = null
      setRunning(false)
    }
  }

  useEffect(() => {
    const host = editorHost.current
    if (!host) return
    const code = doc.getText('content')
    const model = monaco.editor.createModel(code.toString(), editorConfiguration.current.language)
    const view = monaco.editor.create(host, {
      model,
      theme: 'pairprep',
      ariaLabel: 'Shared code editor',
      automaticLayout: true,
      readOnly: !editorConfiguration.current.editable,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      autoIndent: 'full',
      tabSize: 4,
      detectIndentation: false,
      insertSpaces: true,
      fontSize: 14,
      lineHeight: 24,
      padding: { top: 12, bottom: 12 },
      contextmenu: false,
      wordWrap: 'on',
    })
    editor.current = view

    // y-monaco uses getStates, setLocalStateField, on and off, all supplied by
    // the DeepSpace awareness object on this existing RecordRoom socket.
    type BindingAwareness = NonNullable<ConstructorParameters<typeof MonacoBinding>[3]>
    const binding = new MonacoBinding(code, model, new Set([view]), awareness as unknown as BindingAwareness)
    const history = new UndoManager(code, { trackedOrigins: new Set([binding]) })
    view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
      if (editorConfiguration.current.editable) history.undo()
    })
    const redo = () => {
      if (editorConfiguration.current.editable) history.redo()
    }
    view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, redo)
    view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, redo)
    const blur = view.onDidBlurEditorWidget(() => awareness.setLocalStateField('selection', null))

    return () => {
      editor.current = null
      blur.dispose()
      history.destroy()
      binding.destroy()
      view.dispose()
      model.dispose()
    }
  }, [doc, awareness])

  useLayoutEffect(() => {
    editorConfiguration.current = { editable, language }
    editor.current?.updateOptions({ readOnly: !editable })
    const model = editor.current?.getModel()
    if (model && model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language)
  }, [editable, language])

  const message = !ready
    ? status === 'disconnected' ? 'Connection lost. Editing will resume after synchronization.' : 'Loading shared code…'
    : editable ? 'Edits sync live with other participants.' : 'You have read-only access.'

  return (
    <section id="coding" tabIndex={-1} aria-labelledby="coding-heading" className="min-w-0 scroll-mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div>
          <h2 id="coding-heading" className="flex items-center gap-2 text-lg font-semibold"><Code2 className="size-4 text-primary" aria-hidden="true" /> Collaborative code editor</h2>
          <p className="mt-1 text-xs text-muted-foreground" role="status">{message}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {ready && <Badge variant="success">Synced</Badge>}
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Language
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground disabled:opacity-60"
              value={language}
              disabled={!editable}
              onChange={(event) => {
                const next = event.target.value
                if (editorConfiguration.current.editable && isCodeLanguage(next)) metadata.set('language', next)
              }}
            >
              {Object.entries(codeLanguages).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <Button loading={running} disabled={!ready || !runnerAvailable} onClick={() => void runCode()} aria-describedby={runnerAvailable ? 'execution-status' : 'java-execution-help'}>
            <Play aria-hidden="true" />{running ? 'Running…' : 'Run Code'}
          </Button>
        </div>
        {!runnerAvailable && (
          <p id="java-execution-help" role="status" className="w-full text-xs text-muted-foreground">
            Java execution is not supported yet. You can still edit Java code.
          </p>
        )}
      </div>
      <div className="relative border-t border-border" aria-busy={!ready}>
        <div ref={editorHost} className="pairprep-code-editor h-[clamp(20rem,50vh,34rem)]" data-language={language} />
        {!ready && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background text-sm text-muted-foreground" aria-hidden="true">
            {message}
          </div>
        )}
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">To use Tab to leave the editor, toggle Tab focus with Ctrl+M (Control+Shift+M on Mac).</p>
      <section aria-labelledby="code-output-heading" className="border-t border-border bg-background/50 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="code-output-heading" className="font-semibold">Execution output</h3>
            <p id="execution-status" role="status" className="mt-1 text-sm text-muted-foreground">
              {running ? 'Running in the sandbox…'
                : result ? codeRunMessages[result.status]
                  : runnerAvailable ? 'Runs locally in this browser.'
                    : 'Select Python or JavaScript to run code.'}
              {result?.durationMs != null && <span> · {result.durationMs.toLocaleString()} ms</span>}
            </p>
          </div>
          {running && (
            <Button variant="outline" size="sm" onClick={() => runInFlight.current?.abort()}>
              <Square aria-hidden="true" /> Stop
            </Button>
          )}
          {(result || (runError && runnerAvailable)) && (
            <Button variant="outline" size="sm" disabled={!ready || !runnerAvailable || running} onClick={() => void runCode()}>
              <RotateCw aria-hidden="true" /> Run Again
            </Button>
          )}
        </div>
        <label className="mt-4 block text-xs font-medium text-muted-foreground">
          Standard input (optional)
          <Textarea value={stdin} onChange={(event) => setStdin(event.target.value)} maxLength={codeRunLimits.stdinBytes} spellCheck={false} aria-describedby={runnerAvailable ? 'code-stdin-help' : undefined} className="mt-1.5 min-h-16 resize-y font-mono text-sm" />
        </label>
        {runnerAvailable && <p id="code-stdin-help" className="mt-1 text-xs text-muted-foreground">Read a line with <code>{language === 'python' ? 'input()' : 'readLine()'}</code>.</p>}
        {runError && <p role="alert" className="mt-3 text-sm text-destructive">{runError}</p>}
        {result && (
          <div className="mt-4 space-y-3">
            {result.truncated && <p className="text-sm text-muted-foreground">Output was truncated.</p>}
            {([
              ['Standard output', result.stdout || 'No standard output.'],
              ['Compiler output', result.compileOutput],
              ['Standard error', result.stderr],
            ] as const).map(([label, value]) => value && (
              <div key={label}>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h4>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 font-mono text-xs">{value}</pre>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
