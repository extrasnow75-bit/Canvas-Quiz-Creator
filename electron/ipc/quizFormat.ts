/**
 * Reads quiz questions written in the Boise State eCampus quiz template format.
 *
 * The format, as the "Quiz Formatting Tool Example Doc" templates write it:
 *
 *     Points: 2
 *     Type: MA
 *     3) Which of these are primary colors?
 *     *a) Red
 *     b) Green
 *     *c) Blue
 *
 *   - `Points:` and `Type:` lines come BEFORE the question they belong to, in either order.
 *   - A question starts with its number and a parenthesis: `3)`. The templates write `#)`.
 *   - Choices are a letter and a parenthesis: `a)`. An asterisk directly before the letter marks a
 *     correct answer: `*a)`.
 *   - No `Type:` line means multiple choice, or true/false when the only choices are True and False.
 *   - Type codes: MA (multiple answer), E (essay / short answer), F (fill in the blank),
 *     MT (matching, `a) Answer = Match`), File (file upload), MD (multiple dropdowns),
 *     Categorize, Numeric, Text only. Ordering is accepted too, for New Quizzes.
 *   - `(manual build)` after a type is the template's note that the old generator could not build
 *     it. It is recorded, not required.
 *
 * Deliberately forgiving about the things people type differently — `1.` for `1)`, `A)` for `a)`,
 * spacing, a space between `*` and the letter — and strict about the things that change what
 * students see: which answer is correct, how many points, what type. Anything it is unsure of is
 * reported as an issue on the line it came from rather than guessed.
 *
 * Pure: no Electron, no network. The input is the document already turned into lines (docLines.ts).
 */
import type {
  Answer,
  DocLine,
  Issue,
  NumericAnswer,
  ParseResult,
  Question,
  QuestionType,
  QuizEngine,
} from './quizModel'

// ─── Line patterns ─────────────────────────────────────────────────────────────

const POINTS_RE = /^points?\s*[:=]\s*(.*)$/i
const TYPE_RE = /^(?:question\s+)?type\s*:\s*(.*)$/i
/** `3) Question`, `3. Question`, `#) Question`. */
const QUESTION_RE = /^(\d{1,4}|#)\s*[).]\s*(.*)$/
/** `a) Answer`, `*a) Answer`, `* a) Answer`, `A. Answer`. */
const ANSWER_RE = /^(\*?)\s*([a-zA-Z])\s*[).]\s+(.*)$/
/** The same, with nothing after the letter: an answer left blank. */
const EMPTY_ANSWER_RE = /^(\*?)\s*([a-zA-Z])\s*[).]\s*$/
const TEXT_TO_DISPLAY_RE = /^text\s+to\s+display\s*:\s*(.*)$/i
const DROPDOWN_VAR_RE = /^\[([^\]]+)\]$/
const DISTRACTORS_RE = /^additional\s+distractors?\s*:?\s*$/i
const CATEGORY_RE = /^([^:=]{1,80}):\s*(.*)$/
const CHOOSE_ONE_RE = /^choose\s+(?:1|one)\s*:?\s*$/i
const REQUIREMENT_RE = /^requirement\s*:\s*(.*)$/i
const KEY_VALUE_RE = /^([a-z+/\- ]+?)\s*=\s*(.*)$/i
const CALCULATOR_RE = /^show\s+(?:on[-\s]?screen\s+)?calculator\s*:?\s*(.*)$/i
const FILE_LIMIT_RE = /^limit\s+(?:the\s+)?(?:file\s+number|number\s+of\s+files)\s*:\s*(.*)$/i
const FILE_TYPES_RE = /^restrict\s+file\s+types?\s*:\s*(.*)$/i

/** Type codes and the spellings people actually use for them. Compared lower case. */
const TYPE_CODES: Record<string, QuestionType> = {
  mc: 'multiple_choice',
  'multiple choice': 'multiple_choice',
  tf: 'true_false',
  't/f': 'true_false',
  'true/false': 'true_false',
  'true false': 'true_false',
  'true or false': 'true_false',
  ma: 'multiple_answers',
  'multiple answer': 'multiple_answers',
  'multiple answers': 'multiple_answers',
  e: 'essay',
  sa: 'essay',
  essay: 'essay',
  'short answer': 'essay',
  'essay/short answer': 'essay',
  f: 'fill_in_blank',
  fib: 'fill_in_blank',
  'fill in the blank': 'fill_in_blank',
  'fill in blank': 'fill_in_blank',
  'fill-in-the-blank': 'fill_in_blank',
  mt: 'matching',
  matching: 'matching',
  file: 'file_upload',
  'file upload': 'file_upload',
  md: 'multiple_dropdowns',
  'multiple dropdowns': 'multiple_dropdowns',
  'multiple dropdown': 'multiple_dropdowns',
  dropdowns: 'multiple_dropdowns',
  categorize: 'categorization',
  categorization: 'categorization',
  numeric: 'numeric',
  numerical: 'numeric',
  ordering: 'ordering',
  order: 'ordering',
  'text only': 'text_only',
  text: 'text_only',
}

/** How the preview and messages name each type. */
export const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple choice',
  true_false: 'True/false',
  multiple_answers: 'Multiple answer',
  essay: 'Essay',
  fill_in_blank: 'Fill in the blank',
  matching: 'Matching',
  file_upload: 'File upload',
  multiple_dropdowns: 'Multiple dropdowns',
  categorization: 'Categorization',
  numeric: 'Numeric',
  ordering: 'Ordering',
  text_only: 'Text only',
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Non-breaking and zero-width spaces come in from Docs and Word and break every pattern above. */
function clean(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function parseType(raw: string): { type: QuestionType | null; manual: boolean; code: string } {
  const manual = /manual\s*build/i.test(raw)
  const code = raw.replace(/\(.*?\)/g, '').replace(/[.:]+$/, '').trim()
  return { type: TYPE_CODES[code.toLowerCase()] ?? null, manual, code }
}

/** A number, or null for a blank or the template's "#" placeholder. */
function parseNumber(raw: string): number | null {
  const m = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

function blankQuestion(line: number): Question {
  return {
    type: 'multiple_choice',
    number: null,
    points: null,
    text: '',
    answers: [],
    matches: [],
    distractors: [],
    dropdowns: [],
    categories: [],
    numeric: null,
    fileUpload: null,
    markedManualBuild: false,
    line,
  }
}

function isTrueFalsePair(answers: Answer[]): boolean {
  if (answers.length !== 2) return false
  const texts = answers.map((a) => a.text.toLowerCase().replace(/[.!]$/, '')).sort()
  return texts[0] === 'false' && texts[1] === 'true'
}

// ─── Parser ────────────────────────────────────────────────────────────────────

interface Pending {
  points: { raw: string; line: number } | null
  type: { raw: string; line: number } | null
}

interface Draft {
  q: Question
  /** The Type: line named a type; when null the type is worked out from the answers. */
  declared: QuestionType | null
  pointsRaw: string | null
  /** Text lines are still being added to the question, not yet to its answers. */
  inStem: boolean
  /**
   * Numeric: one entry per "Requirement:" line, with the "key = value" lines under it. The template
   * lists all four requirements; the one the developer filled in is the one used.
   */
  numericBlocks: Array<{ kind: string; fields: Record<string, string>; line: number }>
  /** Categorization: lines after "Additional Distractors" are distractors. */
  inDistractors: boolean
}

/**
 * Read every question in `lines`.
 *
 * Accepts plain strings too, which is what the tests and the text box use.
 */
export function parseQuiz(input: Array<DocLine | string>): ParseResult {
  const lines: DocLine[] = input.map((l) =>
    typeof l === 'string' ? { text: l, bold: false, bullet: false, heading: false } : l,
  )
  const questions: Question[] = []
  const issues: Issue[] = []
  let pending: Pending = { points: null, type: null }
  let draft: Draft | null = null

  const issue = (severity: Issue['severity'], message: string, line: number, question: number | null) =>
    issues.push({ severity, message, line, question })

  const finish = () => {
    if (!draft) return
    const index = questions.length
    questions.push(finalize(draft, (sev, msg, line) => issue(sev, msg, line, index)))
    draft = null
  }

  lines.forEach((raw, i) => {
    const text = clean(raw.text)
    if (!text) return

    // Headings are section titles ("Multiple Choice Template:", "Module 3 Quiz"), never content.
    if (raw.heading) return

    const pointsMatch = text.match(POINTS_RE)
    if (pointsMatch) {
      if (pending.points) issue('warning', 'Two Points lines in a row. The second one is used.', i, null)
      pending.points = { raw: pointsMatch[1], line: i }
      return
    }

    const typeMatch = text.match(TYPE_RE)
    if (typeMatch) {
      if (pending.type) issue('warning', 'Two Type lines in a row. The second one is used.', i, null)
      pending.type = { raw: typeMatch[1], line: i }
      return
    }

    // A text-only item has no number: the template writes "Type: Text only" then "Text to display:".
    const displayMatch = text.match(TEXT_TO_DISPLAY_RE)
    if (displayMatch && (!draft || draft.declared !== 'text_only' || pending.type)) {
      finish()
      pending.type ??= { raw: 'Text only', line: i }
      draft = startQuestion(i, ['', '#', displayMatch[1]] as unknown as RegExpMatchArray, pending, (sev, msg, line) =>
        issue(sev, msg, line, questions.length),
      )
      if (draft.declared !== 'text_only') draft.declared = 'text_only'
      pending = { points: null, type: null }
      return
    }

    const questionMatch = text.match(QUESTION_RE)
    if (questionMatch) {
      finish()
      draft = startQuestion(i, questionMatch, pending, (sev, msg, line) => issue(sev, msg, line, questions.length))
      pending = { points: null, type: null }
      return
    }

    if (!draft) {
      // Text before the first question: instructions, a title, notes to the developer. Not quiz content.
      return
    }

    absorbLine(draft, text, raw, i, (sev, msg, line) => issue(sev, msg, line, questions.length))
  })

  finish()

  if (pending.points || pending.type) {
    const at = (pending.type ?? pending.points)!.line
    issue('warning', 'This Points or Type line comes after the last question, so it belongs to no question.', at, null)
  }
  if (questions.length === 0) {
    issue(
      'error',
      'No questions found. Each question needs a number and a parenthesis in front of it, like "1) What is…".',
      0,
      null,
    )
  }

  return { questions, issues }
}

type Report = (severity: Issue['severity'], message: string, line: number) => void

function startQuestion(i: number, m: RegExpMatchArray, pending: Pending, report: Report): Draft {
  const q = blankQuestion(i)
  q.number = m[1] === '#' ? null : Number(m[1])
  q.text = m[2]

  let declared: QuestionType | null = null
  if (pending.type) {
    const parsed = parseType(pending.type.raw)
    q.markedManualBuild = parsed.manual
    if (parsed.type) declared = parsed.type
    else
      report(
        'error',
        `"Type: ${parsed.code}" is not a question type the app knows. ` +
          'Use MA, E, F, MT, File, MD, Categorize, Numeric, Ordering or Text only, or remove the line for multiple choice.',
        pending.type.line,
      )
  }

  return {
    q,
    declared,
    pointsRaw: pending.points ? pending.points.raw : null,
    inStem: true,
    numericBlocks: [],
    inDistractors: false,
  }
}

function absorbLine(draft: Draft, text: string, raw: DocLine, i: number, report: Report): void {
  const { q, declared } = draft

  // Type-specific blocks first: their lines would otherwise read as question text.
  switch (declared) {
    case 'text_only': {
      const m = text.match(TEXT_TO_DISPLAY_RE)
      q.text = m ? joinText(q.text, m[1]) : joinText(q.text, text)
      return
    }
    case 'multiple_dropdowns': {
      const v = text.match(DROPDOWN_VAR_RE)
      if (v) {
        draft.inStem = false
        q.dropdowns.push({ variable: v[1].trim(), options: [] })
        return
      }
      if (!draft.inStem) {
        const current = q.dropdowns[q.dropdowns.length - 1]
        const starred = text.startsWith('*')
        current.options.push({ text: text.replace(/^\*\s*/, ''), correct: starred })
        return
      }
      break
    }
    case 'categorization': {
      if (DISTRACTORS_RE.test(text)) {
        draft.inStem = false
        draft.inDistractors = true
        return
      }
      if (draft.inDistractors) {
        q.distractors.push(stripBullet(text))
        return
      }
      const c = text.match(CATEGORY_RE)
      if (c && !raw.bullet) {
        draft.inStem = false
        q.categories.push({ name: c[1].trim(), description: c[2].trim(), items: [] })
        return
      }
      if (!draft.inStem) {
        q.categories[q.categories.length - 1].items.push(stripBullet(text))
        return
      }
      break
    }
    case 'numeric': {
      if (CHOOSE_ONE_RE.test(text)) {
        draft.inStem = false
        return
      }
      const r = text.match(REQUIREMENT_RE)
      if (r) {
        draft.inStem = false
        draft.numericBlocks.push({ kind: r[1].trim().toLowerCase(), fields: {}, line: i })
        return
      }
      const kv = text.match(KEY_VALUE_RE)
      if (kv && draft.numericBlocks.length > 0) {
        draft.numericBlocks[draft.numericBlocks.length - 1].fields[kv[1].trim().toLowerCase()] = kv[2].trim()
        return
      }
      break
    }
    case 'file_upload': {
      const calc = text.match(CALCULATOR_RE)
      const limit = text.match(FILE_LIMIT_RE)
      const types = text.match(FILE_TYPES_RE)
      if (calc || limit || types) {
        draft.inStem = false
        q.fileUpload ??= { showCalculator: false, fileLimit: null, fileTypes: [] }
        if (calc) q.fileUpload.showCalculator = !/^(no|false|off)$/i.test(calc[1].trim())
        if (limit) q.fileUpload.fileLimit = parseNumber(limit[1])
        if (types)
          q.fileUpload.fileTypes = types[1]
            .split(/[,;\s]+/)
            .map((t) => t.replace(/^\./, '').toLowerCase())
            .filter(Boolean)
        return
      }
      break
    }
  }

  const answer = text.match(ANSWER_RE)
  if (answer) {
    draft.inStem = false
    let body = answer[3].trim()
    let correct = answer[1] === '*'
    // "a) *Answer" or "a)* Answer": the asterisk is on the wrong side of the letter.
    if (!correct && body.startsWith('*')) {
      correct = true
      body = body.replace(/^\*\s*/, '')
      report('warning', 'The * is after the letter. It is read as marking the correct answer; the template puts it before the letter, like *a).', i)
    }
    q.answers.push({ text: body, correct })
    return
  }

  if (EMPTY_ANSWER_RE.test(text)) {
    draft.inStem = false
    report('error', 'This answer choice is empty.', i)
    return
  }

  if (draft.inStem) {
    q.text = joinText(q.text, text)
    return
  }

  report('warning', `This line was not understood and was left out: "${shorten(text)}"`, i)
}

function hasNumericValues(fields: Record<string, string>): boolean {
  return Object.values(fields).some((v) => parseNumber(v) !== null)
}

function stripBullet(text: string): string {
  return text.replace(/^[•●○■\-–]\s*/, '').trim()
}

function joinText(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return `${a}\n${b}`
}

function shorten(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

// ─── Finishing a question: settle its type and check it ────────────────────────

function finalize(draft: Draft, report: Report): Question {
  const { q, declared } = draft
  const at = q.line

  // Points.
  if (draft.pointsRaw === null) {
    if (declared !== 'text_only') report('warning', 'No Points line. It will be worth 1 point.', at)
  } else {
    const n = parseNumber(draft.pointsRaw)
    if (n === null) {
      if (declared !== 'text_only')
        report('warning', `Points says "${draft.pointsRaw.trim() || '(blank)'}", which is not a number. It will be worth 1 point.`, at)
    } else if (n < 0) {
      report('error', 'Points cannot be negative.', at)
    } else {
      q.points = n
    }
  }

  // Type: as declared, otherwise multiple choice or true/false from the answers.
  if (declared) q.type = declared
  else q.type = isTrueFalsePair(q.answers) ? 'true_false' : 'multiple_choice'

  const stem = q.text.trim()
  if (!stem || /^question(?: or statement)?$/i.test(stem)) {
    if (q.type !== 'text_only') report(stem ? 'warning' : 'error', stem ? 'The question still says "Question" from the template.' : 'This question has no question text.', at)
  }

  const correct = q.answers.filter((a) => a.correct).length

  switch (q.type) {
    case 'multiple_choice':
      if (q.answers.length === 0) {
        report('error', 'No answer choices were found. Add choices like "*a) …", or add "Type: E" above the question for an essay.', at)
      } else {
        if (q.answers.length < 2) report('error', 'Multiple choice needs at least two choices.', at)
        if (correct === 0) report('error', 'No answer is marked correct. Put * directly before the letter of the correct answer, like *b).', at)
        if (correct > 1) report('error', `${correct} answers are marked correct. For more than one correct answer, add "Type: MA" above the question.`, at)
      }
      break

    case 'true_false':
      if (!isTrueFalsePair(q.answers)) report('error', 'True/false needs exactly two choices: True and False.', at)
      else if (correct !== 1) report('error', 'Mark exactly one of True or False as correct with *.', at)
      break

    case 'multiple_answers':
      if (q.answers.length < 2) report('error', 'Multiple answer needs at least two choices.', at)
      if (correct === 0) report('error', 'No answer is marked correct. Put * before the letter of each correct answer.', at)
      break

    case 'essay':
    case 'file_upload':
      if (q.answers.length > 0) report('warning', `${TYPE_LABELS[q.type]} questions have no answer choices, so the ${q.answers.length} listed will be left out.`, at)
      q.answers = []
      if (q.type === 'file_upload') q.fileUpload ??= { showCalculator: false, fileLimit: null, fileTypes: [] }
      break

    case 'fill_in_blank':
      // Every listed variation is an accepted answer; the * is not needed here.
      q.answers = q.answers.map((a) => ({ ...a, correct: true }))
      if (q.answers.length === 0) report('error', 'Fill in the blank needs at least one accepted answer, like "a) photosynthesis".', at)
      break

    case 'matching': {
      for (const a of q.answers) {
        const eq = a.text.indexOf('=')
        if (eq === -1) {
          report('error', `"${shorten(a.text)}" has no "=". Write matching pairs as "a) Answer = Match".`, at)
          continue
        }
        const left = a.text.slice(0, eq).trim()
        const right = a.text.slice(eq + 1).trim()
        if (!right) report('error', `"${shorten(a.text)}" has nothing after the "=".`, at)
        else if (!left) q.distractors.push(right)
        else q.matches.push({ left, right })
      }
      q.answers = []
      if (q.matches.length === 0) report('error', 'Matching needs at least one pair, like "a) Answer = Match".', at)
      break
    }

    case 'ordering':
      q.answers = q.answers.map((a) => ({ ...a, correct: true }))
      if (q.answers.length < 2) report('error', 'Ordering needs at least two items, listed in the correct order.', at)
      break

    case 'multiple_dropdowns':
      checkDropdowns(q, report)
      break

    case 'categorization':
      checkCategories(q, report)
      break

    case 'numeric':
      q.numeric = buildNumeric(draft, report)
      break

    case 'text_only':
      q.points = 0
      q.answers = []
      if (!q.text.trim()) report('error', 'Text only needs something after "Text to display:".', at)
      break
  }

  return q
}

function checkDropdowns(q: Question, report: Report): void {
  const at = q.line
  if (q.dropdowns.length === 0) {
    report('error', 'Multiple dropdowns needs at least one [Variable] line followed by its options.', at)
    return
  }
  for (const d of q.dropdowns) {
    if (d.options.length < 2) report('error', `[${d.variable}] needs at least two options.`, at)
    // The template lists the correct answer first. A * anywhere overrides that.
    if (!d.options.some((o) => o.correct) && d.options.length > 0) d.options[0].correct = true
    if (d.options.filter((o) => o.correct).length > 1) report('error', `[${d.variable}] has more than one option marked correct.`, at)
    if (!q.text.includes(`[${d.variable}]`))
      report('warning', `The question text does not contain [${d.variable}], so students will not see where that dropdown goes.`, at)
  }
}

function checkCategories(q: Question, report: Report): void {
  const at = q.line
  if (q.categories.length === 0) {
    report('error', 'Categorization needs at least one "Category name: description" line followed by its answers.', at)
    return
  }
  for (const c of q.categories) {
    if (c.items.length === 0) report('error', `Category "${c.name}" has no answers under it.`, at)
  }
}

function buildNumeric(draft: Draft, report: Report): NumericAnswer | null {
  const at = draft.q.line
  const filled = draft.numericBlocks.filter((b) => hasNumericValues(b.fields))
  if (filled.length > 1) {
    report('error', 'More than one numeric requirement is filled in. Fill in one, and leave the others blank or delete them.', at)
    return null
  }
  const kind = filled[0]?.kind ?? ''
  const f = filled[0]?.fields ?? {}
  const num = (key: string) => parseNumber(f[key] ?? '')

  if (/exact/.test(kind)) {
    const value = num('answer')
    if (value !== null) return { kind: 'exact', value }
  } else if (/margin/.test(kind)) {
    const value = num('answer')
    const margin = num('+/-')
    if (value !== null && margin !== null)
      return { kind: 'margin', value, margin, marginType: /percent|%/i.test(f['type'] ?? '') ? 'percent' : 'absolute' }
  } else if (/range/.test(kind)) {
    const start = num('range start')
    const end = num('range end')
    if (start !== null && end !== null) {
      if (start > end) report('error', 'Range start is larger than range end.', at)
      return { kind: 'range', start, end }
    }
  } else if (/precis/.test(kind)) {
    const value = num('answer')
    const precision = num('precision')
    if (value !== null && precision !== null)
      return { kind: 'precision', value, precision, precisionType: /signif/i.test(f['type'] ?? '') ? 'significant' : 'decimals' }
  }
  report('error', 'Numeric needs one filled-in requirement: an exact answer, a margin of error, a range, or a precise response.', at)
  return null
}

// ─── Quiz engine compatibility ─────────────────────────────────────────────────

/** Types each engine can hold. Matches what Canvas offers when building a question by hand. */
const SUPPORTED: Record<QuizEngine, Set<QuestionType>> = {
  classic: new Set<QuestionType>([
    'multiple_choice',
    'true_false',
    'multiple_answers',
    'essay',
    'fill_in_blank',
    'matching',
    'file_upload',
    'multiple_dropdowns',
    'numeric',
    'text_only',
  ]),
  new: new Set<QuestionType>([
    'multiple_choice',
    'true_false',
    'multiple_answers',
    'essay',
    'fill_in_blank',
    'matching',
    'file_upload',
    'categorization',
    'numeric',
    'ordering',
    'text_only',
  ]),
}

const ENGINE_NAMES: Record<QuizEngine, string> = { classic: 'Classic Quizzes', new: 'New Quizzes' }

/** Problems that depend on which engine the quiz is going to. */
export function engineIssues(questions: Question[], engine: QuizEngine): Issue[] {
  const out: Issue[] = []
  questions.forEach((q, index) => {
    if (!SUPPORTED[engine].has(q.type)) {
      const other: QuizEngine = engine === 'classic' ? 'new' : 'classic'
      out.push({
        severity: 'error',
        message: `${ENGINE_NAMES[engine]} has no ${TYPE_LABELS[q.type].toLowerCase()} questions. Choose ${ENGINE_NAMES[other]}, or change this question's type.`,
        line: q.line,
        question: index,
      })
    }
  })
  return out
}
