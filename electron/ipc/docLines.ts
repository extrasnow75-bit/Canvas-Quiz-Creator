/**
 * Turn a Google Doc, as the Docs API returns it, into the lines the quiz parser reads.
 *
 * Why the Docs API and not Drive's plain-text export: the export does not reliably keep what
 * Google Docs' automatic numbering shows on screen. A faculty member who typed "1." and let Docs
 * turn it into a numbered list sees "1." — but the characters are not in the document, only a
 * list setting is. The Docs API reports that setting (list id, nesting level, number style), so
 * the number can be worked out here exactly as Docs draws it. The same goes for bullets, bold
 * text, headings, and the document's tabs, which the eCampus template uses.
 *
 * Soft line breaks (Shift+Enter, "\v" in the API) split one paragraph into several lines: the
 * template has "Points: #" and "Type: E" in one paragraph that way.
 *
 * Pure: takes the parsed JSON, returns lines. Fetching the document is googleDocs.ts.
 */
import type { DocLine } from './quizModel'

// The parts of the Docs API response this reads. Everything else is ignored.
interface TextRun {
  content?: string
  textStyle?: { bold?: boolean; underline?: boolean; backgroundColor?: { color?: { rgbColor?: { red?: number; green?: number; blue?: number } } } }
}
interface ParagraphElement {
  textRun?: TextRun
}
interface Paragraph {
  elements?: ParagraphElement[]
  bullet?: { listId?: string; nestingLevel?: number }
  paragraphStyle?: { namedStyleType?: string }
}
interface StructuralElement {
  paragraph?: Paragraph
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: StructuralElement[] }> }> }
}
interface NestingLevel {
  glyphType?: string
  glyphFormat?: string
  glyphSymbol?: string
  startNumber?: number
}
interface DocumentTab {
  body?: { content?: StructuralElement[] }
  lists?: Record<string, { listProperties?: { nestingLevels?: NestingLevel[] } }>
}
export interface DocsTab {
  tabProperties?: { tabId?: string; title?: string; index?: number }
  documentTab?: DocumentTab
  childTabs?: DocsTab[]
}
export interface DocsDocument {
  title?: string
  /** Changes with every edit, by anyone: how the app tells its own last write from a later one. */
  revisionId?: string
  tabs?: DocsTab[]
  /** Present when the document is fetched without includeTabsContent. */
  body?: { content?: StructuralElement[] }
  lists?: DocumentTab['lists']
}

export interface TabInfo {
  id: string
  title: string
  /** Nesting depth, for tabs inside tabs. */
  depth: number
}

/** Every tab in the document, in order, children after their parent. */
/**
 * A highlight colour that means something in eCampus's own workflow, not an answer, so it never
 * marks a choice correct. Light green is QA's "ready for Canvas" mark (Blueprint Tools), and
 * purple is how this app's own "Revised by Gemini" tab, and other tools, mark changed lines.
 * Google's palette leaves no doubt between these and yellow: green has more green than red or
 * blue, purple more blue than green with at least as much red.
 */
export function isWorkflowColor(rgb?: { red?: number; green?: number; blue?: number }): boolean {
  const r = rgb?.red ?? 0
  const g = rgb?.green ?? 0
  const b = rgb?.blue ?? 0
  const green = g > r + 0.04 && g > b + 0.04
  const purple = b > g + 0.04 && r >= g
  return green || purple
}

export function listTabs(doc: DocsDocument): TabInfo[] {
  const out: TabInfo[] = []
  const walk = (tabs: DocsTab[] | undefined, depth: number) => {
    for (const t of tabs ?? []) {
      out.push({ id: t.tabProperties?.tabId ?? '', title: t.tabProperties?.title ?? 'Untitled tab', depth })
      walk(t.childTabs, depth + 1)
    }
  }
  walk(doc.tabs, 0)
  return out
}

function findTab(tabs: DocsTab[] | undefined, id: string): DocsTab | null {
  for (const t of tabs ?? []) {
    if (t.tabProperties?.tabId === id) return t
    const inner = findTab(t.childTabs, id)
    if (inner) return inner
  }
  return null
}

// ─── List numbering ────────────────────────────────────────────────────────────

function toAlpha(n: number): string {
  let s = ''
  while (n > 0) {
    n--
    s = String.fromCharCode(97 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}

function toRoman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ]
  let s = ''
  for (const [v, r] of table) while (n >= v) { s += r; n -= v }
  return s
}

/** The marker for item `n` (1-based) of a numbered level, or null for a bullet level. */
function formatCounter(n: number, glyphType: string | undefined): string | null {
  switch (glyphType) {
    case 'DECIMAL': return String(n)
    case 'ZERO_DECIMAL': return String(n).padStart(2, '0')
    case 'ALPHA': return toAlpha(n)
    case 'UPPER_ALPHA': return toAlpha(n).toUpperCase()
    case 'ROMAN': return toRoman(n)
    case 'UPPER_ROMAN': return toRoman(n).toUpperCase()
    default: return null // GLYPH_TYPE_UNSPECIFIED, NONE, or a bullet symbol
  }
}

/**
 * Builds the visible marker for each list paragraph, the way Google Docs numbers them: a counter
 * per list and level that carries on across ordinary paragraphs between items, restarts deeper
 * levels when a shallower item appears, and is written through the level's glyph format
 * ("%0." → "3.", "%1)" → "c)").
 */
class ListCounter {
  private counts = new Map<string, number[]>()

  constructor(private lists: DocumentTab['lists']) {}

  marker(listId: string, level: number): { text: string; bullet: boolean } {
    const levels = this.lists?.[listId]?.listProperties?.nestingLevels ?? []
    const def = levels[level] ?? {}
    const counts = this.counts.get(listId) ?? []
    counts.length = Math.max(counts.length, level + 1)
    const start = def.startNumber ?? 1
    counts[level] = (counts[level] ?? start - 1) + 1
    for (let deeper = level + 1; deeper < counts.length; deeper++) counts[deeper] = undefined as unknown as number
    this.counts.set(listId, counts)

    const value = formatCounter(counts[level], def.glyphType)
    if (value === null) return { text: '', bullet: true }

    // glyphFormat names levels as %0, %1…; a multi-level format like "%0.%1." is honoured too.
    const format = def.glyphFormat && /%\d/.test(def.glyphFormat) ? def.glyphFormat : `%${level}.`
    const text = format.replace(/%(\d)/g, (_m, d: string) => {
      const l = Number(d)
      if (l === level) return value
      const parent = formatCounter(counts[l] ?? 1, levels[l]?.glyphType)
      return parent ?? ''
    })
    return { text, bullet: false }
  }
}

// ─── Paragraphs to lines ───────────────────────────────────────────────────────

function paragraphsOf(content: StructuralElement[] | undefined): Paragraph[] {
  const out: Paragraph[] = []
  for (const el of content ?? []) {
    if (el.paragraph) out.push(el.paragraph)
    // Questions are sometimes laid out in a table; read its cells in order rather than lose them.
    else if (el.table)
      for (const row of el.table.tableRows ?? [])
        for (const cell of row.tableCells ?? []) out.push(...paragraphsOf(cell.content))
  }
  return out
}

function linesFromBody(content: StructuralElement[] | undefined, lists: DocumentTab['lists']): DocLine[] {
  const counter = new ListCounter(lists)
  const lines: DocLine[] = []

  for (const p of paragraphsOf(content)) {
    const runs = (p.elements ?? []).map((e) => e.textRun).filter((r): r is TextRun => !!r?.content)
    const style = p.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT'
    const heading = style === 'TITLE' || style === 'SUBTITLE' || style.startsWith('HEADING_')
    const headingLevel = style.startsWith('HEADING_') ? Number(style.slice(8)) || 6 : heading ? 0 : undefined

    let prefix = ''
    let bullet = false
    if (p.bullet?.listId) {
      const m = counter.marker(p.bullet.listId, p.bullet.nestingLevel ?? 0)
      prefix = m.text ? `${m.text} ` : ''
      bullet = m.bullet
    }

    // Split on soft line breaks, tracking bold per piece.
    let pieces: Array<{ text: string; boldChars: number; markChars: number; underChars: number; chars: number }> = [{ text: '', boldChars: 0, markChars: 0, underChars: 0, chars: 0 }]
    for (const run of runs) {
      const parts = (run.content ?? '').replace(/\n$/, '').split('\v')
      parts.forEach((part, idx) => {
        if (idx > 0) pieces.push({ text: '', boldChars: 0, markChars: 0, underChars: 0, chars: 0 })
        const cur = pieces[pieces.length - 1]
        cur.text += part
        const visible = part.replace(/\s/g, '').length
        cur.chars += visible
        if (run.textStyle?.bold) cur.boldChars += visible
        if (run.textStyle?.backgroundColor?.color && !isWorkflowColor(run.textStyle.backgroundColor.color.rgbColor)) cur.markChars += visible
        if (run.textStyle?.underline) cur.underChars += visible
      })
    }
    pieces = pieces.length ? pieces : [{ text: '', boldChars: 0, markChars: 0, underChars: 0, chars: 0 }]

    pieces.forEach((piece, idx) => {
      lines.push({
        // The list marker belongs to the first line of the paragraph only.
        text: (idx === 0 ? prefix : '') + piece.text,
        // "All of it" allows for an unformatted choice letter: "b) " + bold "Paris" counts as bold.
        bold: piece.boldChars > 0 && piece.boldChars >= piece.chars - 3,
        highlighted: piece.markChars > 0 && piece.markChars >= piece.chars - 3,
        underlined: piece.underChars > 0 && piece.underChars >= piece.chars - 3,
        bullet: bullet && idx === 0,
        heading,
        ...(headingLevel !== undefined ? { headingLevel } : {}),
      })
    })
  }
  return lines
}

/**
 * The lines of one tab, or of the first tab when `tabId` is omitted. Also accepts a document
 * fetched without tabs content (a single body at the top level).
 */
export function docToLines(doc: DocsDocument, tabId?: string): DocLine[] {
  if (doc.tabs?.length) {
    const tab = tabId ? findTab(doc.tabs, tabId) : doc.tabs[0]
    if (!tab?.documentTab) return []
    return linesFromBody(tab.documentTab.body?.content, tab.documentTab.lists)
  }
  return linesFromBody(doc.body?.content, doc.lists)
}
