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
import type { DocLine } from './quizModel'

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

const isHeading = (l: DocLine) => l.heading && (l.headingLevel ?? 0) >= 1

/** The heading level directly above most of the questions, or null if there is none. */
function levelsAbove(lines: DocLine[]): Map<number, number> {
  const tally = new Map<number, number>()
  let nearest: number | null = null
  for (const l of lines) {
    if (isHeading(l)) nearest = l.headingLevel!
    else if (nearest !== null && QUESTIONISH.test(l.text)) tally.set(nearest, (tally.get(nearest) ?? 0) + 1)
  }
  return tally
}

export function splitDocument(lines: DocLine[], chosenLevel?: number | null): SplitResult {
  const tally = levelsAbove(lines)
  const levels = [...tally.keys()].sort((a, b) => a - b)
  // Most questions sit under it; on a tie, the deeper level (closer to the questions).
  const guess = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null
  const level = chosenLevel && levels.includes(chosenLevel) ? chosenLevel : guess

  if (level === null) {
    return { level: null, levels, segments: [{ kind: 'quiz', section: { title: null, heading: null, lines } }] }
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

  // A heading with no questions under it (an "Instructions" section) is not a quiz.
  const settled: Segment[] = []
  for (const seg of segments) {
    if (seg.kind === 'quiz' && !seg.section.lines.some((l) => !l.heading && QUESTIONISH.test(l.text))) {
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
