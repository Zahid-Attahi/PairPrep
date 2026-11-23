import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'
import quickJSVariant from '@jitl/quickjs-singlefile-browser-release-sync'
import { loadMicroPython } from '@micropython/micropython-webassembly-pyscript'
import pythonWasm from '@micropython/micropython-webassembly-pyscript/micropython.wasm'
import { codeRunLimits, type CodeRunResult } from '../lib/code-run'

type RunInput = { language: 'python' | 'javascript'; source: string; stdin: string }

function outputBuffer() {
  const bytes = new Uint8Array(codeRunLimits.outputBytesPerStream)
  let size = 0
  let truncated = false
  return {
    write(chunk: Uint8Array) {
      const available = bytes.length - size
      const take = Math.min(chunk.length, available)
      bytes.set(chunk.subarray(0, take), size)
      size += take
      truncated ||= chunk.length > take
    },
    read: () => new TextDecoder().decode(bytes.subarray(0, size), { stream: truncated }),
    truncated: () => truncated,
  }
}

const encoder = new TextEncoder()
const heapBytes = 32 * 1024 * 1024

async function run(input: RunInput, port: MessagePort) {
  const reply = port.postMessage.bind(port)
  const stdout = outputBuffer()
  const stderr = outputBuffer()
  const writeText = (buffer: typeof stdout, text: string) => {
    buffer.write(encoder.encode(text.slice(0, codeRunLimits.outputBytesPerStream + 1)))
  }
  let started = 0
  let status: CodeRunResult['status'] = 'success'
  const begin = () => {
    started = performance.now()
    reply({ type: 'started' })
  }

  try {
    if (input.language === 'python') {
      const url = URL.createObjectURL(new Blob([pythonWasm], { type: 'application/wasm' }))
      const stdin = input.stdin && !input.stdin.endsWith('\n') ? input.stdin + '\n' : input.stdin
      const bytes = encoder.encode(stdin)
      let offset = 0
      const python = await loadMicroPython({
        url, heapsize: heapBytes, linebuffer: false,
        stdin: () => bytes[offset++] ?? null,
        stdout: stdout.write, stderr: stderr.write,
      }).finally(() => URL.revokeObjectURL(url))
      begin()
      // MicroPython's interactive input expects a terminal. Bind input() to a
      // text stream instead, including an explicit EOF at the end of stdin.
      python.globals.set('_pairprep_stdin', input.stdin)
      python.runPython(`
import builtins as _pairprep_builtins
import io as _pairprep_io
def _pairprep_make_input(text):
    stream = _pairprep_io.StringIO(text)
    def read(prompt=""):
        print(prompt, end="")
        line = stream.readline()
        if not line:
            raise EOFError("No more standard input")
        return line.rstrip("\\n").rstrip("\\r")
    return read
_pairprep_builtins.input = _pairprep_make_input(_pairprep_stdin)
del _pairprep_stdin, _pairprep_builtins, _pairprep_make_input
`)
      python.runPython(input.source)
    } else {
      const quickjs = await newQuickJSWASMModuleFromVariant(quickJSVariant)
      const runtime = quickjs.newRuntime()
      runtime.setMemoryLimit(heapBytes)
      runtime.setMaxStackSize(512 * 1024)
      const vm = runtime.newContext()
      const lines = input.stdin ? input.stdin.split(/\r?\n/) : []
      if (lines.at(-1) === '') lines.pop()
      let line = 0
      try {
        for (const [name, buffer] of [['__stdout', stdout], ['__stderr', stderr]] as const) {
          const write = vm.newFunction(name, (value) => writeText(buffer, vm.getString(value)))
          vm.setProp(vm.global, name, write)
          write.dispose()
        }
        const read = vm.newFunction('readLine', () => line < lines.length ? vm.newString(lines[line++]) : vm.null)
        vm.setProp(vm.global, 'readLine', read)
        read.dispose()
        vm.unwrapResult(vm.evalCode(`
          globalThis.console = ((stdout, stderr) => {
            const print = (write) => (...args) => {
              let text = "";
              for (const arg of args) {
                if (text.length > 8192) break;
                text += (text ? " " : "") + String(arg).slice(0, 8193);
              }
              write(text + "\\n");
            };
            return { log: print(stdout), info: print(stdout), warn: print(stderr), error: print(stderr) };
          })(__stdout, __stderr);
          delete globalThis.__stdout;
          delete globalThis.__stderr;
        `)).dispose()
        begin()
        runtime.setInterruptHandler(() => performance.now() - started >= codeRunLimits.runWallTimeMs)
        vm.unwrapResult(vm.evalCode(input.source, 'submission.js')).dispose()
        vm.unwrapResult(runtime.executePendingJobs())
      } finally {
        vm.dispose()
        runtime.dispose()
      }
    }
  } catch (error) {
    if (!started) {
      reply({ type: 'error' })
      return
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    status = performance.now() - started >= codeRunLimits.runWallTimeMs ? 'timed_out'
      : /out of memory|MemoryError/i.test(message) ? 'limit_exceeded'
        : /SyntaxError|IndentationError/.test(message) ? 'compile_error' : 'runtime_error'
    if (status !== 'timed_out') writeText(stderr, message)
  }

  reply({
    type: 'result',
    result: {
      status, durationMs: Math.round(performance.now() - started),
      stdout: stdout.read(), stderr: stderr.read(), compileOutput: '',
      truncated: stdout.truncated() || stderr.truncated(),
    } satisfies CodeRunResult,
  })
}

self.addEventListener('message', (event: MessageEvent<RunInput>) => {
  const port = event.ports[0]
  if (!port) return
  if (self.origin !== 'null') {
    port.postMessage({ type: 'error' })
    return
  }
  void run(event.data, port)
}, { once: true })
