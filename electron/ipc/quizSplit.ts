/**
 * Split a Google Doc into quizzes by its headings.
 *
 * A Doc often holds several quizzes, each under its own heading ("Module 1 Quiz", "Module 2
 * Quiz"…). The heading text becomes the quiz title. Which heading level marks a quiz is worked
 * out from the Doc: the level that sits directly above the questions. A Doc with "Heading 1:
 * Module 1" and "Heading 2: Reading Quiz" above each set of questions is split at Heading 2, and
 * the Heading 1 lines just separate them. The developer can choose another level if the guess is
 * wrong.
 *
 * Anything outside a quiz (text above the first quiz heading, a module heading, an instructions
 * section with no questions) is kept, in place, as "other" so a reformatted tab can write it back
 * exactly as it was. A Doc with no headings above its questions is one quiz.
 *
 * Pure.
 */
import { QUESTION_HEADER_RE, type DocLine } from './quizModel'

/** A line that looks like quiz content, in the template format or close to it. */
const QUESTIONISH = /^\s*(?:(?:\d{1,4}|#)\s*[).:]|(?:question|q)\s*#?\s*\d{1,4}\b|points?\s*[:=]|type\s*:)/i

export interface QuizSection {
  /** The heading's text, or null for a Doc with no quiz headings. */
  title: string | null
  heading: DocLine | null
  /** The quiz's lines, without its heading. */
  lines: DocLine[]
}

export type Segment = { kind: 'other'; lines: DocLine[] } | { kind: 'quiz'; section: QuizSection }

export interface SplitResult {
  /** The heading level quizzes were split at, or null when the Doc is one quiz. */
  level: number | null
  /** Heading levels that have questions under them: the choices to offer the developer. */
  levels: number[]
  segments: Segment[]
}

/** A real section heading: a "Question 3" heading is a question, not a section. */
const isHeading = (l: DocLine) => l.heading && (l.headingLevel ?? 0) >= 1 && !QUESTION_HEADER_RE.test(l.text.trim())

/** The heading level directly above most of the questions, or null if there is none. */
function levelsAbove(lines: DocLine[]): Map<number, number> {
  const tally = new Map<number, number>()
  let nearest: number | null = null
  for (const l of lines) {
    if (isHeading(l)) nearest = l.headingLevel!
    else if (nearest !== null && (QUESTIONISH.test(l.text) || QUESTION_HEADER_RE.test(l.text))) tally.set(nearest, (tally.get(nearest) ?? 0) + 1)
  }
  return tally
}

/**
 * A section of instructions and blank templates, as the eCampus templates have at the bottom:
 * "Instructions and Question Type Templates", "Multiple Choice Template:". Its "#) Question"
 * examples are not a quiz. The heading's whole section is kept as other text.
 */
/** A heading that names a place in the course rather than a quiz: "Module 3", "[Module #]", "Week 2". */
const PLACE_LABEL = /^\[?\s*(?:module|week|unit|chapter|lesson|part|session|topic)\b[\s#\d\]:.-]*$/i

// "Instructions and Question Type Templates", "Multiple Choice Template:", "Instructions". Not "HTML Templates Quiz".
const TEMPLATE_HEADING = /^instructions\b.*\btemplates?\b|\btemplate\s*:?\s*$|^instructions\s*:?\s*$/i

function setAsideTemplates(lines: DocLine[]): { content: DocLine[]; reference: Map<number, DocLine[]> } {
  // Lines inside a template section are pulled out, remembering where they were, so the reformatted
  // tab can write them back in the same place.
  const reference = new Map<number, DocLine[]>()
  const content: DocLine[] = []
  let inside: number | null = null // level of the template heading we are inside
  for (const l of lines) {
    const level = isHeading(l) ? l.headingLevel! : null
    if (inside !== null && level !== null && level <= inside && !TEMPLATE_HEADING.test(l.text)) inside = null
    if (inside === null && level !== null && TEMPLATE_HEADING.test(l.text)) inside = level
    if (inside !== null) {
      const at = content.length
      reference.set(at, [...(reference.get(at) ?? []), l])
    } else content.push(l)
  }
  return { content, reference }
}

export function splitDocument(allLines: DocLine[], chosenLevel?: number | null): SplitResult {
  const { content: lines, reference } = setAsideTemplates(allLines)
  const result = splitContent(lines, chosenLevel)
  if (reference.size === 0) return result
  // Put the set-aside template sections back, as other text, where they came from.
  const segments: Segment[] = []
  let index = 0
  const flush = (upTo: number) => {
    for (const [at, ls] of reference) if (at <= upTo && ls.length) {
      segments.push({ kind: 'other', lines: ls })
      reference.set(at, [])
    }
  }
  for (const seg of result.segments) {
    flush(index)
    segments.push(seg)
    index += seg.kind === 'other' ? seg.lines.length : seg.section.lines.length + (seg.section.heading ? 1 : 0)
  }
  flush(Number.MAX_SAFE_INTEGER)
  return { ...result, segments }
}

function splitContent(lines: DocLine[], chosenLevel?: number | null): SplitResult {
  const tally = levelsAbove(lines)
  const levels = [...tally.keys()].sort((a, b) => a - b)
  // Most questions sit under it; on a tie, the deeper level (closer to the questions).
  const guess = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null
  const level = chosenLevel && levels.includes(chosenLevel) ? chosenLevel : guess

  if (level === null) {
    // One quiz. A Title-style line ("COURSE 101 Module 3 Quiz") names it.
    const titleLine = lines.find((l) => l.heading && l.headingLevel === 0 && l.text.trim())
    return { level: null, levels, segments: [{ kind: 'quiz', section: { title: titleLine?.text.trim() ?? null, heading: null, lines } }] }
  }

  const segments: Segment[] = []
  let current: QuizSection | null = null
  const other = (l: DocLine) => {
    const last = segments[segments.length - 1]
    if (last?.kind === 'other') last.lines.push(l)
    else segments.push({ kind: 'other', lines: [l] })
  }

  for (const l of lines) {
    if (isHeading(l) && l.headingLevel! <= level) {
      if (l.headingLevel === level) {
        current = { title: l.text.trim(), heading: l, lines: [] }
        segments.push({ kind: 'quiz', section: current })
      } else {
        current = null // a higher heading (a module) ends the quiz above it
        other(l)
      }
      continue
    }
    if (current) current.lines.push(l)
    else other(l)
  }

  // When the heading over the questions only says where the quiz sits ("Module 3", "[Module #]",
  // "Week 2"), the heading directly above it is the quiz's title: the Extraction Template puts the
  // quiz title in Heading 1 and the module in Heading 2. Other Docs put the module in Heading 1 and
  // the quiz title in Heading 2, and keep their own titles.
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    const before = segments[i - 1]
    if (seg.kind !== 'quiz' || before.kind !== 'other' || !PLACE_LABEL.test(seg.section.title ?? '')) continue
    const above = before.lines[before.lines.length - 1]
    if (above && isHeading(above) && above.headingLevel! < level) seg.section.title = above.text.trim()
  }

  // A heading with no questions under it (an "Instructions" section) is not a quiz.
  const settled: Segment[] = []
  for (const seg of segments) {
    if (seg.kind === 'quiz' && !seg.section.lines.some((l) => QUESTIONISH.test(l.text) || QUESTION_HEADER_RE.test(l.text))) {
      const lines = [seg.section.heading!, ...seg.section.lines]
      const last = settled[settled.length - 1]
      if (last?.kind === 'other') last.lines.push(...lines)
      else settled.push({ kind: 'other', lines })
    } else settled.push(seg)
  }
  return { level, levels, segments: settled }
}

/** Just the quizzes, in order. */
export function quizSections(split: SplitResult): QuizSection[] {
  return split.segments.flatMap((s) => (s.kind === 'quiz' ? [s.section] : []))
}
