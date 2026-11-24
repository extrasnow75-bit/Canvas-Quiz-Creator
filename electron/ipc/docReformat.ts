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
import { NOTES_TITLE, notesStart } from './docsWrite'

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
 * Answers the app took from formatting alone, read back from the "Check:" notes in a Reformatted
 * questions tab, and shown as a warning on each question.
 *
 * In the tab itself a guessed answer is an ordinary "*c)" like any other, so without this the
 * guess would stop looking like one the moment the app read the tab back. The warning stays until
 * a person deletes its "Check:" note, which is what checking it means.
 *
 * The notes are under "Notes from the app" at the end of the tab, with each quiz's title as a
 * heading above its notes. Tabs written before v0.2.2 have them as headings at the top instead,
 * each with its quiz's title in front ("Check: Quiz 2 · Question 1: …"). Both are read.
 */
const GUESS_NOTE = /^Check:\s*(?:(.*?) · )?Questions? ([\d–, ]+): (marked .+ correct, because it was the only .+ choice and no choice had an asterisk\..*)$/

/** [1, 2, 3, 5] from "1–3, 5". */
function numbersIn(list: string): number[] {
  return list.split(',').flatMap((part) => {
    const [a, b] = part.split('–').map((x) => Number(x.trim()))
    if (!Number.isFinite(a)) return []
    if (b === undefined || !Number.isFinite(b) || b < a) return [a]
    return Array.from({ length: b - a + 1 }, (_, k) => a + k)
  })
}

export function addGuessWarnings(lines: DocLine[], quizzes: Array<{ title: string | null; result: ParseResult }>): void {
  const notesAt = notesStart(lines)
  let titleAbove: string | null = null
  lines.forEach((l, at) => {
    const inNotes = notesAt !== -1 && at > notesAt
    if (inNotes && l.heading) {
      titleAbove = l.text.trim()
      return
    }
    // Old tabs: headings at the top. New tabs: ordinary lines under "Notes from the app".
    if (inNotes ? false : !l.heading) return
    const m = l.text.trim().match(GUESS_NOTE)
    if (!m) return
    const [, titleInLine, numbers, what] = m
    const title = titleInLine ?? (inNotes ? titleAbove : null)
    const quiz = title ? quizzes.find((q) => q.title === title) : quizzes.length === 1 ? quizzes[0] : undefined
    if (!quiz) return
    const where = inNotes ? `under “${NOTES_TITLE}” at the end of the tab` : 'at the top of the tab'
    for (const n of numbersIn(numbers)) {
      const qi = quiz.result.questions.findIndex((q) => String(q.number) === String(n))
      if (qi === -1) continue
      quiz.result.issues.push({
        severity: 'warning',
        message: `When the app tidied this Doc, it ${what} When you have, delete the “Check:” note about it ${where}.`,
        line: quiz.result.questions[qi].line,
        question: qi,
      })
    }
  })
}
