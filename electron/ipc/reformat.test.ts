import { describe, expect, it } from 'vitest'
import type { DocLine } from './quizModel'
import { addDefaultPoints, reformatQuiz } from './reformat'

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

describe('"Question N" headings with the question on the next line', () => {
  const heading = (text: string): DocLine => ({ text, bold: true, bullet: false, heading: true, headingLevel: 3 })
  const doc = [
    heading('Question 1'),
    line('The bone is covered on the outer surfaces by a fibrous membrane called the:'),
    line('A. periosteum B. endosteum C. trabeculae D. cortices'),
    line('Answer: A'),
    heading('Question 2'),
    line('The hollow, tubelike structure within the diaphysis is the:'),
    line('A. epiphyses B. medullary cavity C. compact bone D. metaphysis'),
    line('Answer: B', { bold: true }),
    line('ZELMAN', { bold: true }),
  ]

  it('reads every question, splits the choices and uses the answers', () => {
    const r = reformatQuiz(doc)
    expect(r.parsed.questions.map((q) => [q.number, q.text, q.answers.find((a) => a.correct)?.text])).toEqual([
      [1, 'The bone is covered on the outer surfaces by a fibrous membrane called the:', 'periosteum'],
      [2, 'The hollow, tubelike structure within the diaphysis is the:', 'medullary cavity'],
    ])
    expect(texts(r).slice(0, 6)).toEqual([
      '1) The bone is covered on the outer surfaces by a fibrous membrane called the:',
      '*a) periosteum',
      'b) endosteum',
      'c) trabeculae',
      'd) cortices',
      '2) The hollow, tubelike structure within the diaphysis is the:',
    ])
  })

  it('keeps the stray line and flags it rather than dropping it', () => {
    const r = reformatQuiz(doc)
    expect(texts(r)).toContain('ZELMAN')
    expect(r.parsed.issues.some((i) => /not understood/.test(i.message) && /ZELMAN/.test(i.message))).toBe(true)
  })
})

describe('text copied out of Canvas', () => {
  it('reads the student view: header with points, page text, choices with no letters', () => {
    const r = reformatQuiz(
      lines(
        'Flag question: Question 1',
        'Question 1 2 pts',
        'Which bone is the longest in the body?',
        'Group of answer choices',
        'humerus',
        '*femur',
        'tibia',
        'Flag question: Question 2',
        'Question 2 1 pts',
        'Bones store which mineral?',
        'Group of answer choices',
        'iron',
        '*calcium',
      ),
    )
    expect(texts(r)).toEqual([
      'Points: 2',
      '1) Which bone is the longest in the body?',
      'a) humerus',
      '*b) femur',
      'c) tibia',
      'Points: 1',
      '2) Bones store which mineral?',
      'a) iron',
      '*b) calcium',
    ])
    expect(r.parsed.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.changes.some((c) => /Removed text copied from the Canvas page/.test(c.message))).toBe(true)
    expect(r.changes.filter((c) => c.kind === 'grading' && /had no letters/.test(c.message))).toHaveLength(2)
  })

  it('uses the results view’s “Correct Answer” label, never “You Answered”', () => {
    const r = reformatQuiz(lines('Question 1 1 pts', 'Which is a star?', 'You Answered', 'the moon', 'Correct Answer', 'the sun', 'Mars'))
    expect(texts(r)).toEqual(['Points: 1', '1) Which is a star?', 'a) the moon', '*b) the sun', 'c) Mars'])
    expect(r.changes.some((c) => c.kind === 'answer' && /Correct Answer/.test(c.message))).toBe(true)
  })

  it('works out “Question 32 pts” from the question order, and asks for a check', () => {
    const r = reformatQuiz(lines('Question 1 1 pts', 'First?', '*a) x', 'b) y', 'Question 2 1 pts', 'Second?', '*a) x', 'b) y', 'Question 32 pts', 'Third?', '*a) x', 'b) y'))
    expect(r.parsed.questions.map((q) => [q.number, q.points])).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
    ])
    expect(r.changes.find((c) => c.kind === 'grading' && /Question 32 pts/.test(c.message))?.message).toMatch(/Check the points/)
  })

  it('takes points from a “2 pts” line under the header', () => {
    const r = reformatQuiz(lines('Question 1', '2 pts', 'Explain.', 'Type: E'))
    expect(r.parsed.questions[0]?.points ?? texts(r)).toBeTruthy()
    expect(texts(r)[0]).toBe('Points: 2')
  })

  it('renumbers Canvas question-bank ids', () => {
    const r = reformatQuiz(lines('48213. Which is a primary color?', '*a) red', 'b) green', '48214. Which is a mammal?', 'a) shark', '*b) whale'))
    expect(r.parsed.questions.map((q) => q.number)).toEqual([1, 2])
  })

  it('joins a question that runs on to the next line before lettering choices', () => {
    const r = reformatQuiz(lines('Question 1 1 pts', 'The longest bone in the', 'body is the:', 'femur', 'tibia'))
    expect(r.parsed.questions[0].text).toBe('The longest bone in the body is the:')
    expect(r.parsed.questions[0].answers.map((a) => a.text)).toEqual(['femur', 'tibia'])
  })
})

describe('points for questions with none', () => {
  it('adds Points above the question and any Type line, and leaves text-only items alone', () => {
    const fixed = addDefaultPoints(
      ['Points: 3', '1) Has points', '*a) x', 'b) y', 'Type: E', '2) No points', 'Type: Text only', 'Text to display: Read this.', '3) Also none', '*a) p', 'b) q'].map((text) => ({ text, changed: false, heading: false })),
      1,
    )
    expect(fixed.added).toBe(2)
    expect(fixed.lines.map((l) => l.text)).toEqual(['Points: 3', '1) Has points', '*a) x', 'b) y', 'Points: 1', 'Type: E', '2) No points', 'Type: Text only', 'Text to display: Read this.', 'Points: 1', '3) Also none', '*a) p', 'b) q'])
    expect(fixed.lines.filter((l) => l.changed).map((l) => l.text)).toEqual(['Points: 1', 'Points: 1'])
  })
})
