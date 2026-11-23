/**
 * The shape of a quiz once it has been read out of a document.
 *
 * Pure types, shared by the main process (which parses and creates quizzes) and the window
 * (which previews them). Nothing here depends on Electron, Canvas or Google.
 */

/** Which Canvas quiz engine a quiz is being built for. */
export type QuizEngine = 'classic' | 'new'

export type QuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'multiple_answers'
  | 'essay'
  | 'fill_in_blank'
  | 'matching'
  | 'file_upload'
  | 'multiple_dropdowns'
  | 'categorization'
  | 'numeric'
  | 'ordering'
  | 'text_only'

export interface Answer {
  text: string
  correct: boolean
}

export interface MatchPair {
  left: string
  right: string
}

export interface Dropdown {
  /** The name written in the question as [Variable1]. */
  variable: string
  options: Answer[]
}

export interface Category {
  name: string
  description: string
  items: string[]
}

export type NumericAnswer =
  | { kind: 'exact'; value: number }
  | { kind: 'margin'; value: number; margin: number; marginType: 'absolute' | 'percent' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'precision'; value: number; precision: number; precisionType: 'decimals' | 'significant' }

export interface FileUploadOptions {
  showCalculator: boolean
  /** Null when the number of files is not limited. */
  fileLimit: number | null
  /** File extensions without the dot, e.g. ["pdf", "docx"]. Empty when any type is allowed. */
  fileTypes: string[]
}

export interface Question {
  type: QuestionType
  /** The number the document gave the question, if it gave one. */
  number: number | null
  /** Null when the document left the points out or as the "#" placeholder. */
  points: number | null
  text: string
  /** Choices for multiple choice, true/false and multiple answer; accepted answers for fill in the blank; items in order for ordering. */
  answers: Answer[]
  matches: MatchPair[]
  /** Wrong matches offered alongside the real ones (matching) or items in no category (categorization). */
  distractors: string[]
  dropdowns: Dropdown[]
  categories: Category[]
  numeric: NumericAnswer | null
  fileUpload: FileUploadOptions | null
  /** The template marks this type "(manual build)": the old generator could not build it. */
  markedManualBuild: boolean
  /** Index of the line the question starts on, so the preview can point at it. */
  line: number
}

export type IssueSeverity = 'error' | 'warning'

export interface Issue {
  severity: IssueSeverity
  message: string
  /** Index of the line the problem is on. */
  line: number
  /** Index into `questions`, when the problem belongs to one question. */
  question: number | null
}

export interface ParseResult {
  questions: Question[]
  issues: Issue[]
}

/** One line of a document, as the parser sees it. */
export interface DocLine {
  text: string
  /** Every character on the line is bold. */
  bold: boolean
  /** The line was a bulleted (not numbered) list item in the document. */
  bullet: boolean
  /** The paragraph is a heading (Title, Heading 1–6): a section title, never quiz content. */
  heading: boolean
}
