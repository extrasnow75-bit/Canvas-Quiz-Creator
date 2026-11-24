/**
 * Gemini's two jobs, and the checks its answers must pass before a person sees them.
 *
 * 1. FALLBACK REFORMAT. After the rule-based reformatter (reformat.ts), questions it could not
 *    untangle go to Gemini to be laid out in the template format. Gemini may rearrange and relabel;
 *    it may not write. So its answer is checked line by line:
 *      - every line's wording must already be in the original (the "no new words" check);
 *      - every point value must appear in the original;
 *      - which answers are correct is NOT Gemini's decision. A choice is marked correct only if
 *        the faculty member marked it (asterisk, bold, highlight or answer key — exactly what the
 *        rules found). Any other asterisk Gemini adds is removed and reported.
 *    A proposal that adds wording, or does not leave fewer problems than the rules did, is refused,
 *    and the person is told the AI step did not help.
 *
 * 2. REQUEST CHANGES. A person asks for a change in plain English ("split question 4 into two").
 *    The proposal is compared with the current questions by diffQuizzes, and nothing is written
 *    until the person accepts it.
 *
 * Pure: builds prompts, checks answers. The request itself is gemini.ts.
 */
import type { DocLine, ParseResult } from './quizModel'
import { parseQuiz } from './quizFormat'
import type { Change, FixedLine, ReformatResult } from './reformat'
import { diffQuizzes } from './quizDiff'

export const TEMPLATE_RULES = `
THE FORMAT (Boise State eCampus quiz template):
- Each question starts with its number and a parenthesis: "3) Question text".
- Above the question, optionally: "Points: 2" and "Type: MA". No Type line means multiple choice
  (or true/false when the only choices are True and False).
- Choices are a lower-case letter and a parenthesis: "a) Choice". An asterisk directly before the
  letter marks a correct answer: "*b) Choice".
- Type codes: MA (more than one correct answer), E (essay), F (fill in the blank: each lettered line
  is an accepted answer), MT (matching: "a) Left = Right"), File (file upload), MD (multiple
  dropdowns), Categorize, Numeric, Ordering, Text only.
- One item per line. Leave a blank line between questions.
`

/** Words only, for checking that wording came from the original. */
function words(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'"]+/g, ' ')
    .trim()
}

/** A choice line in any style the parser reads as one: "a)", "A.", "*b)", "b) *text". */
const ANY_CHOICE_RE = /^(\*?)\s*([a-zA-Z])\s*[).]\s+(\*?)\s*(.*)$/
const POINTS_LINE_RE = /^points?\s*[:=]\s*(.*)$/i
const VARIABLE_LINE_RE = /^\[([^\]]+)\]$/

/** The wording of a template line without its template markers. */
function contentOf(line: string): string[] {
  const t = line.trim()
  if (POINTS_LINE_RE.test(t) || /^type\s*:/i.test(t)) return []
  // A multiple-dropdowns variable: its name is checked like any other wording.
  const v = t.match(VARIABLE_LINE_RE)
  if (v) return [v[1]]
  const body = t
    .replace(/^(\d{1,4}|#)\s*[).]\s*/, '')
    .replace(/^\*?\s*[a-zA-Z]\s*[).]\s+\*?\s*/, '')
    .replace(/^\*\s*/, '')
    .replace(/^text to display\s*:\s*/i, '')
  // Matching pairs and category lines: each side on its own.
  return body.split(/\s=\s|^=\s*|:\s+/).map((s) => s.trim()).filter(Boolean)
}

export function fallbackPrompt(source: DocLine[]): string {
  const text = source
    .map((l, i) => `${i + 1}: ${l.text}${l.bold || l.highlighted ? '   [this line is bold or highlighted]' : ''}`)
    .join('\n')
  return `You are reformatting quiz questions a faculty member wrote into a fixed template.
${TEMPLATE_RULES}
RULES YOU MUST FOLLOW:
- Rearrange and relabel only. Use the faculty member's exact words. Do not add, remove, reword,
  correct or translate anything. Do not invent questions, choices, feedback or point values.
- Put an asterisk before a choice ONLY if the original marks it: an asterisk, "(correct)", an
  answer key, or a line noted below as bold or highlighted. If nothing marks the answer, leave
  every choice without an asterisk. Never decide the correct answer yourself.
- Keep any text before the first question (a title or instructions) at the top, unchanged.
- Leave out answer-key lines once you have used them.

Return JSON: {"lines": [every line of the reformatted questions, in order, "" for a blank line]}.

THE ORIGINAL, one numbered line each:
${text}`
}

/** Headings as "# Title" (one # per level), so they survive a round trip through Gemini. */
export function markHeadings(lines: DocLine[]): string[] {
  // "%" marks a Title-style line, which names a one-quiz Doc.
  return lines.map((l) => (!l.heading ? l.text : (l.headingLevel ?? 0) >= 1 ? `${'#'.repeat(l.headingLevel!)} ${l.text}` : `% ${l.text}`))
}

/** Gemini's lines back into Doc lines, "# Title" becoming a heading again. */
export function unmarkHeadings(lines: string[]): DocLine[] {
  return lines.map((raw) => {
    const text = typeof raw === 'string' ? raw.replace(/[\r\n\v]+/g, ' ').trimEnd() : ''
    const m = text.match(/^(#{1,6})\s+(.*)$/)
    if (m) return { text: m[2], bold: false, bullet: false, heading: true, headingLevel: m[1].length }
    const title = text.match(/^%\s+(.*)$/)
    if (title) return { text: title[1], bold: false, bullet: false, heading: true, headingLevel: 0 }
    return { text, bold: false, bullet: false, heading: false }
  })
}

export function revisionPrompt(current: string[], instruction: string): string {
  return `You are revising quiz questions that are already in a fixed template.
${TEMPLATE_RULES}
THE CHANGE A PERSON ASKED FOR:
${instruction.trim()}

RULES YOU MUST FOLLOW:
- Make only the change asked for. Every line it does not concern stays exactly as it is, word for
  word: people may have edited these lines by hand.
- Do not change which answers are marked correct, or any point value, unless the change asked for
  says to.
- Keep any text before the first question unchanged.
- Lines starting with # or % are titles (headings). Keep every one, exactly as written, in its place.

Return JSON: {"lines": [every line of the revised questions, in order, "" for a blank line], "notes": "one sentence on what you changed"}.

THE CURRENT QUESTIONS:
${current.join('\n')}`
}

export type FallbackCheck =
  | { ok: true; result: ReformatResult; removedMarks: string[] }
  | { ok: false; reason: string }

/**
 * Check Gemini's reformat against the original and the rule-based attempt, and fix the answer marks.
 *
 * The checks work on what the parser will read, not on one spelling of the template: a choice
 * written "B. Rome" or "b) *Rome" counts as a choice, and its mark as a mark, exactly as it would
 * when the quiz is built.
 */
export function checkFallback(source: DocLine[], ruleBased: ReformatResult, aiLines: string[]): FallbackCheck {
  const lines = aiLines.map((l) => (typeof l === 'string' ? l.replace(/[\r\n\v]+/g, ' ').trimEnd() : ''))
  const sourceText = source.map((l) => l.text).join(' ')
  const original = ` ${words(sourceText)} `
  const has = (w: string) => original.includes(` ${w} `)

  // No new words: every word of every line, as a whole-word run that is in the original.
  for (const line of lines) {
    for (const part of contentOf(line)) {
      const w = words(part)
      if (!w || w === 'true' || w === 'false') continue
      if (!has(w)) {
        return { ok: false, reason: `Gemini's version had wording that is not in the original (“${part.slice(0, 80)}”), so it was not used.` }
      }
    }
  }

  // Which choices the faculty member marked: what the rules found, plus any marked line.
  const ruleCorrect = new Set<string>()
  for (const q of ruleBased.parsed.questions) {
    for (const a of q.answers) if (a.correct) ruleCorrect.add(words(a.text))
    for (const d of q.dropdowns) for (const o of d.options) if (o.correct) ruleCorrect.add(words(o.text))
  }
  for (const l of source) {
    if (l.bold || l.highlighted || /\*/.test(l.text) || /\(correct\)|\[correct\]/i.test(l.text)) {
      const w = words(l.text.replace(/^\*?\s*\(?[a-z][).:]\s*/i, '').replace(/\*|\((?:correct|answer)\)|\[(?:correct|answer)\]/gi, ''))
      if (w) ruleCorrect.add(w)
    }
  }

  const removedMarks: string[] = []
  const numbers = new Set((sourceText.match(/\d+(?:\.\d+)?/g) ?? []).map(Number))
  const fixed: FixedLine[] = []
  const sourceTexts = new Set(source.map((l) => l.text.trim()))
  let currentQuestion = ''

  for (const raw of lines) {
    let text = raw.trim()
    const q = text.match(/^(\d{1,4}|#)\s*[).]/)
    if (q) currentQuestion = q[1]
    const pts = text.match(POINTS_LINE_RE)
    if (pts) {
      const n = pts[1].match(/-?\d+(?:\.\d+)?/)
      if (!n || !numbers.has(Number(n[0]))) {
        removedMarks.push(`A “${text.slice(0, 40)}” line Gemini added: that number is not in the original.`)
        continue
      }
    }
    // Every choice is rewritten in the template's own form, marked only where the faculty member marked it.
    const choice = text.match(ANY_CHOICE_RE)
    if (choice && !q) {
      const body = choice[4].trim()
      const geminiMarked = choice[1] === '*' || choice[3] === '*'
      const isMarked = ruleCorrect.has(words(body))
      if (geminiMarked && !isMarked) {
        removedMarks.push(`Question ${currentQuestion || '?'}: Gemini marked “${body}” correct without a mark in the original. The mark was removed.`)
      }
      text = `${isMarked ? '*' : ''}${choice[2].toLowerCase()}) ${body}`
    }
    fixed.push({ text, changed: text !== '' && !sourceTexts.has(text), heading: false })
  }

  const parsed = parseQuiz(fixed.map((l) => ({ text: l.text, bold: false, bullet: false, heading: false })))
  const errorsOf = (p: ParseResult) => p.issues.filter((i) => i.severity === 'error').length
  if (parsed.questions.length === 0) return { ok: false, reason: 'Gemini did not return any questions the app could read.' }
  if (parsed.questions.length < ruleBased.parsed.questions.length) {
    return { ok: false, reason: 'Gemini’s version left out questions the app’s own fixes had found, so the app’s version was kept.' }
  }
  if (errorsOf(parsed) >= errorsOf(ruleBased.parsed) && parsed.questions.length <= ruleBased.parsed.questions.length) {
    return { ok: false, reason: 'Gemini’s version did not leave fewer problems than the app’s own fixes, so the app’s version was kept.' }
  }

  // What will be graded, checked on the parsed questions: nothing here may come from Gemini alone.
  for (const pq of parsed.questions) {
    const name = `Question ${pq.number ?? '?'}`
    if (pq.points !== null && !numbers.has(pq.points)) return { ok: false, reason: `${name}: Gemini gave it a point value that is not in the original, so its version was not used.` }
    const marked = [...pq.answers.filter((a) => a.correct), ...pq.dropdowns.flatMap((d) => d.options.filter((o) => o.correct))]
    if (marked.some((a) => !ruleCorrect.has(words(a.text)))) {
      return { ok: false, reason: `${name}: Gemini marked an answer correct that the faculty member did not mark, so its version was not used.` }
    }
    const nums = pq.numeric ? Object.values(pq.numeric).filter((v): v is number => typeof v === 'number') : []
    if (nums.some((n) => !numbers.has(n))) return { ok: false, reason: `${name}: Gemini gave a numeric answer that is not in the original, so its version was not used.` }
    // A pairing or a category is an answer key: it must be one the original already makes.
    for (const m of pq.matches) {
      if (!source.some((l) => ` ${words(l.text)} `.includes(` ${words(m.left)} `) && ` ${words(l.text)} `.includes(` ${words(m.right)} `))) {
        return { ok: false, reason: `${name}: Gemini paired “${m.left.slice(0, 40)}” with “${m.right.slice(0, 40)}”, which the original does not pair, so its version was not used.` }
      }
    }
    if (pq.categories.length > 0 && !sameCategories(source, pq.categories)) {
      return { ok: false, reason: `${name}: Gemini put answers in categories the original does not, so its version was not used.` }
    }
  }

  const changes: Change[] = [
    ...ruleBased.changes.filter((c) => c.kind === 'answer' && c.question === null),
    ...diffAgainstMarks(source, parsed),
    { kind: 'format', question: null, message: `Gemini laid out the questions the app’s rules could not. Its lines are highlighted in the Doc like the others.` },
    ...removedMarks.map((m) => ({ kind: 'answer' as const, question: null, message: m })),
  ]
  return { ok: true, result: { lines: fixed, changes, parsed }, removedMarks }
}

/**
 * Whether each categorized answer sits, in the original, under its category's name: after the
 * line that names the category, and before the line naming the next one.
 */
function sameCategories(source: DocLine[], categories: Array<{ name: string; items: string[] }>): boolean {
  const ws = source.map((l) => ` ${words(l.text)} `)
  const at = (w: string) => ws.findIndex((l) => l.includes(` ${w} `))
  const starts = categories.map((c) => ({ c, i: at(words(c.name)) }))
  if (starts.some((x) => x.i < 0)) return false
  const sorted = [...starts].sort((x, y) => x.i - y.i)
  return starts.every(({ c, i }) => {
    const next = sorted.find((x) => x.i > i)?.i ?? ws.length
    return c.items.every((item) => {
      const w = words(item)
      const j = ws.findIndex((l, k) => k > i && k < next && l.includes(` ${w} `))
      return j > i
    })
  })
}

/** Answer marks that did not come from an asterisk in the original: a person should look at each. */
function diffAgainstMarks(source: DocLine[], parsed: ParseResult): Change[] {
  const starred = new Set(source.filter((l) => /^\s*\*/.test(l.text)).map((l) => words(l.text.replace(/^\s*\*\s*\(?[a-h][).:]\s*/i, ''))))
  const out: Change[] = []
  for (const q of parsed.questions) {
    const marked = q.answers.filter((a) => a.correct && !starred.has(words(a.text)))
    if (marked.length && (q.type === 'multiple_choice' || q.type === 'multiple_answers' || q.type === 'true_false')) {
      out.push({
        kind: 'answer',
        question: q.number,
        message: `Question ${q.number ?? '?'}: marked ${marked.map((a) => `“${a.text}”`).join(' and ')} correct, from the faculty member’s bold, highlight or answer key.`,
      })
    }
  }
  return out
}

export type RevisionCheck =
  | { ok: true; lines: FixedLine[]; parsed: ParseResult; changes: Change[]; notes: string }
  | { ok: false; reason: string }

/** Check a requested revision and work out, independently, what it changes. */
export function checkRevision(current: DocLine[], aiLines: string[], notes: string): RevisionCheck {
  const before = parseQuiz(current)
  const lines = unmarkHeadings(aiLines)
  const parsed = parseQuiz(lines)
  const errorsOf = (p: ParseResult) => p.issues.filter((i) => i.severity === 'error').length
  if (parsed.questions.length === 0) return { ok: false, reason: 'Gemini did not return any questions the app could read.' }
  if (errorsOf(parsed) > errorsOf(before)) {
    return { ok: false, reason: 'Gemini’s revision left the questions with more formatting problems than before, so it was not used.' }
  }
  // Quiz titles are how the Doc is split into quizzes: a revision may not lose or rename one.
  const titles = (ls: DocLine[]) => ls.filter((l) => l.heading).map((l) => `${l.headingLevel ?? 6}:${l.text.trim()}`)
  if (titles(current).join('|') !== titles(lines).join('|')) {
    return { ok: false, reason: 'Gemini’s revision changed or dropped a quiz title, so it was not used.' }
  }
  const changes = diffQuizzes(before.questions, parsed.questions)
  if (changes.length === 0) return { ok: false, reason: 'Gemini’s revision did not change any question.' }
  const currentTexts = new Set(current.map((l) => l.text.trim()))
  return {
    ok: true,
    lines: lines.map((l) => ({
      text: l.text,
      changed: !l.heading && l.text.trim() !== '' && !currentTexts.has(l.text.trim()),
      heading: l.heading,
      headingLevel: l.headingLevel,
    })),
    parsed,
    changes,
    notes: typeof notes === 'string' ? notes.slice(0, 300) : '',
  }
}
