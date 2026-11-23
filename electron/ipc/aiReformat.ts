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

/** The wording of a template line without its template markers. */
function contentOf(line: string): string[] {
  const t = line.trim()
  if (/^points?\s*:/i.test(t) || /^type\s*:/i.test(t) || /^\[[^\]]+\]$/.test(t)) return []
  const body = t
    .replace(/^(\d{1,4}|#)\)\s*/, '')
    .replace(/^\*?\s*[a-h]\)\s*/i, '')
    .replace(/^text to display\s*:\s*/i, '')
  // Matching pairs: each side on its own.
  return body.split(/\s=\s|^=\s*/).map((s) => s.trim()).filter(Boolean)
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
  return lines.map((l) => (l.heading && (l.headingLevel ?? 0) >= 1 ? `${'#'.repeat(l.headingLevel!)} ${l.text}` : l.text))
}

/** Gemini's lines back into Doc lines, "# Title" becoming a heading again. */
export function unmarkHeadings(lines: string[]): DocLine[] {
  return lines.map((raw) => {
    const text = typeof raw === 'string' ? raw.replace(/[\r\n\v]+/g, ' ').trimEnd() : ''
    const m = text.match(/^(#{1,6})\s+(.*)$/)
    return m
      ? { text: m[2], bold: false, bullet: false, heading: true, headingLevel: m[1].length }
      : { text, bold: false, bullet: false, heading: false }
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
- Lines starting with # are quiz titles (headings). Keep every one, exactly as written, in its place.

Return JSON: {"lines": [every line of the revised questions, in order, "" for a blank line], "notes": "one sentence on what you changed"}.

THE CURRENT QUESTIONS:
${current.join('\n')}`
}

export type FallbackCheck =
  | { ok: true; result: ReformatResult; removedMarks: string[] }
  | { ok: false; reason: string }

/**
 * Check Gemini's reformat against the original and the rule-based attempt, and fix the answer marks.
 */
export function checkFallback(source: DocLine[], ruleBased: ReformatResult, aiLines: string[]): FallbackCheck {
  const lines = aiLines.map((l) => (typeof l === 'string' ? l.replace(/[\r\n\v]+/g, ' ').trimEnd() : ''))
  const original = ` ${words(source.map((l) => l.text).join(' '))} `

  // No new words.
  for (const line of lines) {
    for (const part of contentOf(line)) {
      const w = words(part)
      if (!w || w === 'true' || w === 'false') continue
      if (!original.includes(` ${w} `) && !original.includes(w)) {
        return { ok: false, reason: `Gemini's version had wording that is not in the original (“${part.slice(0, 80)}”), so it was not used.` }
      }
    }
  }

  // Which choices the faculty member marked: what the rules found, plus any marked line.
  const ruleCorrect = new Set<string>()
  for (const q of ruleBased.parsed.questions) for (const a of q.answers) if (a.correct) ruleCorrect.add(words(a.text))
  for (const l of source) {
    if (l.bold || l.highlighted || /\*/.test(l.text) || /\(correct\)|\[correct\]/i.test(l.text)) {
      const w = words(l.text.replace(/^\*?\s*\(?[a-h][).:]\s*/i, '').replace(/\*|\((?:correct|answer)\)|\[(?:correct|answer)\]/gi, ''))
      if (w) ruleCorrect.add(w)
    }
  }

  const removedMarks: string[] = []
  const numbers = new Set((source.map((l) => l.text).join(' ').match(/\d+(?:\.\d+)?/g) ?? []).map(Number))
  const fixed: FixedLine[] = []
  const sourceTexts = new Set(source.map((l) => l.text.trim()))
  let currentQuestion = ''

  for (const raw of lines) {
    let text = raw
    const q = text.match(/^(\d{1,4}|#)\)/)
    if (q) currentQuestion = q[1]
    const pts = text.match(/^points?\s*:\s*(\d+(?:\.\d+)?)/i)
    if (pts && !numbers.has(Number(pts[1]))) {
      removedMarks.push(`A “Points: ${pts[1]}” line Gemini added: that number is not in the original.`)
      continue
    }
    const choice = text.match(/^(\*?)\s*([a-h])\)\s*(.*)$/i)
    if (choice) {
      const isMarked = ruleCorrect.has(words(choice[3]))
      if (choice[1] === '*' && !isMarked) {
        removedMarks.push(`Question ${currentQuestion || '?'}: Gemini marked “${choice[3]}” correct without a mark in the original. The mark was removed.`)
        text = `${choice[2].toLowerCase()}) ${choice[3]}`
      } else if (choice[1] !== '*' && isMarked) {
        text = `*${choice[2].toLowerCase()}) ${choice[3]}`
      }
    }
    fixed.push({ text, changed: text.trim() !== '' && !sourceTexts.has(text.trim()), heading: false })
  }

  const parsed = parseQuiz(fixed.map((l) => ({ text: l.text, bold: false, bullet: false, heading: false })))
  const errorsOf = (p: ParseResult) => p.issues.filter((i) => i.severity === 'error').length
  if (parsed.questions.length === 0) return { ok: false, reason: 'Gemini did not return any questions the app could read.' }
  if (errorsOf(parsed) >= errorsOf(ruleBased.parsed) && parsed.questions.length <= ruleBased.parsed.questions.length) {
    return { ok: false, reason: 'Gemini’s version did not leave fewer problems than the app’s own fixes, so the app’s version was kept.' }
  }

  const changes: Change[] = [
    ...ruleBased.changes.filter((c) => c.kind === 'answer' && c.question === null),
    ...diffAgainstMarks(source, parsed),
    { kind: 'format', question: null, message: `Gemini laid out the questions the app’s rules could not. Its lines are highlighted in the Doc like the others.` },
    ...removedMarks.map((m) => ({ kind: 'answer' as const, question: null, message: m })),
  ]
  return { ok: true, result: { lines: fixed, changes, parsed }, removedMarks }
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
  const titles = (ls: DocLine[]) => ls.filter((l) => l.heading && (l.headingLevel ?? 0) >= 1).map((l) => `${l.headingLevel}:${l.text.trim()}`)
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
