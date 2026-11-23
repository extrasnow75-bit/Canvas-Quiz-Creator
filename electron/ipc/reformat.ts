/**
 * Rewrites badly formatted quiz questions into the eCampus template format, by rule, without AI.
 *
 * Only changes with a clear signal in the document are made:
 *   - numbering and choice letters in other styles ("Question 3:", "3.", "(b)", "B.")
 *   - an asterisk in the wrong place ("b) *Paris", "b) Paris*") or a "(correct)" note
 *   - an answer key: "Answer: B" under a question, or an "Answer Key" list at the end
 *   - a bold, highlighted or underlined choice, which is how faculty most often mark the answer
 *   - choices typed on one line ("a) red b) blue c) green")
 *   - points written into the question ("… (2 pts)") or as "Points: 2 pts"
 *   - two or more correct answers without "Type: MA"
 *
 * Anything else is left exactly as it was and reported by the parser as still needing a person.
 * Nothing here invents wording or decides an answer: every answer marked correct comes from a mark
 * the faculty member made.
 *
 * The result goes into a new tab of the same Google Doc for a person to check (docsWrite.ts), with
 * every changed line highlighted. Pure: no network, no Electron.
 */
import { QUESTION_HEADER_RE, type DocLine, type ParseResult } from './quizModel'
import { parseQuiz } from './quizFormat'

export interface FixedLine {
  text: string
  /** New, or different from the line it came from: highlighted in the Doc. */
  changed: boolean
  /** Kept as a heading (a section title in the original). */
  heading: boolean
  /** The heading's level in the original (1–6, 0 for Title), so it is written back the same. */
  headingLevel?: number
}

export type ChangeKind =
  /** Which answer is marked correct. Shown first, for a person to check. */
  | 'answer'
  /** Points or question type. Also shown first: they change grading. */
  | 'grading'
  /** Numbering, letters, spacing: cannot change what students are graded on. */
  | 'format'

export interface Change {
  kind: ChangeKind
  /** The question's number in the reformatted questions, or null for a change to the whole document. */
  question: number | null
  message: string
}

export interface ReformatResult {
  lines: FixedLine[]
  changes: Change[]
  /** The reformatted questions, read back by the same parser the quiz is created from. */
  parsed: ParseResult
}

// ─── Patterns ──────────────────────────────────────────────────────────────────

const POINTS_LINE = /^points?\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*(?:pts?\.?|points?)?\s*$/i
const POINTS_TEMPLATE = /^points?\s*:/i
const TYPE_LINE = /^(?:question\s+)?type\s*:\s*(.+)$/i
/** "Question 3:", "Q3.", "3.", "3)", "3 -", "#)". */
const QUESTION_LINE = /^(?:(?:question|q)\s*#?\s*(\d{1,4})\s*[:.)-]?|(\d{1,4})\s*[.):]|(\d{1,4})\s+-|(#)\s*\))\s*(.*)$/i
/** A choice: "*b) x", "(b) x", "B. x", "b - x", "* b) x", "b) *x". */
const CHOICE_LINE = /^(\*?)\s*\(?([a-hA-H])\s*[).:]\s*(.*)$|^(\*?)\s*([a-hA-H])\s+-\s+(.*)$/
const ANSWER_NOTE = /^(?:the\s+)?(?:correct\s+)?(?:answer|ans|key|correct)\s*(?:is)?\s*[:=-]?\s*(.+)$/i
const KEY_HEADING = /^(?:answer\s*key|answers|key|correct\s+answers)\s*:?\s*$/i
const KEY_ENTRY = /^(\d{1,4})\s*[.):-]?\s*((?:[a-h](?:\s*(?:,|&|and)\s*[a-h])*)|true|false|t|f)\s*\.?$/i
const KEY_INLINE = /(\d{1,4})\s*[.):-]\s*([a-h]|true|false|t|f)\b/gi
const POINTS_SUFFIX = /\s*[([]?\s*(\d+(?:\.\d+)?)\s*(?:pts?\.?|points?)\s*[)\]]?\s*$/i
const CORRECT_SUFFIX = /\s*(?:\*|\((?:correct|answer|right)\)|\[(?:correct|answer|right)\]|[-–]\s*correct|✓|✔)\s*$/i
// Text copied out of Canvas. The student and results views print these around each question.
const CANVAS_NOISE = /^(?:flag\s+question\b.*|group\s+of\s+answer\s+choices|unanswered(?:\s+question)?|you\s+answered|correct!?|incorrect!?|partial|question\s+\d{1,4}\s+of\s+\d{1,4})$/i
/** Canvas's results view puts "Correct Answer" on the line above the correct choice. */
const CANVAS_CORRECT_LABEL = /^correct\s+answers?$/i
/** "2 pts" on a line of its own, as Canvas prints it under the question header. */
const PTS_ONLY = /^(\d+(?:\.\d+)?)\s*(?:pts?\.?|points?)$/i
/** "Question 3  2 pts": the header Canvas prints above each question. */
const CANVAS_HEADER_PTS = /^question\s+(\d{1,4})\s+(\d+(?:\.\d+)?)\s*(?:pts?\.?|points?)$/i
/** "Question 32 pts": the same header with the space lost in copying. */
const CANVAS_HEADER_COMPACT = /^question\s+(\d{2,6})\s*(?:pts?\.?|points?)$/i
/** "48213. Prompt": a Canvas question-bank id in place of a question number. */
const CANVAS_BANK_ID = /^(\d{5,})\.\s+(.+)$/
/** A question that runs on to the next line: it ends on a word that cannot end a sentence. */
const RUNS_ON = /\b(?:be|on|in|of|to|that|which|when|with|and|or|not|may|the|a|an|is|are|was|were)$/i

const TRUE_FALSE_PREFIX = /^(?:true\s*(?:or|\/)\s*false|t\s*\/\s*f)\s*[:.-]?\s*/i

function clean(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** Letters in a key entry: "B", "a, c", "A and C". */
function keyLetters(raw: string): string[] {
  const t = raw.trim().toLowerCase().replace(/\.$/, '')
  if (/^(true|t)$/.test(t)) return ['true']
  if (/^(false|f)$/.test(t)) return ['false']
  const letters = t.split(/\s*(?:,|&|and|\s)\s*/).filter((x) => /^[a-h]$/.test(x))
  return letters
}

// ─── Working structures ────────────────────────────────────────────────────────

interface Source {
  text: string
  /** The original line, for deciding whether the output line changed. */
  orig: string
  bold: boolean
  highlighted: boolean
  heading: boolean
  headingLevel?: number
}

interface Choice {
  letter: string
  text: string
  correct: boolean
  marked: boolean // bold or highlighted in the original
  orig: string
  /** The original gave it a letter. False for choices Canvas printed without one. */
  lettered: boolean
}

interface Group {
  points: { value: string; orig: string } | null
  type: { text: string; orig: string } | null
  number: string // digits, or '#'
  text: string
  questionOrig: string
  body: Source[]
  choices: Choice[]
  /** Text after the choices: kept after them, where the parser flags it for a person. */
  trailing: Source[]
  /** Letters from an "Answer: B" line under the question. */
  key: string[] | null
  /** Lines removed from this question because they were understood (answer notes). */
  absorbed: number
  /** Copied from Canvas ("Question 3" header, bank id): its choices may have no letters. */
  canvasStyle: boolean
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export function reformatQuiz(input: DocLine[]): ReformatResult {
  const changes: Change[] = []
  const formatCounts = new Map<string, number>()
  const noteFormat = (what: string) => formatCounts.set(what, (formatCounts.get(what) ?? 0) + 1)

  // Pass 1: lines, and the answer key at the end if there is one.
  let src: Source[] = input
    .map((l) => ({ text: clean(l.text), orig: clean(l.text), bold: l.bold, highlighted: !!l.highlighted, heading: l.heading, headingLevel: l.headingLevel }))
    .filter((l) => l.text !== '')

  const globalKey = new Map<string, string[]>()
  const keyStart = src.findIndex((l) => KEY_HEADING.test(l.text))
  if (keyStart !== -1) {
    let end = keyStart + 1
    while (end < src.length) {
      const t = src[end].text
      const single = t.match(KEY_ENTRY)
      const inline = [...t.matchAll(KEY_INLINE)]
      if (single) globalKey.set(single[1], keyLetters(single[2]))
      else if (inline.length >= 2) for (const m of inline) globalKey.set(m[1], keyLetters(m[2]))
      else break
      end++
    }
    if (globalKey.size > 0) {
      src = [...src.slice(0, keyStart), ...src.slice(end)]
      changes.push({ kind: 'answer', question: null, message: `Used the answer key (${globalKey.size} answers) to mark correct answers, and took the key out of the questions.` })
    }
  } else {
    // A key written on one line anywhere: "1. B 2. D 3. A 4. C".
    const idx = src.findIndex((l) => [...l.text.matchAll(KEY_INLINE)].length >= 3 && l.text.replace(KEY_INLINE, '').replace(/[\s,;]/g, '') === '')
    if (idx !== -1) {
      for (const m of src[idx].text.matchAll(KEY_INLINE)) globalKey.set(m[1], keyLetters(m[2]))
      src.splice(idx, 1)
      changes.push({ kind: 'answer', question: null, message: `Used the answer key (${globalKey.size} answers) to mark correct answers, and took the key out of the questions.` })
    }
  }

  // Pass 2: split choices typed on one line, and points typed into the question.
  src = src.flatMap((l) => splitInlineChoices(l, noteFormat))

  // Pass 3: group into questions.
  const preamble: Source[] = []
  const groups: Group[] = []
  let pendingPoints: Group['points'] = null
  let pendingType: Group['type'] = null
  let current: Group | null = null

  let lastNumber = 0
  /** A "Correct Answer" label was just seen: the next choice is the correct one. */
  let correctNext = false
  const startQuestion = (number: string, text: string, orig: string, canvasStyle: boolean): Group => {
    const g: Group = {
      points: pendingPoints,
      type: pendingType,
      number,
      text,
      questionOrig: orig,
      body: [],
      choices: [],
      trailing: [],
      key: null,
      absorbed: 0,
      canvasStyle,
    }
    groups.push(g)
    pendingPoints = null
    pendingType = null
    if (/^\d+$/.test(number)) lastNumber = Number(number)
    return g
  }

  for (const l of src) {
    // ── Text copied out of Canvas ──
    if (CANVAS_NOISE.test(l.text)) {
      noteFormat('Removed text copied from the Canvas page')
      continue
    }
    if (CANVAS_CORRECT_LABEL.test(l.text) && current) {
      correctNext = true
      noteFormat('Removed text copied from the Canvas page')
      continue
    }
    const headerPts = l.text.match(CANVAS_HEADER_PTS)
    const compact = headerPts ? null : l.text.match(CANVAS_HEADER_COMPACT)
    if (headerPts || compact) {
      let number: string
      let points: string
      if (headerPts) {
        number = headerPts[1]
        points = headerPts[2]
      } else {
        // The space was lost: "32" after question 2 is question 3, worth 2 points.
        const digits = compact![1]
        const expected = String(lastNumber + 1)
        number = digits.startsWith(expected) && digits.length > expected.length ? expected : digits.slice(0, -1)
        points = digits.slice(number.length)
        changes.push({
          kind: 'grading',
          question: Number(number),
          message: `Question ${number}: read the Canvas header “${l.text}” as question ${number}, worth ${points} ${points === '1' ? 'point' : 'points'}. Check the points.`,
        })
      }
      pendingPoints = { value: points, orig: '' }
      current = startQuestion(number, '', '', true)
      continue
    }
    const ptsOnly = l.text.match(PTS_ONLY)
    if (ptsOnly) {
      if (current && !current.points && current.choices.length === 0) current.points = { value: ptsOnly[1], orig: '' }
      else pendingPoints = { value: ptsOnly[1], orig: '' }
      noteFormat('Rewrote points lines as "Points: N"')
      continue
    }
    const bank = l.text.match(CANVAS_BANK_ID)
    if (bank && !l.heading) {
      noteFormat('Replaced Canvas question-bank ids with question numbers')
      current = startQuestion(String(lastNumber + 1), bank[2].trim(), '', true)
      continue
    }

    if (l.heading && !QUESTION_HEADER_RE.test(l.text)) {
      // A heading between questions is a section title; keep it where it was.
      if (current) current.body.push(l)
      else preamble.push(l)
      continue
    }
    const pts = l.text.match(POINTS_LINE)
    if (pts || POINTS_TEMPLATE.test(l.text)) {
      const value = pts ? pts[1] : l.text.replace(POINTS_TEMPLATE, '').trim()
      if (pts && l.text !== `Points: ${pts[1]}`) noteFormat('Rewrote points lines as "Points: N"')
      pendingPoints = { value, orig: l.orig }
      continue
    }
    const type = l.text.match(TYPE_LINE)
    if (type) {
      pendingType = { text: `Type: ${type[1].trim()}`, orig: l.orig }
      continue
    }
    const q = l.text.match(QUESTION_LINE)
    if (q) {
      const number = q[1] ?? q[2] ?? q[3] ?? q[4] ?? '#'
      let text = q[5].trim()
      // Points written at the end of the question: "… (2 pts)".
      const suffix = text.match(POINTS_SUFFIX)
      if (suffix && !pendingPoints) {
        text = text.replace(POINTS_SUFFIX, '').trim()
        pendingPoints = { value: suffix[1], orig: '' }
        changes.push({ kind: 'grading', question: null, message: `Question ${number}: moved "${suffix[0].trim()}" from the question to a Points line.` })
      }
      // "Question 3" (the word, not "3)") is how Canvas prints questions: its choices may have no letters.
      current = startQuestion(number, text, l.orig, q[1] !== undefined)
      continue
    }
    if (!current) {
      preamble.push(l)
      continue
    }
    const note = current.choices.length > 0 || current.body.length === 0 ? l.text.match(ANSWER_NOTE) : null
    if (note) {
      const letters = keyLetters(note[1])
      if (letters.length > 0) {
        current.key = letters
        current.absorbed++
        continue
      }
    }
    const choice = parseChoice(l)
    if (choice) {
      if (correctNext && !choice.correct) {
        choice.correct = true
        changes.push({ kind: 'answer', question: Number(current.number) || null, message: `Question ${current.number}: marked ${choice.letter}) ${choice.text} correct, from Canvas’s “Correct Answer” label.` })
      }
      correctNext = false
      current.choices.push(choice)
      continue
    }
    // "Question 3" on a line of its own (often a heading): the next line is the question.
    if (current.text === '' && current.choices.length === 0 && current.body.length === 0) {
      current.text = l.text
      current.questionOrig = ''
      continue
    }
    // A question copied from Canvas: the lines after it are its choices, which Canvas prints
    // without letters. A line that carries on an unfinished question is joined to it instead.
    if (current.canvasStyle && current.text !== '' && !l.heading && current.body.length === 0 && current.choices.every((c) => !c.lettered)) {
      if (current.choices.length === 0 && RUNS_ON.test(current.text) && !l.text.startsWith('*')) {
        current.text = `${current.text} ${l.text}`
        continue
      }
      const starred = l.text.startsWith('*')
      const text = l.text.replace(/^\*\s*/, '')
      const letter = String.fromCharCode(97 + current.choices.length)
      const correct = starred || correctNext
      if (correctNext) changes.push({ kind: 'answer', question: Number(current.number) || null, message: `Question ${current.number}: marked ${letter}) ${text} correct, from Canvas’s “Correct Answer” label.` })
      correctNext = false
      if (current.choices.length === 0) {
        changes.push({ kind: 'grading', question: Number(current.number) || null, message: `Question ${current.number}: the choices copied from Canvas had no letters, so they were lettered. Check they are the choices, not part of the question.` })
      }
      current.choices.push({ letter, text, correct, marked: l.bold || l.highlighted, orig: '', lettered: false })
      continue
    }

    // More question text before the choices; anything after them stays after them.
    if (current.choices.length === 0) current.body.push(l)
    else current.trailing.push(l)
  }

  // Pass 4: answers, question by question.
  for (const g of groups) fixAnswers(g, globalKey, changes)

  // Write it out.
  const lines: FixedLine[] = preamble.map((l) => ({ text: l.text, changed: l.text !== l.orig, heading: l.heading, headingLevel: l.headingLevel }))
  for (const g of groups) {
    if (lines.length > 0) lines.push({ text: '', changed: false, heading: false })
    if (g.points) {
      const text = `Points: ${g.points.value}`
      lines.push({ text, changed: text !== g.points.orig, heading: false })
    }
    if (g.type) lines.push({ text: g.type.text, changed: g.type.text !== g.type.orig, heading: false })
    const qText = `${g.number}) ${g.text}`.trimEnd()
    if (qText !== g.questionOrig) noteFormat('Rewrote question numbers in the template’s "1)" style')
    lines.push({ text: qText, changed: qText !== g.questionOrig, heading: false })
    for (const b of g.body) lines.push({ text: b.text, changed: b.text !== b.orig, heading: b.heading, headingLevel: b.headingLevel })
    for (const c of g.choices) {
      const text = `${c.correct ? '*' : ''}${c.letter}) ${c.text}`
      lines.push({ text, changed: text !== c.orig, heading: false })
    }
    for (const t of g.trailing) lines.push({ text: t.text, changed: t.text !== t.orig, heading: t.heading, headingLevel: t.headingLevel })
  }

  for (const [what, n] of formatCounts) changes.push({ kind: 'format', question: null, message: `${what} (${n} ${n === 1 ? 'line' : 'lines'}).` })

  const parsed = parseQuiz(lines.map((l) => ({ text: l.text, bold: false, bullet: false, heading: l.heading })))
  return { lines, changes: sortChanges(changes), parsed }
}

/**
 * Give every question without a Points line the points the developer chose. Works on finished
 * lines, so it applies to the rules' output and to Gemini's alike. The new line goes above the
 * question's other template lines (Type:), as the template writes it. Text-only items (no number)
 * are never worth points and are left alone.
 */
export function addDefaultPoints(lines: FixedLine[], points: number): { lines: FixedLine[]; added: number } {
  const out: FixedLine[] = []
  let added = 0
  let pointsSeen = false
  for (const l of lines) {
    const t = l.text.trim()
    if (l.heading || t === '') {
      out.push(l)
      continue
    }
    if (/^points?\s*[:=]/i.test(t)) {
      pointsSeen = true
      out.push(l)
      continue
    }
    if (/^(?:\d{1,4}|#)\s*[).]/.test(t) && !/^[a-h]\)/i.test(t)) {
      if (!pointsSeen) {
        // Above any Type: line directly over the question.
        let at = out.length
        while (at > 0 && /^(?:question\s+)?type\s*:/i.test(out[at - 1].text.trim())) at--
        out.splice(at, 0, { text: `Points: ${points}`, changed: true, heading: false })
        added++
      }
      pointsSeen = false
    }
    out.push(l)
  }
  return { lines: out, added }
}

/** Answer and grading changes first, in question order; formatting last. */
function sortChanges(changes: Change[]): Change[] {
  const rank: Record<ChangeKind, number> = { answer: 0, grading: 1, format: 2 }
  return [...changes].sort((a, b) => rank[a.kind] - rank[b.kind] || (a.question ?? 0) - (b.question ?? 0))
}

function parseChoice(l: Source): Choice | null {
  const m = l.text.match(CHOICE_LINE)
  if (!m) return null
  const starBefore = (m[1] ?? m[4]) === '*'
  const letter = (m[2] ?? m[5]).toLowerCase()
  let text = (m[3] ?? m[6]).trim()
  let correct = starBefore
  // "b) *Paris" or "b)* Paris"
  if (text.startsWith('*')) {
    correct = true
    text = text.replace(/^\*\s*/, '')
  }
  // "b) Paris*", "b) Paris (correct)", "b) Paris ✓"
  if (CORRECT_SUFFIX.test(text)) {
    correct = true
    text = text.replace(CORRECT_SUFFIX, '').trim()
  }
  return { letter, text, correct, marked: l.bold || l.highlighted, orig: l.orig, lettered: true }
}

/**
 * "1) Which is a color? a) red b) dog c) blue" → the question and three choices. Only when the
 * letters run in order from a, so "a" or "b" inside ordinary words or sentences is left alone.
 */
function splitInlineChoices(l: Source, noteFormat: (what: string) => void): Source[] {
  if (l.heading) return [l]
  const re = /(^|\s)(\*?\(?([a-hA-H])[).]\s*\*?)/g
  const hits: Array<{ index: number; letter: string }> = []
  for (const m of l.text.matchAll(re)) hits.push({ index: (m.index ?? 0) + m[1].length, letter: m[3].toLowerCase() })
  // Keep the longest run a, b, c… in order.
  const run: typeof hits = []
  for (const h of hits) {
    const expected = String.fromCharCode(97 + run.length)
    if (h.letter === expected) run.push(h)
    else if (h.letter === 'a') run.splice(0, run.length, h)
  }
  if (run.length < 2) return [l]
  const pieces: string[] = []
  const head = l.text.slice(0, run[0].index).trim()
  if (head) pieces.push(head)
  run.forEach((h, i) => pieces.push(l.text.slice(h.index, i + 1 < run.length ? run[i + 1].index : undefined).trim()))
  noteFormat('Put each answer choice on its own line')
  // The pieces are new lines; none of them matches an original line.
  return pieces.map((text) => ({ ...l, text, orig: '' }))
}

function fixAnswers(g: Group, globalKey: Map<string, string[]>, changes: Change[]): void {
  const num = g.number === '#' ? null : Number(g.number)
  const label = `Question ${g.number}`
  const starred = g.choices.filter((c) => c.correct)
  const key = g.key ?? (g.number !== '#' ? globalKey.get(g.number) ?? null : null)

  // True/false written as "True or False: …" with no choices: add them.
  if (g.choices.length === 0 && TRUE_FALSE_PREFIX.test(g.text)) {
    g.text = g.text.replace(TRUE_FALSE_PREFIX, '').trim()
    g.choices = [
      { letter: 'a', text: 'True', correct: false, marked: false, orig: '', lettered: true },
      { letter: 'b', text: 'False', correct: false, marked: false, orig: '', lettered: true },
    ]
    changes.push({ kind: 'grading', question: num, message: `${label}: added True and False as the choices.` })
  }

  const describe = (cs: Choice[]) => cs.map((c) => `${c.letter}) ${c.text}`).join(' and ')

  if (key && key.length > 0) {
    const targets = g.choices.filter((c) =>
      key[0] === 'true' || key[0] === 'false' ? c.text.toLowerCase().replace(/\.$/, '') === key[0] : key.includes(c.letter),
    )
    if (targets.length === 0) {
      changes.push({ kind: 'answer', question: num, message: `${label}: the answer key says "${key.join(', ')}", but there is no such choice. Not marked.` })
    } else if (starred.length > 0 && !(starred.length === targets.length && starred.every((s) => targets.includes(s)))) {
      // The asterisk and the key disagree: keep the asterisk, but say so loudly.
      changes.push({
        kind: 'answer',
        question: num,
        message: `${label}: the answer key says ${describe(targets)}, but ${describe(starred)} has the asterisk. Left as it was. Check which is right.`,
      })
    } else if (starred.length === 0) {
      targets.forEach((c) => (c.correct = true))
      changes.push({ kind: 'answer', question: num, message: `${label}: marked ${describe(targets)} correct, from the answer key.` })
    }
  } else if (starred.length === 0 && g.choices.length > 0) {
    const marked = g.choices.filter((c) => c.marked)
    if (marked.length > 0 && marked.length < g.choices.length) {
      marked.forEach((c) => (c.correct = true))
      changes.push({ kind: 'answer', question: num, message: `${label}: marked ${describe(marked)} correct, because it was bold or highlighted.` })
    }
  } else if (starred.some((c) => !c.orig.startsWith('*'))) {
    changes.push({ kind: 'format', question: num, message: `${label}: moved the asterisk to before the letter of ${describe(starred.filter((c) => !c.orig.startsWith('*')))}.` })
  }

  // More than one correct answer needs "Type: MA".
  const correct = g.choices.filter((c) => c.correct).length
  if (correct > 1 && !g.type) {
    g.type = { text: 'Type: MA', orig: '' }
    changes.push({ kind: 'grading', question: num, message: `${label}: added "Type: MA" because ${correct} answers are marked correct.` })
  }
}
