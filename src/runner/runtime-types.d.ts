declare module 'virtual:pairprep-runner' {
  const source: string
  export default source
}

declare module '@micropython/micropython-webassembly-pyscript' {
  export function loadMicroPython(options: {
    url: string
    heapsize: number
    stdin: () => number | null
    stdout: (bytes: Uint8Array) => void
    stderr: (bytes: Uint8Array) => void
    linebuffer: false
  }): Promise<{
    globals: { set(name: string, value: string): void }
    runPython(code: string): unknown
  }>
}

declare module '@micropython/micropython-webassembly-pyscript/micropython.wasm' {
  const wasm: Uint8Array<ArrayBuffer>
  export default wasm
}
