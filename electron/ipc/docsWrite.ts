/**
 * The Google Docs API requests that write reformatted questions into a tab.
 *
 * The tab starts with the app's own header, set as headings so the quiz reader skips it:
 *
 *     Reformatted questions — Nov 23, 2026 at 3:15 PM            (Subtitle: the time stamp)
 *     Lines the app changed are highlighted. Compare …           (Heading 6)
 *     Check: Question 6: marked b) Jupiter correct, because …    (Heading 6, one per answer change)
 *     Still needs a person: Question 7: No answer is marked …    (Heading 6, one per problem)
 *
 * then the questions, with every line the app changed highlighted in yellow. When the app writes
 * the tab again it replaces the header, so the time stamp at the top always says when the app
 * last wrote it.
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

const HEADER_PREFIXES = [`${TAB_BASE_TITLE} —`, `${GEMINI_TAB_TITLE} —`, 'Lines the app changed', 'Lines Gemini changed', 'Check:', 'Still needs a person:']

/** A line of the app's own header, so a second reformat of the same tab does not copy it. */
export function isAppHeaderLine(text: string, heading: boolean): boolean {
  return heading && HEADER_PREFIXES.some((p) => text.trim().startsWith(p))
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
}

type Style = 'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'HEADING_3' | 'HEADING_4' | 'HEADING_5' | 'HEADING_6' | 'NORMAL_TEXT'

interface Paragraph {
  text: string
  style: Style
  highlight: boolean
}

/** A heading is written back at its own level, so quiz titles stay quiz titles. */
function styleFor(l: FixedLine): Style {
  if (!l.heading) return 'NORMAL_TEXT'
  const level = l.headingLevel ?? 6
  return level === 0 ? 'TITLE' : (`HEADING_${Math.min(6, Math.max(1, level))}` as Style)
}

function paragraphs(lines: FixedLine[], notes: HeaderNotes, when: Date, kind: TabKind): Paragraph[] {
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
    ...notes.check.map((t) => ({ text: `Check: ${t}`, style: 'HEADING_6' as const, highlight: false })),
    ...notes.needsPerson.map((t) => ({ text: `Still needs a person: ${t}`, style: 'HEADING_6' as const, highlight: false })),
    { text: '', style: 'NORMAL_TEXT', highlight: false },
  ]
  const body: Paragraph[] = lines.map((l) => ({
    text: l.text,
    style: styleFor(l),
    highlight: l.changed && l.text.trim() !== '',
  }))
  return [...header, ...body]
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
