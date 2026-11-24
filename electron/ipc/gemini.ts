/**
 * Gemini requests, from the main process, with the key from the keychain.
 *
 * Optional: everything else in the app works without a key. Sent to Google's Generative Language
 * API with the key in a header (never in the URL, where it would end up in logs).
 */
import { getGeminiApiKey } from './credentials'
import { SUPPORT_CONTACT } from './googleMessages'
import { ASK_SUPPORT, supportDetails } from './userMessage'
import { fetchWithRetry, RequestTimeoutError } from './httpRetry'

/**
 * The stronger of the two models Canvas Rubric Creator uses (it keeps this one for its hardest
 * job). Gemini runs here only on what the app's rules could not fix, so it is called rarely, and a
 * weaker model fails the app's checks more often, which leaves the developer with nothing.
 */
export const GEMINI_MODEL = 'gemini-3.8-flash'
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
  const tail = supportDetails(`Gemini ${status}. ${detail}`)
  if ((status === 400 && /api key/i.test(detail)) || status === 401 || status === 403)
    return new Error(`Gemini did not accept the saved API key. Open Initial setup, remove the Gemini key, and paste it again, or make a new key.${tail}`)
  if (status === 429 && /quota|billing|exceeded/i.test(detail))
    return new Error(`The Gemini key has used up its allowance for now. Wait until tomorrow, or ask whoever manages the key to raise its limit. The automatic fixes still work without Gemini.${tail}`)
  if (status === 429) return new Error('Gemini is busy right now. Wait a minute, then try again.')
  if (status === 404) return new Error(`This copy of the app asks for a Gemini model that is no longer available. Contact ${SUPPORT_CONTACT} to update the app.${tail}`)
  if (status >= 500) return new Error(`Gemini is having a problem right now. Wait a few minutes, then try again. The automatic fixes still work without Gemini.${tail}`)
  return new Error(`Gemini could not answer. Please try again. ${ASK_SUPPORT}${tail}`)
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
    if (e instanceof RequestTimeoutError) throw new Error('Gemini did not answer in time. Wait a minute, then try again.')
    if (signal?.aborted) throw new Error('Stopped. Nothing was written to the Doc.')
    throw new Error(`The app could not reach Gemini. Check your internet connection, then try again.${supportDetails(e instanceof Error ? e.message : String(e))}`)
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
    throw new Error('Gemini sent back an answer the app could not read, so nothing was written. Please try again; if it keeps happening, fix the remaining problems by hand in the Doc.')
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
    return { ok: false, message: `Gemini could not check the key just now. Wait a minute, then save it again.${supportDetails(`Gemini ${response.status}`)}` }
  } catch {
    return { ok: false, message: 'The app could not reach Gemini to check the key. Check your internet connection, then save it again.' }
  }
}
