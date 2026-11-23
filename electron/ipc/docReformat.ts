/**
 * Reformat a whole Doc, one quiz at a time.
 *
 * The Doc is split into quizzes by its headings (quizSplit.ts) and each quiz is reformatted on its
 * own, so an answer key at the end of one quiz is used for that quiz only and question numbers can
 * start again at 1 in each. Headings and anything outside a quiz are written back as they were.
 *
 * Pure.
 */
import type { DocLine, ParseResult } from './quizModel'
import { reformatQuiz, type Change, type FixedLine, type ReformatResult } from './reformat'
import { splitDocument, type SplitResult } from './quizSplit'

export interface QuizFix {
  title: string | null
  /** The quiz's lines as they are now, and as the automatic fixes would leave them. */
  source: DocLine[]
  result: ReformatResult
}

export interface DocumentFix {
  split: SplitResult
  quizzes: QuizFix[]
  /** Every line of the reformatted Doc, quizzes and the text between them, in order. */
  lines: FixedLine[]
  /** All changes, each prefixed with its quiz's title when the Doc has several. */
  changes: Change[]
}

const keep = (l: DocLine): FixedLine => ({ text: l.text, changed: false, heading: l.heading, headingLevel: l.headingLevel })

/** `override` replaces one quiz's result (Gemini's pass over a quiz the rules could not fix). */
export function reformatDocument(lines: DocLine[], level?: number | null, override?: Map<number, ReformatResult>): DocumentFix {
  const split = splitDocument(lines, level)
  const quizzes: QuizFix[] = []
  const out: FixedLine[] = []
  const changes: Change[] = []
  const several = split.segments.filter((s) => s.kind === 'quiz').length > 1

  for (const seg of split.segments) {
    if (seg.kind === 'other') {
      out.push(...seg.lines.map(keep))
      continue
    }
    const { section } = seg
    const index = quizzes.length
    const result = override?.get(index) ?? reformatQuiz(section.lines)
    quizzes.push({ title: section.title, source: section.lines, result })
    if (section.heading) {
      if (out.length > 0) out.push({ text: '', changed: false, heading: false })
      out.push(keep(section.heading))
    }
    out.push(...result.lines)
    const prefix = several && section.title ? `${section.title} · ` : ''
    changes.push(...result.changes.map((c) => ({ ...c, message: prefix + c.message })))
  }
  return { split, quizzes, lines: out, changes }
}

/** A quiz's problems, phrased for a person, with its title in front when the Doc has several. */
export function problemsOf(title: string | null, parsed: ParseResult, several: boolean): string[] {
  const prefix = several && title ? `${title} · ` : ''
  return parsed.issues
    .filter((i) => i.severity === 'error')
    .map((i) => {
      const q = i.question !== null ? parsed.questions[i.question] : null
      return `${prefix}${q ? `Question ${q.number ?? i.question! + 1}: ` : ''}${i.message}`
    })
}
