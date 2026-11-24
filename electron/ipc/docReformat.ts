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
import { addDefaultPoints, reformatQuiz, type Change, type FixedLine, type ReformatResult } from './reformat'
import { parseQuiz } from './quizFormat'
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
export interface DocumentOptions {
  /** Points for questions that have none. Null or absent leaves them to be reported. */
  defaultPoints?: number | null
}

export function reformatDocument(
  lines: DocLine[],
  level?: number | null,
  override?: Map<number, ReformatResult>,
  options: DocumentOptions = {},
): DocumentFix {
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
    let result = override?.get(index) ?? reformatQuiz(section.lines)
    const dp = options.defaultPoints
    if (dp !== null && dp !== undefined && Number.isFinite(dp) && dp >= 0) {
      const withPoints = addDefaultPoints(result.lines, dp)
      if (withPoints.added > 0) {
        result = {
          lines: withPoints.lines,
          parsed: parseQuiz(withPoints.lines.map((l) => ({ text: l.text, bold: false, bullet: false, heading: l.heading, headingLevel: l.headingLevel }))),
          changes: [
            { kind: 'grading', question: null, message: `Gave ${withPoints.added} question${withPoints.added === 1 ? '' : 's'} with no points ${dp} ${dp === 1 ? 'point' : 'points'} each (the number you chose).` },
            ...result.changes,
          ],
        }
      }
    }
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

/**
 * Answers the app took from formatting alone, read back from the "Check:" notes at the top of a
 * Reformatted questions tab, and shown as a warning on each question.
 *
 * In the tab itself a guessed answer is an ordinary "*c)" like any other, so without this the
 * guess would stop looking like one the moment the app read the tab back. The warning stays until
 * a person deletes its "Check:" line, which is what checking it means.
 */
const GUESS_NOTE = /^Check:\s*(?:(.*?) · )?Question (\d+): (marked .+ correct, because it was the only .+ choice and no choice had an asterisk\..*)$/

export function addGuessWarnings(lines: DocLine[], quizzes: Array<{ title: string | null; result: ParseResult }>): void {
  for (const l of lines) {
    if (!l.heading) continue
    const m = l.text.trim().match(GUESS_NOTE)
    if (!m) continue
    const [, title, number, what] = m
    const quiz = title ? quizzes.find((q) => q.title === title) : quizzes.length === 1 ? quizzes[0] : undefined
    if (!quiz) continue
    const qi = quiz.result.questions.findIndex((q) => String(q.number) === number)
    if (qi === -1) continue
    quiz.result.issues.push({
      severity: 'warning',
      message: `When the app tidied this Doc, it ${what} When you have, delete the “Check:” line about it at the top of the tab.`,
      line: quiz.result.questions[qi].line,
      question: qi,
    })
  }
}
