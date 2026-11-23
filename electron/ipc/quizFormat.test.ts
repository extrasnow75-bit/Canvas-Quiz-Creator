import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { docToLines, listTabs, type DocsDocument } from './docLines'
import { engineIssues, parseQuiz } from './quizFormat'

/** The eCampus "Quiz Formatting Tool Example Doc", as the Docs API returns it. */
const template = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'ecampus-template.json'), 'utf-8'),
) as DocsDocument

const tabId = (title: string) => listTabs(template).find((t) => t.title === title)!.id

const errors = (r: ReturnType<typeof parseQuiz>) => r.issues.filter((i) => i.severity === 'error')

describe('the eCampus template document', () => {
  it('finds every type in the Classic Quiz tab, in order', () => {
    const r = parseQuiz(docToLines(template, tabId('Classic Quiz Question Templates')))
    expect(r.questions.map((q) => q.type)).toEqual([
      'multiple_choice',
      'true_false',
      'multiple_answers',
      'essay',
      'fill_in_blank',
      'matching',
      'file_upload',
      'multiple_dropdowns',
      'text_only',
    ])
  })

  it('finds every type in the New Quiz tab, in order', () => {
    const r = parseQuiz(docToLines(template, tabId('New Quiz Question Templates')))
    expect(r.questions.map((q) => q.type)).toEqual([
      'multiple_choice',
      'true_false',
      'multiple_answers',
      'essay',
      'matching',
      'categorization',
      'numeric',
      'file_upload',
      'text_only',
    ])
  })

  it('reads the template structure of each block', () => {
    const r = parseQuiz(docToLines(template, tabId('New Quiz Question Templates')))
    const [mc, tf, ma, , mt, cat] = r.questions
    expect(mc.answers.filter((a) => a.correct)).toHaveLength(1)
    expect(tf.answers.map((a) => a.text)).toEqual(['True', 'False'])
    expect(ma.answers.filter((a) => a.correct)).toHaveLength(2)
    expect(mt.matches).toEqual([
      { left: 'Answer', right: 'Match' },
      { left: 'Answer', right: 'Match' },
      { left: 'Answer', right: 'Match' },
    ])
    expect(cat.categories.map((c) => c.items.length)).toEqual([3, 3])
    expect(cat.distractors).toEqual(['Distractor', 'Distractor'])
    expect(cat.markedManualBuild).toBe(true)
  })

  it('splits Points and Type written in one paragraph with a soft line break', () => {
    const lines = docToLines(template, tabId('Classic Quiz Question Templates')).map((l) => l.text)
    expect(lines).toContain('Points: #')
    expect(lines).toContain('Type: E')
  })

  it('skips the template headings', () => {
    const lines = docToLines(template, tabId('Classic Quiz Question Templates'))
    expect(lines.find((l) => l.text.startsWith('Multiple Choice Template'))?.heading).toBe(true)
  })

  it('flags the placeholders the template leaves for the developer', () => {
    const r = parseQuiz(docToLines(template, tabId('Classic Quiz Question Templates')))
    expect(r.issues.some((i) => /Points says "#"/.test(i.message))).toBe(true)
    expect(r.issues.some((i) => /still says "Question"/.test(i.message))).toBe(true)
  })
})

describe('a filled-in quiz', () => {
  const quiz = `
Points: 2
1) What is the capital of France?
a) London
*b) Paris
c) Rome

Points: 1
2) The Earth orbits the Sun.
*a) True
b) False

Type: MA
Points: 3
3) Which are primary colors?
*a) Red
b) Green
*c) Blue

Points: 5
Type: E
4) Explain the causes of World War I.

Points: 4
Type: MT
5) Match each country to its capital.
a) Japan = Tokyo
b) Kenya = Nairobi
c) = Lima
`.split('\n')

  it('reads every question with no problems', () => {
    const r = parseQuiz(quiz)
    expect(r.issues).toEqual([])
    expect(r.questions.map((q) => [q.number, q.type, q.points])).toEqual([
      [1, 'multiple_choice', 2],
      [2, 'true_false', 1],
      [3, 'multiple_answers', 3],
      [4, 'essay', 5],
      [5, 'matching', 4],
    ])
  })

  it('keeps the correct answers', () => {
    const r = parseQuiz(quiz)
    expect(r.questions[0].answers).toEqual([
      { text: 'London', correct: false },
      { text: 'Paris', correct: true },
      { text: 'Rome', correct: false },
    ])
  })

  it('treats a match with nothing on the left as a distractor', () => {
    const mt = parseQuiz(quiz).questions[4]
    expect(mt.matches).toHaveLength(2)
    expect(mt.distractors).toEqual(['Lima'])
  })
})

describe('forgiving about how people type', () => {
  it('accepts 1. and A. and a space after the asterisk', () => {
    const r = parseQuiz(['Points: 1', '1. Pick one', 'A. no', '* B. yes'])
    expect(errors(r)).toEqual([])
    expect(r.questions[0].answers.map((a) => a.correct)).toEqual([false, true])
  })

  it('reads an asterisk after the letter, with a warning', () => {
    const r = parseQuiz(['Points: 1', '1) Pick one', 'a) no', 'b) *yes'])
    expect(r.questions[0].answers[1]).toEqual({ text: 'yes', correct: true })
    expect(r.issues.some((i) => i.severity === 'warning' && /after the letter/.test(i.message))).toBe(true)
  })

  it('ignores non-breaking spaces from Word and Docs', () => {
    const r = parseQuiz(['Points: 2', '1) Pick', '*a) yes', 'b) no'])
    expect(r.questions[0].points).toBe(2)
    expect(errors(r)).toEqual([])
  })

  it('keeps a question that runs over several paragraphs', () => {
    const r = parseQuiz(['Points: 1', '1) Read the passage.', 'Then choose the best summary.', '*a) one', 'b) two'])
    expect(r.questions[0].text).toBe('Read the passage.\nThen choose the best summary.')
  })

  it('accepts type names spelled out', () => {
    const r = parseQuiz(['Type: Multiple Answer', 'Points: 1', '1) Pick', '*a) x', '*b) y'])
    expect(r.questions[0].type).toBe('multiple_answers')
  })
})

describe('strict about what changes what students see', () => {
  it('refuses a multiple choice with no correct answer', () => {
    const r = parseQuiz(['Points: 1', '1) Pick', 'a) x', 'b) y'])
    expect(errors(r)[0].message).toMatch(/No answer is marked correct/)
  })

  it('refuses two correct answers without Type: MA', () => {
    const r = parseQuiz(['Points: 1', '1) Pick', '*a) x', '*b) y'])
    expect(errors(r)[0].message).toMatch(/Type: MA/)
  })

  it('refuses a question with no choices and no type', () => {
    const r = parseQuiz(['Points: 1', '1) Explain.'])
    expect(errors(r)[0].message).toMatch(/Type: E/)
  })

  it('refuses a matching pair with no =', () => {
    const r = parseQuiz(['Type: MT', 'Points: 1', '1) Match', 'a) Japan Tokyo'])
    expect(errors(r).some((i) => /has no "="/.test(i.message))).toBe(true)
  })

  it('refuses an unknown type', () => {
    const r = parseQuiz(['Type: Hotspot', 'Points: 1', '1) Click it'])
    expect(errors(r)[0].message).toMatch(/not a question type the app knows/)
  })

  it('warns when points are missing', () => {
    const r = parseQuiz(['1) Pick', '*a) x', 'b) y'])
    expect(r.issues[0]).toMatchObject({ severity: 'warning', question: 0 })
  })

  it('reports a document with no questions', () => {
    const r = parseQuiz(['Some notes', 'More notes'])
    expect(r.questions).toEqual([])
    expect(errors(r)[0].message).toMatch(/No questions found/)
  })
})

describe('the manual-build types', () => {
  it('reads file upload settings', () => {
    const r = parseQuiz(['Type: File', 'Points: 10', '1) Upload your essay.', 'Limit File number: 2', 'Restrict File Types: .pdf, docx'])
    expect(r.questions[0].fileUpload).toEqual({ showCalculator: false, fileLimit: 2, fileTypes: ['pdf', 'docx'] })
  })

  it('reads multiple dropdowns, first option correct as the template says', () => {
    const r = parseQuiz([
      'Type: MD', 'Points: 2', '1) The [animal] says [sound].',
      '[animal]', 'cow', 'cat', '[sound]', 'woof', '*moo',
    ])
    expect(errors(r)).toEqual([])
    const [animal, sound] = r.questions[0].dropdowns
    expect(animal.options.find((o) => o.correct)?.text).toBe('cow')
    expect(sound.options.find((o) => o.correct)?.text).toBe('moo')
  })

  it('reads the one filled-in numeric requirement', () => {
    const r = parseQuiz([
      'Type: Numeric', 'Points: 1', '1) What is pi to two places?', 'Choose 1:',
      'Requirement: Exact response', 'Answer =',
      'Requirement: Margin of error', 'Answer = 3.14', '+/- = 0.01', 'Type = absolute',
      'Requirement: Within a range', 'Range start =', 'Range end =',
    ])
    expect(errors(r)).toEqual([])
    expect(r.questions[0].numeric).toEqual({ kind: 'margin', value: 3.14, margin: 0.01, marginType: 'absolute' })
  })

  it('reads a text-only item, which has no number', () => {
    const r = parseQuiz(['Type: Text only', 'Text to display: Read section 2 before answering.'])
    expect(r.questions[0]).toMatchObject({ type: 'text_only', text: 'Read section 2 before answering.', points: 0 })
  })
})

describe('engine compatibility', () => {
  it('refuses categorization in Classic Quizzes and dropdowns in New Quizzes', () => {
    const cat = parseQuiz(['Type: Categorize', 'Points: 1', '1) Sort', 'Fruit: grows on trees', 'apple']).questions
    const md = parseQuiz(['Type: MD', 'Points: 1', '1) [x]', '[x]', 'a', 'b']).questions
    expect(engineIssues(cat, 'classic')).toHaveLength(1)
    expect(engineIssues(cat, 'new')).toEqual([])
    expect(engineIssues(md, 'new')).toHaveLength(1)
    expect(engineIssues(md, 'classic')).toEqual([])
  })
})

describe('Google Docs automatic numbering', () => {
  it('writes the numbers and letters Docs shows on screen', () => {
    const doc: DocsDocument = {
      lists: {
        L: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL', glyphFormat: '%0.' }, { glyphType: 'ALPHA', glyphFormat: '%1)' }] } },
      },
      body: {
        content: [
          { paragraph: { elements: [{ textRun: { content: 'Points: 1\n' } }] } },
          { paragraph: { bullet: { listId: 'L' }, elements: [{ textRun: { content: 'First question\n' } }] } },
          { paragraph: { bullet: { listId: 'L', nestingLevel: 1 }, elements: [{ textRun: { content: 'no\n' } }] } },
          { paragraph: { bullet: { listId: 'L', nestingLevel: 1 }, elements: [{ textRun: { content: '*yes\n' } }] } },
          { paragraph: { elements: [{ textRun: { content: 'Points: 1\n' } }] } },
          { paragraph: { bullet: { listId: 'L' }, elements: [{ textRun: { content: 'Second question\n' } }] } },
          { paragraph: { bullet: { listId: 'L', nestingLevel: 1 }, elements: [{ textRun: { content: 'x\n' } }] } },
        ],
      },
    }
    expect(docToLines(doc).map((l) => l.text)).toEqual([
      'Points: 1', '1. First question', 'a) no', 'b) *yes', 'Points: 1', '2. Second question', 'a) x',
    ])
  })
})

describe('questions in another format are problems, not notes', () => {
  it('reports "Question 1:" before the first template question', () => {
    const r = parseQuiz(['Points: 1', 'Question 1: Largest planet?', 'A. Mars', 'B. Jupiter', 'Points: 1', '2) Pick', '*a) x', 'b) y'])
    expect(r.questions).toHaveLength(1)
    expect(errors(r).some((i) => /not in the template format/.test(i.message))).toBe(true)
  })

  it('reports one after a template question', () => {
    const r = parseQuiz(['Points: 1', '1) Pick', '*a) x', 'b) y', 'Question 2: Why?'])
    expect(errors(r).some((i) => /not in the template format/.test(i.message))).toBe(true)
  })
})
