/**
 * Turning anything thrown into a message fit to show, in the extractor's style: a plain sentence
 * saying what happened and what to do next, and the technical cause, if any, after
 * "Details for support:" where the window tucks it behind "Show technical details".
 *
 * Kept free of Electron imports so it can be unit tested.
 */
import { redact } from './redact'
import { SUPPORT_CONTACT } from './googleMessages'

export const ASK_SUPPORT = `If it keeps happening, contact ${SUPPORT_CONTACT}.`

/** " Details for support: …", or nothing when there is no detail worth keeping. */
export function supportDetails(text: string): string {
  const clean = redact(text).replace(/\s+/g, ' ').trim().slice(0, 300)
  return clean ? ` Details for support: ${clean}` : ''
}

/**
 * Messages the app wrote itself are full sentences and are shown as they are. Anything else
 * (a library's "fetch failed", "Unexpected token < in JSON", a TypeError) is replaced by
 * `fallback` plus a next step, with the raw text kept for support.
 */
const LOOKS_TECHNICAL = /\b(?:TypeError|ReferenceError|SyntaxError|ENOTFOUND|ECONN\w*|ETIMEDOUT|EAI_AGAIN|fetch failed|Unexpected token|undefined|null|JSON|stack)\b/

export function toUserMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const text = raw.trim()
  const [plain] = text.split(/\s*Details for support:/)
  if (text && /^[A-Z“"]/.test(plain) && /[.?!”"]$/.test(plain) && !LOOKS_TECHNICAL.test(plain)) return text
  return `${fallback.replace(/\.?$/, '.')} Please try again. ${ASK_SUPPORT}${supportDetails(text)}`
}
