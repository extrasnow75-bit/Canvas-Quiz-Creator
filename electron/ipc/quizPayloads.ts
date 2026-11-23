/**
 * Turns parsed questions into the request bodies Canvas expects, for both quiz engines.
 *
 * Classic Quizzes and New Quizzes are two separate products with two separate APIs:
 *
 *   Classic:  POST /api/v1/courses/:course/quizzes                    { quiz: {...} }
 *             POST /api/v1/courses/:course/quizzes/:quiz/questions     { question: {...} }
 *   New:      POST /api/quiz/v1/courses/:course/quizzes                { quiz: {...} }
 *             POST /api/quiz/v1/courses/:course/quizzes/:quiz/items    { item: {...} }
 *
 * The New Quizzes item shapes follow Instructure's "New Quiz Items" API documentation. They are
 * the part of this app most likely to need adjusting after testing in a sandbox course, which is
 * why they are built here, in one pure and tested place, rather than inline where the requests
 * are sent.
 *
 * Pure: no network, no Electron. `newId` is injected so tests get stable ids.
 */
import type { NumericAnswer, Question, QuizEngine } from './quizModel'

export interface QuizSettings {
  title: string
  /** Shown to students above the questions. Plain text. */
  description: string
}

// ─── Text ──────────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Question text to HTML: one paragraph per line, everything escaped. */
export function toHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

/** The points a question is worth in Canvas: what the document said, else 1 (0 for text only). */
export function pointsFor(q: Question): number {
  if (q.type === 'text_only') return 0
  return q.points ?? 1
}

export function questionTitle(q: Question, index: number): string {
  return `Question ${q.number ?? index + 1}`
}

// ─── Classic Quizzes ───────────────────────────────────────────────────────────

export function classicQuizBody(s: QuizSettings) {
  return {
    quiz: {
      title: s.title,
      description: s.description ? toHtml(s.description) : '',
      quiz_type: 'assignment',
      // Always created unpublished: the developer checks it in Canvas before students can see it.
      published: false,
    },
  }
}

const CLASSIC_TYPES: Partial<Record<Question['type'], string>> = {
  multiple_choice: 'multiple_choice_question',
  true_false: 'true_false_question',
  multiple_answers: 'multiple_answers_question',
  essay: 'essay_question',
  fill_in_blank: 'short_answer_question',
  matching: 'matching_question',
  file_upload: 'file_upload_question',
  multiple_dropdowns: 'multiple_dropdowns_question',
  numeric: 'numerical_question',
  text_only: 'text_only_question',
}

function classicNumeric(n: NumericAnswer): Record<string, unknown> {
  switch (n.kind) {
    case 'exact':
      return { numerical_answer_type: 'exact_answer', answer_exact: n.value, answer_error_margin: 0, answer_weight: 100 }
    case 'margin': {
      // Classic has no percentage margin: turn it into the same distance either side.
      const margin = n.marginType === 'percent' ? Math.abs((n.value * n.margin) / 100) : n.margin
      return { numerical_answer_type: 'exact_answer', answer_exact: n.value, answer_error_margin: margin, answer_weight: 100 }
    }
    case 'range':
      return { numerical_answer_type: 'range_answer', answer_range_start: n.start, answer_range_end: n.end, answer_weight: 100 }
    case 'precision':
      if (n.precisionType === 'significant')
        return { numerical_answer_type: 'precision_answer', answer_approximate: n.value, answer_precision: n.precision, answer_weight: 100 }
      // Decimal places: anything that rounds to the value at that many places.
      return {
        numerical_answer_type: 'range_answer',
        answer_range_start: n.value - 0.5 * 10 ** -n.precision,
        answer_range_end: n.value + 0.5 * 10 ** -n.precision,
        answer_weight: 100,
      }
  }
}

export function classicQuestionBody(q: Question, index: number) {
  const type = CLASSIC_TYPES[q.type]
  if (!type) throw new Error(`Classic Quizzes cannot hold a ${q.type} question.`)

  const question: Record<string, unknown> = {
    question_name: questionTitle(q, index),
    question_text: toHtml(q.text),
    question_type: type,
    points_possible: pointsFor(q),
    position: index + 1,
  }

  switch (q.type) {
    case 'multiple_choice':
    case 'multiple_answers':
    case 'true_false':
      question.answers = q.answers.map((a) => ({ answer_text: a.text, answer_weight: a.correct ? 100 : 0 }))
      break
    case 'fill_in_blank':
      question.answers = q.answers.map((a) => ({ answer_text: a.text, answer_weight: 100 }))
      break
    case 'matching':
      question.answers = q.matches.map((m) => ({ answer_match_left: m.left, answer_match_right: m.right, answer_weight: 100 }))
      if (q.distractors.length) question.matching_answer_incorrect_matches = q.distractors.join('\n')
      break
    case 'multiple_dropdowns':
      question.answers = q.dropdowns.flatMap((d) =>
        d.options.map((o) => ({ blank_id: d.variable, answer_text: o.text, answer_weight: o.correct ? 100 : 0 })),
      )
      break
    case 'numeric':
      question.answers = q.numeric ? [classicNumeric(q.numeric)] : []
      break
    default:
      break // essay, file upload, text only: no answers
  }

  return { question }
}

// ─── New Quizzes ───────────────────────────────────────────────────────────────

export function newQuizBody(s: QuizSettings) {
  return {
    quiz: {
      title: s.title,
      instructions: s.description ? toHtml(s.description) : '',
      grading_type: 'points',
    },
  }
}

/** Types the app can build in New Quizzes. Fill in the blank and text only are not built yet. */
export const NEW_QUIZ_BUILDABLE = new Set<Question['type']>([
  'multiple_choice',
  'true_false',
  'multiple_answers',
  'essay',
  'matching',
  'categorization',
  'numeric',
  'ordering',
  'file_upload',
])

function noShuffle() {
  return { shuffle_rules: { choices: { to_lock: [], shuffled: false } }, vary_points_by_answer: false }
}

function newNumeric(n: NumericAnswer, id: string): Record<string, unknown> {
  switch (n.kind) {
    case 'exact':
      return { id, type: 'exactResponse', value: String(n.value) }
    case 'margin':
      return { id, type: 'marginOfError', value: String(n.value), margin: String(n.margin), margin_type: n.marginType }
    case 'range':
      return { id, type: 'withinARange', start: String(n.start), end: String(n.end) }
    case 'precision':
      return {
        id,
        type: 'preciseResponse',
        value: String(n.value),
        precision: String(n.precision),
        precision_type: n.precisionType === 'significant' ? 'significantDigits' : 'decimals',
      }
  }
}

export function newQuizItemBody(q: Question, index: number, newId: () => string) {
  const entry: Record<string, unknown> = {
    title: questionTitle(q, index),
    item_body: toHtml(q.text),
    calculator_type: q.fileUpload?.showCalculator ? 'basic' : 'none',
  }

  switch (q.type) {
    case 'multiple_choice':
    case 'multiple_answers': {
      const choices = q.answers.map((a, i) => ({ id: newId(), position: i + 1, item_body: toHtml(a.text), correct: a.correct }))
      entry.interaction_type_slug = q.type === 'multiple_choice' ? 'choice' : 'multi-answer'
      entry.interaction_data = { choices: choices.map(({ correct: _c, ...c }) => c) }
      entry.properties = noShuffle()
      const correctIds = choices.filter((c) => c.correct).map((c) => c.id)
      entry.scoring_data = { value: q.type === 'multiple_choice' ? correctIds[0] : correctIds }
      entry.scoring_algorithm = q.type === 'multiple_choice' ? 'Equivalence' : 'AllOrNothing'
      break
    }
    case 'true_false': {
      const trueIsCorrect = q.answers.some((a) => a.correct && /^true/i.test(a.text))
      entry.interaction_type_slug = 'true-false'
      entry.interaction_data = { true_choice: 'True', false_choice: 'False' }
      entry.properties = {}
      entry.scoring_data = { value: trueIsCorrect }
      entry.scoring_algorithm = 'Equivalence'
      break
    }
    case 'essay':
      entry.interaction_type_slug = 'essay'
      entry.interaction_data = { rce: true, essay: null, word_count: false, file_upload: false, spell_check: false }
      entry.properties = {}
      entry.scoring_data = { value: '' }
      entry.scoring_algorithm = 'None'
      break
    case 'file_upload': {
      const f = q.fileUpload ?? { showCalculator: false, fileLimit: null, fileTypes: [] }
      entry.interaction_type_slug = 'file-upload'
      entry.interaction_data = { files_count: String(f.fileLimit ?? 1), restrict_count: f.fileLimit !== null }
      entry.properties = { allowed_types: f.fileTypes.join(','), restrict_types: f.fileTypes.length > 0 }
      entry.scoring_data = { value: '' }
      entry.scoring_algorithm = 'None'
      break
    }
    case 'matching': {
      // item_body fields hold HTML in New Quizzes: Doc text is escaped so it shows as typed.
      const questions = q.matches.map((m) => ({ id: newId(), item_body: escapeHtml(m.left), answer: m.right }))
      const answers = [...new Set([...q.matches.map((m) => m.right), ...q.distractors])]
      entry.interaction_type_slug = 'matching'
      entry.interaction_data = { answers, questions: questions.map(({ answer: _a, ...rest }) => rest) }
      entry.properties = { shuffle_rules: { questions: { shuffled: false } } }
      entry.scoring_data = {
        value: Object.fromEntries(questions.map((x) => [x.id, x.answer])),
        edit_data: {
          matches: questions.map((x) => ({ answer_body: x.answer, question_id: x.id, question_body: x.item_body })),
          distractors: q.distractors,
        },
      }
      entry.scoring_algorithm = 'PartialDeep'
      break
    }
    case 'categorization': {
      const categories = q.categories.map((c) => ({
        id: newId(),
        item_body: escapeHtml(c.description ? `${c.name}: ${c.description}` : c.name),
        items: c.items.map((text) => ({ id: newId(), item_body: escapeHtml(text) })),
      }))
      const loose = q.distractors.map((text) => ({ id: newId(), item_body: escapeHtml(text) }))
      const allItems = [...categories.flatMap((c) => c.items), ...loose]
      entry.interaction_type_slug = 'categorization'
      entry.interaction_data = {
        categories: Object.fromEntries(categories.map((c) => [c.id, { id: c.id, item_body: c.item_body }])),
        distractors: Object.fromEntries(allItems.map((d) => [d.id, d])),
        category_order: categories.map((c) => c.id),
      }
      entry.properties = { shuffle_rules: { questions: { shuffled: false } } }
      entry.scoring_data = {
        value: categories.map((c) => ({
          id: c.id,
          scoring_algorithm: 'AllOrNothing',
          scoring_data: { value: c.items.map((i) => i.id) },
        })),
        score_method: 'all_or_nothing',
      }
      entry.scoring_algorithm = 'Categorization'
      break
    }
    case 'numeric':
      entry.interaction_type_slug = 'numeric'
      entry.interaction_data = {}
      entry.properties = {}
      entry.scoring_data = { value: q.numeric ? [newNumeric(q.numeric, newId())] : [] }
      entry.scoring_algorithm = 'Numeric'
      break
    case 'ordering': {
      const choices = q.answers.map((a) => ({ id: newId(), item_body: toHtml(a.text) }))
      entry.interaction_type_slug = 'ordering'
      entry.interaction_data = { choices: Object.fromEntries(choices.map((c) => [c.id, c])) }
      entry.properties = { top_label: '', bottom_label: '', display_answers_paragraph: false, include_labels: false }
      entry.scoring_data = { value: choices.map((c) => c.id) }
      entry.scoring_algorithm = 'DeepEquals'
      break
    }
    default:
      throw new Error(`The app cannot build a ${q.type} question in New Quizzes yet.`)
  }

  return {
    item: {
      position: index + 1,
      points_possible: pointsFor(q),
      entry_type: 'Item',
      entry,
    },
  }
}

/** Whether the app can build this question in this engine (as opposed to Canvas offering it). */
export function canBuild(q: Question, engine: QuizEngine): boolean {
  return engine === 'classic' ? q.type in CLASSIC_TYPES : NEW_QUIZ_BUILDABLE.has(q.type)
}
