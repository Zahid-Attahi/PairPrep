export const codeLanguages = { javascript: 'JavaScript', python: 'Python', java: 'Java (Editor Only)' } as const
export type CodeLanguage = keyof typeof codeLanguages

export function isCodeLanguage(value: unknown): value is CodeLanguage {
  return typeof value === 'string' && Object.hasOwn(codeLanguages, value)
}

export const codeRunLimits = {
  sourceBytes: 32 * 1024,
  stdinBytes: 4 * 1024,
  outputBytesPerStream: 8 * 1024,
  runWallTimeMs: 3_000,
  compileWallTimeMs: 8_000,
  memoryMiB: 256,
  network: 'disabled',
} as const

export const codeRunMessages = {
  success: 'Completed',
  compile_error: 'Compilation error',
  runtime_error: 'Runtime error',
  timed_out: 'Execution timed out',
  limit_exceeded: 'Resource limit exceeded',
} as const

export interface CodeRunResult {
  status: keyof typeof codeRunMessages
  durationMs: number | null
  stdout: string
  stderr: string
  compileOutput: string
  truncated: boolean
}
