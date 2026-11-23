import { describe, expect, it } from 'vitest'
import type { DocLine } from './quizModel'
import { quizSections, splitDocument } from './quizSplit'

const t = (text: string): DocLine => ({ text, bold: false, bullet: false, heading: false })
const h = (level: number, text: string): DocLine => ({ text, bold: false, bullet: false, heading: true, headingLevel: level })

describe('splitting a Doc into quizzes', () => {
  it('treats a Doc with no headings as one quiz', () => {
    const r = splitDocument([t('Points: 1'), t('1) Q'), t('*a) x'), t('b) y')])
    expect(r.level).toBeNull()
    expect(quizSections(r)).toHaveLength(1)
    expect(quizSections(r)[0].title).toBeNull()
  })

  it('splits at Heading 1 and takes the titles from the headings', () => {
    const r = splitDocument([
      t('Notes for the developer'),
      h(1, 'Module 1 Quiz'),
      t('1) Q'),
      t('*a) x'),
      h(1, 'Module 2 Quiz'),
      t('Points: 2'),
      t('1) Q'),
      t('*a) x'),
    ])
    expect(r.level).toBe(1)
    expect(quizSections(r).map((s) => s.title)).toEqual(['Module 1 Quiz', 'Module 2 Quiz'])
    expect(r.segments[0]).toEqual({ kind: 'other', lines: [t('Notes for the developer')] })
  })

  it('uses the level directly above the questions when both are used', () => {
    const r = splitDocument([
      h(1, 'Module 1'),
      h(2, 'Reading Quiz'),
      t('1) Q'),
      h(2, 'Lecture Quiz'),
      t('1) Q'),
      h(1, 'Module 2'),
      h(2, 'Reading Quiz'),
      t('1) Q'),
    ])
    expect(r.level).toBe(2)
    expect(r.levels).toEqual([2])
    expect(quizSections(r).map((s) => s.title)).toEqual(['Reading Quiz', 'Lecture Quiz', 'Reading Quiz'])
    // The module headings are kept, in place, as other text.
    expect(r.segments.filter((s) => s.kind === 'other')).toHaveLength(2)
  })

  it('lets the developer choose another level', () => {
    const lines = [h(1, 'Module 1'), t('1) Intro question'), h(2, 'Part A'), t('2) Q'), h(2, 'Part B'), t('3) Q')]
    expect(splitDocument(lines).level).toBe(2)
    const r = splitDocument(lines, 1)
    expect(r.level).toBe(1)
    expect(quizSections(r).map((s) => s.title)).toEqual(['Module 1'])
  })

  it('does not count a heading with no questions as a quiz', () => {
    const r = splitDocument([h(1, 'Instructions'), t('Read each question carefully.'), h(1, 'Quiz 1'), t('1) Q'), t('*a) x')])
    expect(quizSections(r).map((s) => s.title)).toEqual(['Quiz 1'])
  })

  it('finds quizzes whose questions are not yet in the template format', () => {
    const r = splitDocument([h(1, 'Quiz 1'), t('Question 1: What is it?'), t('A. x'), h(1, 'Quiz 2'), t('Q2. Why?')])
    expect(quizSections(r)).toHaveLength(2)
  })
})

describe('"Question N" headings', () => {
  it('are questions, not quiz titles', () => {
    const r = splitDocument([h(3, 'Question 1'), t('What?'), t('A. x B. y'), h(3, 'Question 2'), t('Why?')])
    expect(r.level).toBeNull()
    expect(quizSections(r)).toHaveLength(1)
  })
  it('still split under real quiz headings', () => {
    const r = splitDocument([h(1, 'Quiz A'), h(3, 'Question 1'), t('What?'), h(1, 'Quiz B'), h(3, 'Question 1'), t('Why?')])
    expect(quizSections(r).map((s) => s.title)).toEqual(['Quiz A', 'Quiz B'])
  })
})
