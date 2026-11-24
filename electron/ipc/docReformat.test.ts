import { describe, expect, it } from 'vitest'
import type { DocLine } from './quizModel'
import { reformatDocument, problemsOf, addGuessWarnings } from './docReformat'
import { parseQuiz } from './quizFormat'

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

describe('default points across a Doc', () => {
  it('fills every quiz and reports it once per quiz', () => {
    const fix = reformatDocument([h(1, 'Quiz A'), t('1) Q'), t('*a) x'), t('b) y'), h(1, 'Quiz B'), t('Points: 4'), t('1) R'), t('*a) p'), t('b) q')], null, undefined, { defaultPoints: 2 })
    expect(fix.quizzes.map((q) => q.result.parsed.questions[0].points)).toEqual([2, 4])
    expect(fix.changes.filter((c) => /no points/.test(c.message)).map((c) => c.message)).toEqual(['Quiz A · Gave 1 question with no points 2 points each (the number you chose).'])
  })
})

describe('quizzes copied out of Canvas with question-bank ids', () => {
  // Quizzes numbered "4960008." used to be taken for notes, so only the template quizzes were listed.
  const doc = [
    h(1, '01.12 Quiz: Chapter 01'),
    t('Points: 1'),
    t('1) Which term means freedom?'),
    t('a) independence'),
    t('*b) freedom'),
    t('=== End of Quiz ==='),
    h(1, '03.08 Midterm'),
    t('Quiz Title: 03.08 Midterm'),
    t('--- Questions ---'),
    t('4960009. A peak moment occurred in what year?'),
    t('1954'),
    t('*1963'),
    t('4958658. What name do you prefer to go by?'),
    t('####'),
    t('=== End of Quiz ==='),
    h(1, '04.08 Quiz'),
    t('4960879. Do scholars have more or less positive views?'),
    t('*More'),
    t('Less'),
    t('=== End of Quiz ==='),
  ]
  const fix = reformatDocument(doc)

  it('finds every quiz', () => {
    expect(fix.quizzes.map((q) => q.title)).toEqual(['01.12 Quiz: Chapter 01', '03.08 Midterm', '04.08 Quiz'])
  })

  it('stops the choices at the end-of-quiz line and makes "####" an essay', () => {
    const midterm = fix.quizzes[1].result.parsed
    expect(midterm.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(midterm.questions.map((q) => q.type)).toEqual(['multiple_choice', 'essay'])
    expect(midterm.questions[0].answers.map((c) => c.text)).toEqual(['1954', '1963'])
    expect(fix.quizzes[2].result.parsed.questions[0].answers.length).toBe(2)
  })
})

describe('guessed answers in a Reformatted questions tab', () => {
  it('shows the Check note as a warning on its question until the note is deleted', () => {
    const tab = [
      h(6, 'Check: Quiz 2 · Question 1: marked b) y correct, because it was the only highlighted choice and no choice had an asterisk. Check this is the right answer.'),
      h(1, 'Quiz 1'),
      t('1) Pick'), t('*a) x'), t('b) y'),
      h(1, 'Quiz 2'),
      t('1) Pick'), t('a) x'), t('*b) y'),
    ]
    const quizzes = [
      { title: 'Quiz 1', result: parseQuiz(tab.slice(2, 5)) },
      { title: 'Quiz 2', result: parseQuiz(tab.slice(6)) },
    ]
    addGuessWarnings(tab, quizzes)
    const guessIn = (n: number) => quizzes[n].result.issues.find((i) => /^When the app tidied/.test(i.message))
    expect(guessIn(0)).toBeUndefined()
    const warning = guessIn(1)
    expect(warning).toMatchObject({ question: 0 })
    expect(warning?.message).toMatch(/^When the app tidied this Doc, it marked b\) y correct, because it was the only highlighted choice/)
  })
})
