import { codeRunLimits, type CodeRunResult } from '../lib/code-run'

type RunInput = { language: 'javascript' | 'python'; source: string; stdin: string }

// This trusted script owns the worker. Submitted code is only sent as data
// over the worker's one-shot MessagePort, never interpolated into the frame.
const frameBootstrap = `
  if (self.origin === 'null') {
    let worker;
    let url;
    const stop = () => {
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
    };
    addEventListener('pagehide', stop);
    addEventListener('message', (event) => {
      if (event.source !== parent) return;
      if (event.data?.type === 'stop') {
        stop();
        return;
      }
      if (worker || event.data?.type !== 'start' || event.ports.length !== 2) return;
      const [port, control] = event.ports;
      url = URL.createObjectURL(new Blob([event.data.workerSource], { type: 'text/javascript' }));
      try {
        worker = new Worker(url);
        worker.addEventListener('error', () => control.postMessage({ type: 'error' }));
        worker.postMessage(event.data.input, [port]);
      } catch {
        control.postMessage({ type: 'error' });
        stop();
      }
    });
  }
`

export async function runBrowserCode(input: RunInput, signal: AbortSignal): Promise<CodeRunResult> {
  signal.throwIfAborted()

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const control = new MessageChannel()
    const frame = document.createElement('iframe')
    const nonce = crypto.randomUUID()
    frame.hidden = true
    frame.title = 'Isolated code runner'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.referrerPolicy = 'no-referrer'
    frame.srcdoc = `<!doctype html><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src blob:; worker-src blob:; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; base-uri 'none'; form-action 'none'">
      <script nonce="${nonce}">${frameBootstrap}</script>`

    let finished = false
    function cleanup() {
      finished = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', stop)
      channel.port1.close()
      channel.port2.close()
      control.port1.close()
      control.port2.close()
      frame.contentWindow?.postMessage({ type: 'stop' }, '*')
      frame.remove()
    }

    function stop() {
      cleanup()
      reject(new DOMException('Execution stopped.', 'AbortError'))
    }

    function unavailable() {
      cleanup()
      reject(new Error('The isolated browser runtime could not start.'))
    }

    let timeout = setTimeout(unavailable, 12_000)
    signal.addEventListener('abort', stop, { once: true })
    control.port1.onmessage = () => { if (!finished) unavailable() }
    channel.port1.onmessage = (event) => {
      if (finished) return
      const message = event.data
      if (message?.type === 'started') {
        clearTimeout(timeout)
        timeout = setTimeout(() => {
          cleanup()
          resolve({ status: 'timed_out', durationMs: codeRunLimits.runWallTimeMs,
            stdout: '', stderr: '', compileOutput: '', truncated: false })
        }, codeRunLimits.runWallTimeMs)
      } else if (message?.type === 'result') {
        cleanup()
        resolve(message.result)
      } else if (message?.type === 'error') {
        unavailable()
      }
    }
    void import('virtual:pairprep-runner').then(({ default: workerSource }) => {
      if (finished) return
      frame.addEventListener('load', () => {
        if (!finished) frame.contentWindow?.postMessage({ type: 'start', workerSource, input }, '*', [channel.port2, control.port2])
      }, { once: true })
      document.body.appendChild(frame)
    }).catch(() => { if (!finished) unavailable() })
  })
}
