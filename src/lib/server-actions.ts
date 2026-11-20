import { getAuthToken } from 'deepspace'
import type { ActionResult } from 'deepspace/worker'

export async function callServerAction<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new Error('Your session has expired. Sign in and try again.')

  const response = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })
  const result = (await response.json().catch(() => null)) as ActionResult<T> | { error?: string } | null

  if (!response.ok || !result || !('success' in result) || !result.success) {
    const message = result && 'error' in result ? result.error : undefined
    throw new Error(message || `The request failed (${response.status}).`)
  }

  return result.data
}
