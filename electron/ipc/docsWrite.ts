/**
 * The Google Docs API requests that write reformatted questions into a tab.
 *
 * The tab starts with a short header, set as headings so the quiz reader skips it:
 *
 *     Reformatted questions — Nov 23, 2026 at 3:15 PM            (Subtitle: the time stamp)
 *     Lines the app changed are highlighted. Compare …           (Heading 6)
 *     3 notes about what to check or fix are at the end …        (Heading 6, bold; only with notes)
 *
 * then the questions, with every line the app changed highlighted in yellow, then the notes:
 *
 *     Notes from the app                                          (Heading 2: the reader stops here)
 *     Things that need a person come first …                      (normal text)
 *     03.08 Midterm                                               (Heading 3, when the Doc has several quizzes)
 *     Needs a person: Question 7: No answer is marked …           (normal text)
 *     Check: Questions 1–10: the choices copied from Canvas …     (normal text; the same note for
 *                                                                  several questions is written once)
 *
 * The questions come first so they are what a person sees on opening the tab.
 *
 * Pure: builds request bodies, sends nothing. Indexes are UTF-16 code units, which is what both
 * JavaScript string lengths and the Docs API count.
 */
import type { FixedLine } from './reformat'

export const TAB_BASE_TITLE = 'Reformatted questions'
/** Gemini's work goes in a tab of its own, apart from the original and the app's own fixes. */
export const GEMINI_TAB_TITLE = 'Revised by Gemini'

/** Which of the app's tabs is being written: its own fixes, or Gemini's. */
export type TabKind = 'rules' | 'gemini'

/** Pale yellow for the app's fixes, pale purple for Gemini's: dark text on either stays well above 4.5:1. */
const HIGHLIGHT: Record<TabKind, object> = {
  rules: { color: { rgbColor: { red: 1, green: 0.95, blue: 0.6 } } },
  gemini: { color: { rgbColor: { red: 0.91, green: 0.86, blue: 1 } } },
}

// "Check:" and "Still needs a person:" headings are the notes as tabs written before v0.2.2 had them, at the top.
const HEADER_PREFIXES = [`${TAB_BASE_TITLE} —`, `${GEMINI_TAB_TITLE} —`, 'Lines the app changed', 'Lines Gemini changed', 'Check:', 'Still needs a person:']
const NOTES_POINTER = /^\d+ notes? about what to check or fix (?:is|are) at the end of this tab/

/** The heading of the notes section at the end of a tab the app wrote. Everything from it on is notes. */
export const NOTES_TITLE = 'Notes from the app'

/** A line of the app's own header, so a second reformat of the same tab does not copy it. */
export function isAppHeaderLine(text: string, heading: boolean): boolean {
  const t = text.trim()
  return heading && (HEADER_PREFIXES.some((p) => t.startsWith(p)) || NOTES_POINTER.test(t))
}

/** Where the app's notes start in a tab, or -1. */
export function notesStart(lines: Array<{ text: string; heading: boolean }>): number {
  return lines.findIndex((l) => l.heading && l.text.trim() === NOTES_TITLE)
}

/** A tab's lines without the app's header at the top and its notes at the end: the questions. */
export function withoutAppNotes<T extends { text: string; heading: boolean }>(lines: T[]): T[] {
  const end = notesStart(lines)
  return (end === -1 ? lines : lines.slice(0, end)).filter((l) => !isAppHeaderLine(l.text, l.heading))
}

/** "1–3, 5" from [5, 1, 2, 3]. */
function ranges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]))
    i = j
  }
  return out.join(', ')
}

/** The same note about several questions, written once: "Questions 1–10: …". Order of first appearance. */
export function mergeNotes(messages: string[]): string[] {
  const groups = new Map<string, number[]>()
  for (const m of messages) {
    const q = m.match(/^Question (\d+): (.*)$/s)
    const key = q ? `Q\u0000${q[2]}` : m
    const list = groups.get(key) ?? []
    if (q) list.push(Number(q[1]))
    groups.set(key, list)
  }
  return [...groups].map(([key, numbers]) => {
    if (!key.startsWith('Q\u0000')) return key
    const text = key.slice(2)
    return numbers.length === 1 ? `Question ${numbers[0]}: ${text}` : `Questions ${ranges(numbers)}: ${text}`
  })
}

/** The notes, by quiz, in the order the quizzes come. Messages carry "Quiz title · " when the Doc has several. */
export function groupNotes(notes: HeaderNotes): Array<{ title: string | null; needsPerson: string[]; check: string[] }> {
  const groups = new Map<string, { title: string | null; needsPerson: string[]; check: string[] }>()
  const add = (kind: 'needsPerson' | 'check', message: string) => {
    const m = message.match(/^(.+?) · (.*)$/s)
    const title = m ? m[1] : null
    const key = title ?? ''
    if (!groups.has(key)) groups.set(key, { title, needsPerson: [], check: [] })
    groups.get(key)![kind].push(m ? m[2] : message)
  }
  notes.needsPerson.forEach((t) => add('needsPerson', t))
  notes.check.forEach((t) => add('check', t))
  const rank = (title: string | null) => {
    const i = notes.order?.indexOf(title) ?? -1
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...groups.values()]
    .sort((a, b) => rank(a.title) - rank(b.title))
    .map((g) => ({ ...g, needsPerson: mergeNotes(g.needsPerson), check: mergeNotes(g.check) }))
}

/** "Nov 23, 2026 at 3:15 PM", in the computer's own locale and time zone. */
export function stampFor(when: Date): string {
  const day = when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day} at ${time}`
}

/** "Reformatted questions", or "Reformatted questions 2" when that title is taken. */
export function uniqueTabTitle(existing: string[]): string {
  const taken = new Set(existing.map((t) => t.trim().toLowerCase()))
  if (!taken.has(TAB_BASE_TITLE.toLowerCase())) return TAB_BASE_TITLE
  for (let n = 2; ; n++) if (!taken.has(`${TAB_BASE_TITLE} ${n}`.toLowerCase())) return `${TAB_BASE_TITLE} ${n}`
}

export interface HeaderNotes {
  /** Answer and grading changes, each already phrased ("Question 6: marked …"). */
  check: string[]
  /** What the reformatter could not fix. */
  needsPerson: string[]
  /** The quizzes' titles in the Doc's order, so the notes follow the same order. */
  order?: Array<string | null>
}

type Style = 'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'HEADING_3' | 'HEADING_4' | 'HEADING_5' | 'HEADING_6' | 'NORMAL_TEXT'

interface Paragraph {
  text: string
  style: Style
  highlight: boolean
  bold?: boolean
}

/** A heading is written back at its own level, so quiz titles stay quiz titles. */
function styleFor(l: FixedLine): Style {
  if (!l.heading) return 'NORMAL_TEXT'
  const level = l.headingLevel ?? 6
  return level === 0 ? 'TITLE' : (`HEADING_${Math.min(6, Math.max(1, level))}` as Style)
}

function paragraphs(lines: FixedLine[], notes: HeaderNotes, when: Date, kind: TabKind): Paragraph[] {
  const groups = groupNotes(notes)
  const count = groups.reduce((n, g) => n + g.needsPerson.length + g.check.length, 0)
  const header: Paragraph[] = [
    // Subtitle, not Heading 1: quiz titles are headings, and the app's own line must never look like one.
    { text: `${kind === 'gemini' ? GEMINI_TAB_TITLE : TAB_BASE_TITLE} — ${stampFor(when)}`, style: 'SUBTITLE', highlight: false },
    {
      text:
        kind === 'gemini'
          ? 'Lines Gemini changed from the Reformatted questions tab are highlighted in purple. Compare them with the original questions and the Reformatted questions tab, and fix anything wrong here, before creating the quiz. The other tabs were not changed.'
          : 'Lines the app changed are highlighted. Compare them with the original questions, and fix anything wrong here, before creating the quiz. The original tab was not changed.',
      style: 'HEADING_6',
      highlight: false,
    },
    ...(count > 0
      ? [{ text: `${count} ${count === 1 ? 'note' : 'notes'} about what to check or fix ${count === 1 ? 'is' : 'are'} at the end of this tab, under “${NOTES_TITLE}”.`, style: 'HEADING_6' as const, highlight: false, bold: true }]
      : []),
    { text: '', style: 'NORMAL_TEXT', highlight: false },
  ]
  const footer: Paragraph[] =
    count === 0
      ? []
      : [
          { text: '', style: 'NORMAL_TEXT', highlight: false },
          { text: NOTES_TITLE, style: 'HEADING_2', highlight: false },
          {
            text: 'Things that need a person come first, then things to check. Delete each note once you have dealt with it. The app does not read anything from here down as questions.',
            style: 'NORMAL_TEXT',
            highlight: false,
          },
          ...groups.flatMap((g): Paragraph[] => [
            ...(g.title ? [{ text: g.title, style: 'HEADING_3' as const, highlight: false }] : []),
            ...g.needsPerson.map((t) => ({ text: `Needs a person: ${t}`, style: 'NORMAL_TEXT' as const, highlight: false })),
            ...g.check.map((t) => ({ text: `Check: ${t}`, style: 'NORMAL_TEXT' as const, highlight: false })),
          ]),
        ]
  const body: Paragraph[] = lines.map((l) => ({
    text: l.text,
    style: styleFor(l),
    highlight: l.changed && l.text.trim() !== '',
  }))
  return [...header, ...body, ...footer]
}

/**
 * Requests that fill an EMPTY tab (a new one, or one just cleared with `clearTabRequest`). Text
 * goes in with one insert; styles are applied afterwards by range.
 */
export function fillTabRequests(
  tabId: string | undefined,
  lines: FixedLine[],
  notes: HeaderNotes,
  when: Date,
  kind: TabKind = 'rules',
): object[] {
  const paras = paragraphs(lines, notes, when, kind)
  // Text is never allowed to carry its own newlines into a paragraph: one line, one paragraph.
  const texts = paras.map((p) => p.text.replace(/[\r\n\v]+/g, ' '))
  const location = (index: number) => (tabId ? { index, tabId } : { index })
  const range = (start: number, end: number) => (tabId ? { startIndex: start, endIndex: end, tabId } : { startIndex: start, endIndex: end })

  const requests: object[] = [{ insertText: { location: location(1), text: texts.join('\n') } }]

  // Reset everything inserted to plain text first: the insert inherits whatever style index 1 had.
  const total = texts.reduce((n, t) => n + t.length + 1, 0) - 1
  if (total > 0) {
    requests.push({
      updateTextStyle: { range: range(1, 1 + total), textStyle: { bold: false, italic: false, underline: false }, fields: 'bold,italic,underline,backgroundColor' },
    })
  }

  let at = 1
  texts.forEach((text, i) => {
    const start = at
    const end = at + text.length
    const p = paras[i]
    // A paragraph's range includes its newline; the last one ends at the tab's own final newline.
    requests.push({
      updateParagraphStyle: { range: range(start, end + 1), paragraphStyle: { namedStyleType: p.style }, fields: 'namedStyleType' },
    })
    if (p.bold && end > start) {
      requests.push({ updateTextStyle: { range: range(start, end), textStyle: { bold: true }, fields: 'bold' } })
    }
    if (p.highlight && end > start) {
      requests.push({ updateTextStyle: { range: range(start, end), textStyle: { backgroundColor: HIGHLIGHT[kind] }, fields: 'backgroundColor' } })
    }
    at = end + 1
  })
  return requests
}

/** Empty a tab, so it can be filled again. `endIndex` is the tab body's last element's endIndex. */
export function clearTabRequest(tabId: string, endIndex: number): object | null {
  // Everything but the final newline, which a document body always keeps.
  if (endIndex - 1 <= 1) return null
  return { deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1, tabId } } }
}

export function addTabRequest(title: string): object {
  return { addDocumentTab: { tabProperties: { title } } }
}

/** Link straight to a tab. */
export function tabUrl(fileId: string, tabId?: string | null): string {
  return `https://docs.google.com/document/d/${fileId}/edit${tabId ? `?tab=${encodeURIComponent(tabId)}` : ''}`
}

/**
 * The newest tab this app wrote in a Doc ("Reformatted questions", "Reformatted questions 2",
 * "Revised by Gemini"), or null when it wrote none.
 *
 * Opening a Doc used to read its first tab, which is the faculty member's original: someone
 * coming back to a Doc they had already fixed saw its problems again and could launch the unfixed
 * questions. "Newest" goes by the time stamp each tab carries in its header, because the Gemini
 * tab is rewritten in place and so its position says nothing about when it was written. A tab
 * whose stamp cannot be read counts by its position, after any stamped tab.
 */
export function newestAppTab(
  tabs: Array<{ id: string; title: string }>,
  headerOf: (tabId: string) => string[],
): { id: string; title: string } | null {
  const ours = (t: string) => new RegExp(`^(?:${TAB_BASE_TITLE}(?: \\d+)?|${GEMINI_TAB_TITLE})$`, 'i').test(t.trim())
  let best: { id: string; title: string; when: number; order: number } | null = null
  tabs.forEach((tab, order) => {
    if (!ours(tab.title)) return
    const line = headerOf(tab.id).find((l) => l.includes(' — '))
    const stamp = line?.split(' — ')[1]?.replace(/[  ]/g, ' ').replace(' at ', ' ')
    const parsed = stamp ? Date.parse(stamp) : NaN
    const when = Number.isNaN(parsed) ? -1 : parsed
    if (!best || when > best.when || (when === best.when && order > best.order)) best = { id: tab.id, title: tab.title, when, order }
  })
  return best ? { id: (best as { id: string }).id, title: (best as { title: string }).title } : null
}
