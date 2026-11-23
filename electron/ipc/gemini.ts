/**
 * Gemini requests, from the main process, with the key from the keychain.
 *
 * Optional: everything else in the app works without a key. Sent to Google's Generative Language
 * API with the key in a header (never in the URL, where it would end up in logs).
 */
import { getGeminiApiKey } from './credentials'
import { fetchWithRetry, RequestTimeoutError } from './httpRetry'

/** Same model Canvas Rubric Creator uses for text work. */
export const GEMINI_MODEL = 'gemini-3.5-flash-lite'
const API = 'https://generativelanguage.googleapis.com/v1beta/models'

export const NO_GEMINI_KEY = 'No Gemini API key is saved. Add one in Initial setup to use Gemini.'

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    lines: { type: 'ARRAY', items: { type: 'STRING' } },
    notes: { type: 'STRING' },
  },
  required: ['lines'],
}

function failure(status: number, detail: string): Error {
  if (status === 400 && /api key/i.test(detail)) return new Error('Gemini did not accept the saved API key. Check it in Initial setup.')
  if (status === 401 || status === 403) return new Error('Gemini did not accept the saved API key. Check it in Initial setup.')
  if (status === 429) return new Error('Gemini is busy or the key has reached its limit. Wait a minute, then try again.')
  return new Error(`Gemini could not answer (${status}). Please try again.`)
}

/** Ask Gemini for {lines, notes}. Throws a sentence fit to show. */
export async function askForLines(prompt: string, signal?: AbortSignal): Promise<{ lines: string[]; notes: string }> {
  const key = getGeminiApiKey()
  if (!key) throw new Error(NO_GEMINI_KEY)
  let response: Response
  try {
    response = await fetchWithRetry(
      `${API}/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
        }),
      },
      // Asking again is harmless: nothing is written until a person accepts the answer.
      { idempotent: true, timeoutMs: 120_000, signal },
    )
  } catch (e) {
    if (e instanceof RequestTimeoutError) throw new Error('Gemini did not answer in time. Please try again.')
    throw new Error(`Could not reach Gemini: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw failure(response.status, detail)
  }
  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  try {
    const parsed = JSON.parse(text) as { lines?: unknown; notes?: unknown }
    if (!Array.isArray(parsed.lines)) throw new Error('no lines')
    return { lines: parsed.lines.map((l) => String(l ?? '')), notes: typeof parsed.notes === 'string' ? parsed.notes : '' }
  } catch {
    throw new Error('Gemini’s answer could not be read. Please try again.')
  }
}

/** Check a key before saving it, so a typo is caught in Initial setup rather than later. */
export async function validateGeminiKey(key: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetchWithRetry(
      `${API}/${GEMINI_MODEL}`,
      { headers: { 'x-goog-api-key': key.trim() } },
      { idempotent: true, timeoutMs: 15_000 },
    )
    if (response.ok) return { ok: true }
    if (response.status === 400 || response.status === 401 || response.status === 403)
      return { ok: false, message: 'Gemini did not accept that key. Check that you copied all of it.' }
    return { ok: false, message: `Gemini could not check the key just now (${response.status}).` }
  } catch {
    return { ok: false, message: 'Could not reach Gemini to check the key. Check your internet connection.' }
  }
}
