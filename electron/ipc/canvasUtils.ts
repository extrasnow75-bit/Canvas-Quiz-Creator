/**
 * Pure helpers for Canvas addresses, split out from canvas.ts so they can be unit-tested
 * without Electron.
 */

/** A Canvas course, as parsed out of a URL the user pasted. */
export interface CourseRef {
  /** Scheme + host, e.g. "https://boisestate.instructure.com". No trailing slash. */
  origin: string
  /** Host only, for allowlist comparisons. */
  host: string
  courseId: string
}

/**
 * Pull the Canvas origin and course id out of a URL the user pasted.
 *
 * Returns null for anything that is not an HTTPS Canvas course URL. The HTTPS requirement is not
 * pedantry: this origin is what the Canvas token gets sent to, and over plain HTTP that token —
 * and with it every student record the instructor can see — crosses the network in the clear.
 *
 * Private, loopback and link-local hosts are refused for the same reason the web app's proxy
 * refused them. There the concern was SSRF through a server-side proxy; here it is narrower but
 * real — a course URL pointing at 169.254.169.254 or a LAN address is not a Canvas instance, and
 * sending an instructor's token there is never the right outcome.
 */
export function parseCourseUrl(courseUrl: string): CourseRef | null {
  let parsed: URL
  try {
    parsed = new URL(courseUrl.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null

  const host = parsed.hostname
  // `URL.hostname` keeps the brackets on an IPv6 literal, so "::1" alone never matched. No Canvas
  // site is an IPv6 literal, and the private and mapped forms are many, so refuse them all.
  if (host.startsWith('[')) return null
  const lower = host.toLowerCase().replace(/\.$/, '')
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) return null
  if (host === '127.0.0.1') return null
  const oct = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (oct) {
    const [, a, b] = oct.map(Number)
    if (a === 10) return null // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return null // 172.16.0.0/12
    if (a === 192 && b === 168) return null // 192.168.0.0/16
    if (a === 169 && b === 254) return null // 169.254.0.0/16 — link-local, cloud metadata
    if (a === 0) return null // 0.0.0.0/8
    if (a === 127) return null // loopback by address
  }

  const courseMatch = parsed.pathname.match(/\/courses\/(\d+)/)
  if (!courseMatch) return null

  return {
    origin: `${parsed.protocol}//${parsed.host}`,
    host: parsed.host,
    courseId: courseMatch[1],
  }
}
