import { describe, expect, it } from 'vitest'
import { parseQuiz } from './quizFormat'
import { canBuild, classicQuestionBody, classicQuizBody, newQuizBody, newQuizItemBody, toHtml } from './quizPayloads'

const one = (lines: string[]) => parseQuiz(lines).questions[0]
const ids = () => {
  let n = 0
  return () => `id${++n}`
}

describe('text', () => {
  it('escapes HTML and makes one paragraph per line', () => {
    expect(toHtml('Is 2 < 3?\nExplain & justify.')).toBe('<p>Is 2 &lt; 3?</p><p>Explain &amp; justify.</p>')
  })
})

describe('Classic Quizzes', () => {
  it('creates the quiz unpublished', () => {
    expect(classicQuizBody({ title: 'Quiz 1', description: '' }).quiz).toMatchObject({ title: 'Quiz 1', published: false, quiz_type: 'assignment' })
  })

  it('builds multiple choice with weights', () => {
    const q = one(['Points: 2', '1) Capital of France?', 'a) London', '*b) Paris'])
    expect(classicQuestionBody(q, 0).question).toMatchObject({
      question_type: 'multiple_choice_question',
      points_possible: 2,
      question_text: '<p>Capital of France?</p>',
      answers: [
        { answer_text: 'London', answer_weight: 0 },
        { answer_text: 'Paris', answer_weight: 100 },
      ],
    })
  })

  it('builds matching with distractors', () => {
    const q = one(['Type: MT', 'Points: 2', '1) Match', 'a) Japan = Tokyo', 'b) = Lima'])
    expect(classicQuestionBody(q, 0).question).toMatchObject({
      question_type: 'matching_question',
      answers: [{ answer_match_left: 'Japan', answer_match_right: 'Tokyo', answer_weight: 100 }],
      matching_answer_incorrect_matches: 'Lima',
    })
  })

  it('builds multiple dropdowns with blank ids', () => {
    const q = one(['Type: MD', 'Points: 1', '1) The cow says [sound].', '[sound]', 'moo', 'woof'])
    expect(classicQuestionBody(q, 0).question.answers).toEqual([
      { blank_id: 'sound', answer_text: 'moo', answer_weight: 100 },
      { blank_id: 'sound', answer_text: 'woof', answer_weight: 0 },
    ])
  })

  it('turns a percentage margin into a distance', () => {
    const q = one(['Type: Numeric', 'Points: 1', '1) 200?', 'Requirement: Margin of error', 'Answer = 200', '+/- = 5', 'Type = percent'])
    expect(classicQuestionBody(q, 0).question.answers).toEqual([
      { numerical_answer_type: 'exact_answer', answer_exact: 200, answer_error_margin: 10, answer_weight: 100 },
    ])
  })

  it('builds file upload, essay and text only with no answers', () => {
    expect(classicQuestionBody(one(['Type: File', 'Points: 5', '1) Upload it.']), 0).question.question_type).toBe('file_upload_question')
    expect(classicQuestionBody(one(['Type: E', 'Points: 5', '1) Discuss.']), 0).question.question_type).toBe('essay_question')
    expect(classicQuestionBody(one(['Type: Text only', 'Text to display: Read this.']), 0).question).toMatchObject({
      question_type: 'text_only_question',
      points_possible: 0,
    })
  })

  it('refuses categorization', () => {
    const q = one(['Type: Categorize', 'Points: 1', '1) Sort', 'Fruit: f', 'apple'])
    expect(canBuild(q, 'classic')).toBe(false)
    expect(() => classicQuestionBody(q, 0)).toThrow()
  })
})

describe('New Quizzes', () => {
  it('creates the quiz with points grading', () => {
    expect(newQuizBody({ title: 'Quiz 1', description: '' }).quiz).toMatchObject({ title: 'Quiz 1', grading_type: 'points' })
  })

  it('points multiple choice scoring at the correct choice', () => {
    const q = one(['Points: 2', '1) Pick', 'a) no', '*b) yes'])
    const { item } = newQuizItemBody(q, 0, ids())
    expect(item).toMatchObject({ position: 1, points_possible: 2, entry_type: 'Item' })
    expect(item.entry).toMatchObject({
      interaction_type_slug: 'choice',
      interaction_data: { choices: [{ id: 'id1', position: 1, item_body: '<p>no</p>' }, { id: 'id2', position: 2, item_body: '<p>yes</p>' }] },
      scoring_data: { value: 'id2' },
      scoring_algorithm: 'Equivalence',
    })
  })

  it('scores true/false as a boolean', () => {
    const q = one(['Points: 1', '1) Sky is green.', 'a) True', '*b) False'])
    expect(newQuizItemBody(q, 0, ids()).item.entry).toMatchObject({ interaction_type_slug: 'true-false', scoring_data: { value: false } })
  })

  it('lists every correct multiple answer', () => {
    const q = one(['Type: MA', 'Points: 1', '1) Pick', '*a) x', 'b) y', '*c) z'])
    expect(newQuizItemBody(q, 0, ids()).item.entry).toMatchObject({ interaction_type_slug: 'multi-answer', scoring_data: { value: ['id1', 'id3'] } })
  })

  it('builds matching with the distractors among the answers', () => {
    const q = one(['Type: MT', 'Points: 1', '1) Match', 'a) Japan = Tokyo', 'b) = Lima'])
    expect(newQuizItemBody(q, 0, ids()).item.entry).toMatchObject({
      interaction_type_slug: 'matching',
      interaction_data: { answers: ['Tokyo', 'Lima'], questions: [{ id: 'id1', item_body: 'Japan' }] },
      scoring_data: { value: { id1: 'Tokyo' }, edit_data: { distractors: ['Lima'] } },
    })
  })

  it('builds categorization with every item in the pool', () => {
    const q = one(['Type: Categorize', 'Points: 1', '1) Sort', 'Fruit: grows on trees', 'apple', 'Additional Distractors', 'rock'])
    const entry = newQuizItemBody(q, 0, ids()).item.entry as Record<string, any>
    expect(entry.interaction_type_slug).toBe('categorization')
    expect(Object.keys(entry.interaction_data.distractors)).toHaveLength(2)
    expect(entry.scoring_data.value[0].scoring_data.value).toHaveLength(1)
  })

  it('builds file upload with its limits', () => {
    const q = one(['Type: File', 'Points: 5', '1) Upload.', 'Limit File number: 2', 'Restrict File Types: pdf', 'Show on-screen calculator'])
    expect(newQuizItemBody(q, 0, ids()).item.entry).toMatchObject({
      interaction_type_slug: 'file-upload',
      calculator_type: 'basic',
      interaction_data: { files_count: '2', restrict_count: true },
      properties: { allowed_types: 'pdf', restrict_types: true },
    })
  })

  it('builds numeric', () => {
    const q = one(['Type: Numeric', 'Points: 1', '1) Range?', 'Requirement: Within a range', 'Range start = 1', 'Range end = 5'])
    expect(newQuizItemBody(q, 0, ids()).item.entry).toMatchObject({
      interaction_type_slug: 'numeric',
      scoring_data: { value: [{ id: 'id1', type: 'withinARange', start: '1', end: '5' }] },
    })
  })

  it('does not build fill in the blank or text only yet', () => {
    expect(canBuild(one(['Type: F', 'Points: 1', '1) The ___ sun.', 'a) hot']), 'new')).toBe(false)
    expect(canBuild(one(['Type: Text only', 'Text to display: x']), 'new')).toBe(false)
  })
})
