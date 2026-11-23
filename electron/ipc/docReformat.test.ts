import { describe, expect, it } from 'vitest'
import type { DocLine } from './quizModel'
import { reformatDocument, problemsOf } from './docReformat'

const t = (text: string, extra: Partial<DocLine> = {}): DocLine => ({ text, bold: false, bullet: false, heading: false, ...extra })
const h = (level: number, text: string): DocLine => ({ text, bold: false, bullet: false, heading: true, headingLevel: level })

describe('reformatting a Doc with several quizzes', () => {
  const doc = [
    t('Notes for the developer'),
    h(1, 'Module 1 Quiz'),
    t('Question 1: Capital of France?'),
    t('A. London'),
    t('B. Paris'),
    t('Answer Key'),
    t('1. B'),
    h(1, 'Module 2 Quiz'),
    t('1. Largest planet?'),
    t('a. Mars'),
    t('b. Jupiter', { bold: true }),
    t('2. Pick one'),
    t('a. x'),
    t('b. y'),
  ]
  const fix = reformatDocument(doc)

  it('keeps each quiz under its own heading, at its own level', () => {
    const headings = fix.lines.filter((l) => l.heading).map((l) => [l.text, l.headingLevel])
    expect(headings).toEqual([
      ['Module 1 Quiz', 1],
      ['Module 2 Quiz', 1],
    ])
    expect(fix.lines[0].text).toBe('Notes for the developer')
  })

  it('uses each quiz’s own answer key and numbering', () => {
    expect(fix.quizzes.map((q) => q.title)).toEqual(['Module 1 Quiz', 'Module 2 Quiz'])
    expect(fix.quizzes[0].result.parsed.questions[0].answers.find((a) => a.correct)?.text).toBe('Paris')
    expect(fix.quizzes[1].result.parsed.questions[0].answers.find((a) => a.correct)?.text).toBe('Jupiter')
  })

  it('names the quiz in each change and problem', () => {
    expect(fix.changes.some((c) => c.message.startsWith('Module 2 Quiz · Question 1: marked'))).toBe(true)
    const problems = problemsOf(fix.quizzes[1].title, fix.quizzes[1].result.parsed, true)
    expect(problems[0]).toMatch(/^Module 2 Quiz · Question 2: No answer is marked correct/)
  })
})
