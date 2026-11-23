import { describe, expect, it } from 'vitest'
import type { DocLine } from './quizModel'
import { reformatQuiz } from './reformat'

const line = (text: string, extra: Partial<DocLine> = {}): DocLine => ({ text, bold: false, bullet: false, heading: false, ...extra })
const lines = (...t: Array<string | DocLine>) => t.map((x) => (typeof x === 'string' ? line(x) : x))
const texts = (r: ReturnType<typeof reformatQuiz>) => r.lines.map((l) => l.text).filter(Boolean)
const errors = (r: ReturnType<typeof reformatQuiz>) => r.parsed.issues.filter((i) => i.severity === 'error')

describe('the code reformatter', () => {
  it('leaves a correctly formatted quiz alone', () => {
    const r = reformatQuiz(lines('Points: 2', '1) Capital of France?', 'a) London', '*b) Paris'))
    expect(texts(r)).toEqual(['Points: 2', '1) Capital of France?', 'a) London', '*b) Paris'])
    expect(r.lines.some((l) => l.changed)).toBe(false)
    expect(r.changes).toEqual([])
  })

  it('rewrites other numbering and letter styles', () => {
    const r = reformatQuiz(lines('Points: 1', 'Question 1: Capital of France?', 'A. London', '*B. Paris'))
    expect(texts(r)).toEqual(['Points: 1', '1) Capital of France?', 'a) London', '*b) Paris'])
    expect(errors(r)).toEqual([])
  })

  it('marks the bold choice correct, and reports it as an answer change', () => {
    const r = reformatQuiz(lines('Points: 1', '1. Largest planet?', 'a. Mars', line('b. Jupiter', { bold: true }), 'c. Venus'))
    expect(texts(r)).toContain('*b) Jupiter')
    expect(r.changes[0]).toMatchObject({ kind: 'answer', question: 1 })
    expect(r.changes[0].message).toMatch(/bold or highlighted/)
    expect(errors(r)).toEqual([])
  })

  it('marks a highlighted choice correct', () => {
    const r = reformatQuiz(lines('Points: 1', '1) Pick', 'a) x', line('b) y', { highlighted: true })))
    expect(texts(r)).toContain('*b) y')
  })

  it('does not treat every choice being bold as a mark', () => {
    const r = reformatQuiz(lines('Points: 1', '1) Pick', line('a) x', { bold: true }), line('b) y', { bold: true })))
    expect(texts(r)).toEqual(['Points: 1', '1) Pick', 'a) x', 'b) y'])
    expect(errors(r)[0].message).toMatch(/No answer is marked correct/)
  })

  it('uses "Answer: B" under a question, and removes the line', () => {
    const r = reformatQuiz(lines('Points: 1', '1) Pick', 'a) x', 'b) y', 'Answer: B'))
    expect(texts(r)).toEqual(['Points: 1', '1) Pick', 'a) x', '*b) y'])
  })

  it('uses an answer key at the end', () => {
    const r = reformatQuiz(
      lines('Points: 1', '1) First', 'a) x', 'b) y', 'Points: 1', '2) Second', 'a) p', 'b) q', 'Answer Key', '1. A', '2. B'),
    )
    expect(texts(r)).toEqual(['Points: 1', '1) First', '*a) x', 'b) y', 'Points: 1', '2) Second', 'a) p', '*b) q'])
    expect(r.changes.some((c) => /answer key \(2 answers\)/.test(c.message))).toBe(true)
  })

  it('uses an answer key written on one line', () => {
    const r = reformatQuiz(lines('1) A', 'a) x', 'b) y', '2) B', 'a) p', 'b) q', '3) C', 'a) m', 'b) n', '1. B 2. A 3. B'))
    expect(texts(r).filter((t) => t.startsWith('*'))).toEqual(['*b) y', '*a) p', '*b) n'])
  })

  it('keeps the asterisk when the answer key disagrees, and says so', () => {
    const r = reformatQuiz(lines('1) Pick', '*a) x', 'b) y', 'Answer: b'))
    expect(texts(r)).toContain('*a) x')
    expect(r.changes.find((c) => c.kind === 'answer')?.message).toMatch(/Check which is right/)
  })

  it('moves a misplaced asterisk', () => {
    const r = reformatQuiz(lines('Points: 1', '1) Pick', 'a) x', 'b) *y', 'c) z*'))
    expect(texts(r)).toEqual(['Points: 1', 'Type: MA', '1) Pick', 'a) x', '*b) y', '*c) z'])
  })

  it('splits choices typed on one line', () => {
    const r = reformatQuiz(lines('Points: 1', '1) Which is a color? a) red b) dog *c) blue'))
    expect(texts(r)).toEqual(['Points: 1', '1) Which is a color?', 'a) red', 'b) dog', '*c) blue'])
  })

  it('moves points out of the question', () => {
    const r = reformatQuiz(lines('1) Explain the causes of the war. (5 pts)', 'Type: E'))
    expect(texts(r)[0]).toBe('Points: 5')
    expect(r.changes.some((c) => c.kind === 'grading' && /Points line/.test(c.message))).toBe(true)
  })

  it('tidies "Points: 2 pts"', () => {
    const r = reformatQuiz(lines('Points: 2 pts', '1) Pick', '*a) x', 'b) y'))
    expect(texts(r)[0]).toBe('Points: 2')
  })

  it('adds Type: MA when the key gives two answers', () => {
    const r = reformatQuiz(lines('Points: 2', '1) Primary colors?', 'a) red', 'b) green', 'c) blue', 'Answer: A, C'))
    expect(texts(r)).toEqual(['Points: 2', 'Type: MA', '1) Primary colors?', '*a) red', 'b) green', '*c) blue'])
    expect(errors(r)).toEqual([])
  })

  it('adds True and False choices, and marks one from the key', () => {
    const r = reformatQuiz(lines('Points: 1', '1) True or False: The sun is a star.', 'Answer: True'))
    expect(texts(r)).toEqual(['Points: 1', '1) The sun is a star.', '*a) True', 'b) False'])
    expect(r.parsed.questions[0].type).toBe('true_false')
  })

  it('never marks an answer without a signal', () => {
    const r = reformatQuiz(lines('1) Pick one', 'a) x', 'b) y'))
    expect(texts(r).some((t) => t.startsWith('*'))).toBe(false)
    expect(errors(r).length).toBeGreaterThan(0)
  })

  it('highlights only the lines it changed', () => {
    const r = reformatQuiz(lines('Points: 1', '1) Pick', 'a) x', line('b) y', { bold: true })))
    expect(r.lines.filter((l) => l.changed).map((l) => l.text)).toEqual(['*b) y'])
  })

  it('keeps the text above the first question', () => {
    const r = reformatQuiz(lines('Module 3 Quiz', 'Answer every question.', 'Points: 1', '1) Pick', '*a) x', 'b) y'))
    expect(texts(r).slice(0, 2)).toEqual(['Module 3 Quiz', 'Answer every question.'])
  })
})
