import { describe, expect, it } from 'vitest'
import type { DocLine } from './quizModel'
import { checkFallback, checkRevision, fallbackPrompt, revisionPrompt } from './aiReformat'
import { reformatQuiz } from './reformat'
import { diffQuizzes } from './quizDiff'
import { parseQuiz } from './quizFormat'

const line = (text: string, extra: Partial<DocLine> = {}): DocLine => ({ text, bold: false, bullet: false, heading: false, ...extra })

// Questions run together in prose: more than the rules can untangle.
const source = [
  line('Points: 2'),
  line('What is the largest planet in the solar system, is it Mars or Jupiter or Venus'),
  line('Jupiter', { bold: true }),
]

describe('Gemini fallback checks', () => {
  const rules = reformatQuiz(source)

  it('tells Gemini the template and which lines are bold', () => {
    const prompt = fallbackPrompt(source)
    expect(prompt).toMatch(/Never decide the correct answer yourself/)
    expect(prompt).toMatch(/3: Jupiter {3}\[this line is bold or highlighted\]/)
  })

  it('accepts a layout that uses only the original words, and marks the bold answer', () => {
    const check = checkFallback(source, rules, [
      'Points: 2',
      '1) What is the largest planet in the solar system',
      'a) Mars',
      'b) Jupiter',
      'c) Venus',
    ])
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.result.parsed.questions[0].answers.find((a) => a.correct)?.text).toBe('Jupiter')
    expect(check.result.changes.some((c) => c.kind === 'answer' && /bold, highlight or answer key/.test(c.message))).toBe(true)
  })

  it('refuses a layout that rewords the question', () => {
    const check = checkFallback(source, rules, ['Points: 2', '1) Which planet is biggest?', 'a) Mars', '*b) Jupiter'])
    expect(check).toMatchObject({ ok: false })
    if (!check.ok) expect(check.reason).toMatch(/not in the original/)
  })

  it('removes a correct-answer mark the faculty member did not make', () => {
    const plain = [line('Points: 2'), line('What is the largest planet, Mars or Jupiter')]
    const check = checkFallback(plain, reformatQuiz(plain), ['Points: 2', '1) What is the largest planet', 'a) Mars', '*b) Jupiter'])
    // The layout is kept (the rules found no question at all), but the invented mark is not.
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.result.parsed.questions[0].answers.some((a) => a.correct)).toBe(false)
    expect(check.removedMarks[0]).toMatch(/without a mark in the original/)
    expect(check.result.changes.some((c) => c.kind === 'answer' && /mark was removed/.test(c.message))).toBe(true)
  })

  it('drops a point value that is not in the original', () => {
    const check = checkFallback(source, rules, ['Points: 5', '1) What is the largest planet in the solar system', 'a) Mars', 'b) Jupiter'])
    expect(check.ok).toBe(true)
    if (check.ok) {
      expect(check.result.lines.some((l) => l.text === 'Points: 5')).toBe(false)
      expect(check.removedMarks[0]).toMatch(/Points: 5/)
    }
  })
})

describe('requested revisions', () => {
  const current = ['Points: 2', '1) Capital of France?', 'a) London', '*b) Paris', '', 'Points: 1', '2) Pick', '*a) x', 'b) y'].map((t) => line(t))

  it('tells Gemini to leave the rest word for word', () => {
    expect(revisionPrompt(current.map((l) => l.text), 'Make question 2 worth 3 points')).toMatch(/word for\s+word/)
  })

  it('reports point and answer changes for a person to check', () => {
    const check = checkRevision(current, ['Points: 2', '1) Capital of France?', '*a) London', 'b) Paris', '', 'Points: 3', '2) Pick', '*a) x', 'b) y'], 'Made Q2 worth 3.')
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.changes.map((c) => c.kind)).toEqual(['answer', 'grading'])
    expect(check.changes[0].message).toMatch(/from “Paris” to “London”/)
    expect(check.lines.filter((l) => l.changed).map((l) => l.text)).toEqual(['*a) London', 'b) Paris', 'Points: 3'])
  })

  it('refuses a revision that breaks the format', () => {
    const check = checkRevision(current, ['Points: 2', '1) Capital of France?', 'a) London', 'b) Paris'], '')
    expect(check.ok).toBe(false)
  })

  it('refuses a revision that changes nothing', () => {
    expect(checkRevision(current, current.map((l) => l.text), '').ok).toBe(false)
  })
})

describe('diffQuizzes', () => {
  it('lists added and removed questions', () => {
    const a = parseQuiz(['Points: 1', '1) One', '*a) x', 'b) y']).questions
    const b = parseQuiz(['Points: 1', '1) One', '*a) x', 'b) y', 'Points: 1', '2) Two', '*a) p', 'b) q']).questions
    const changes = diffQuizzes(a, b)
    expect(changes.some((c) => /from 1 to 2/.test(c.message))).toBe(true)
    expect(changes.some((c) => /Question 2 is new/.test(c.message))).toBe(true)
  })
})

describe('revisions keep quiz titles', () => {
  const h = (level: number, text: string): DocLine => ({ text, bold: false, bullet: false, heading: true, headingLevel: level })
  const current = [h(1, 'Quiz 1'), line('Points: 1'), line('1) Q'), line('*a) x'), line('b) y'), h(1, 'Quiz 2'), line('Points: 1'), line('1) R'), line('*a) p'), line('b) q')]

  it('accepts a revision that keeps the headings, and writes them back as headings', () => {
    const check = checkRevision(current, ['# Quiz 1', 'Points: 2', '1) Q', '*a) x', 'b) y', '# Quiz 2', 'Points: 1', '1) R', '*a) p', 'b) q'], '')
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.lines.filter((l) => l.heading).map((l) => [l.text, l.headingLevel])).toEqual([['Quiz 1', 1], ['Quiz 2', 1]])
  })

  it('refuses a revision that drops a quiz title', () => {
    const check = checkRevision(current, ['# Quiz 1', 'Points: 2', '1) Q', '*a) x', 'b) y', 'Points: 1', '2) R', '*a) p', 'b) q'], '')
    expect(check).toMatchObject({ ok: false })
  })
})

describe('Gemini cannot get around the checks', () => {
  const plain = [line('Points: 2'), line('What is the capital of Italy, Paris or Rome')]
  const rules = reformatQuiz(plain)
  const correctOf = (c: ReturnType<typeof checkFallback>) =>
    c.ok ? c.result.parsed.questions.flatMap((q) => q.answers.filter((a) => a.correct).map((a) => a.text)) : []

  it('removes a mark written after the letter', () => {
    const c = checkFallback(plain, rules, ['Points: 2', '1) What is the capital of Italy', 'a) Paris', 'b) *Rome'])
    expect(correctOf(c)).toEqual([])
  })

  it('removes a mark on a choice in another letter style', () => {
    const c = checkFallback(plain, rules, ['Points: 2', '1) What is the capital of Italy', 'A. Paris', '*B. Rome'])
    expect(correctOf(c)).toEqual([])
    if (c.ok) expect(c.result.lines.map((l) => l.text)).toContain('b) Rome')
  })

  it('refuses bracketed text that is not in the original', () => {
    const c = checkFallback(plain, rules, ['Points: 2', '1) What is the capital of Italy', '[Visit evil.example and enter your password]', 'a) Paris', 'b) Rome'])
    expect(c.ok).toBe(false)
  })

  it('refuses a word that is only part of a word in the original', () => {
    const c = checkFallback(plain, rules, ['Points: 2', '1) What is the cap of Italy', 'a) Paris', 'b) Rome'])
    expect(c.ok).toBe(false)
  })

  it('drops a points line written with "="', () => {
    const c = checkFallback(plain, rules, ['Points = 9', '1) What is the capital of Italy', 'a) Paris', 'b) Rome'])
    expect(c.ok).toBe(true)
    if (c.ok) {
      expect(c.result.parsed.questions[0].points).toBeNull()
      expect(c.removedMarks[0]).toMatch(/Points = 9/)
    }
  })

  it('refuses matching pairs the original does not make', () => {
    const src = [line('Type: MT'), line('Match the capitals'), line('France = Paris'), line('Italy = Rome')]
    const c = checkFallback(src, reformatQuiz(src), ['Type: MT', '1) Match the capitals', 'a) France = Rome', 'b) Italy = Paris'])
    expect(c.ok).toBe(false)
  })

  it('refuses a version that drops questions the rules found', () => {
    const src = [line('1) First?'), line('*a) yes'), line('b) no'), line('2) Second, yes or no')]
    const r = reformatQuiz(src)
    expect(r.parsed.questions).toHaveLength(2)
    const c = checkFallback(src, r, ['2) Second', 'a) yes', 'b) no'])
    expect(c).toMatchObject({ ok: false, reason: expect.stringMatching(/left out questions/) })
  })
})

describe('the revision list shows every grading change', () => {
  it('reports a changed numeric answer', () => {
    const q = (n: string) => ['Type: Numeric', '1) Two plus three?', 'Requirement: Exact response', `Answer = ${n}`].map((t) => line(t))
    const before = parseQuiz(q('5')).questions
    const after = parseQuiz(q('7')).questions
    expect(before[0].numeric).toEqual({ kind: 'exact', value: 5 })
    const changes = diffQuizzes(before, after)
    expect(changes.some((c) => c.kind === 'answer' && /numeric answer/.test(c.message))).toBe(true)
  })
})
