import { describe, expect, it } from 'vitest'
import { fillTabRequests, isAppHeaderLine, stampFor, tabUrl, uniqueTabTitle, clearTabRequest, newestAppTab, mergeNotes, groupNotes, withoutAppNotes, NOTES_TITLE } from './docsWrite'
import { docToLines, type DocsDocument } from './docLines'
import { reformatQuiz } from './reformat'

const when = new Date(2026, 10, 23, 15, 15)

/** The text a request list puts into an empty tab, and what it highlights and styles. */
function apply(requests: any[]) {
  const text = requests[0].insertText.text as string
  // Docs index 1 is the first character.
  const at = (i: number) => text.slice(i - 1)
  const highlighted = requests
    .filter((r) => r.updateTextStyle?.textStyle?.backgroundColor)
    .map((r) => text.slice(r.updateTextStyle.range.startIndex - 1, r.updateTextStyle.range.endIndex - 1))
  const headings = requests
    .filter((r) => r.updateParagraphStyle && r.updateParagraphStyle.paragraphStyle.namedStyleType !== 'NORMAL_TEXT')
    .map((r) => at(r.updateParagraphStyle.range.startIndex).split('\n')[0])
  return { text, highlighted, headings }
}

describe('writing the reformatted tab', () => {
  const r = reformatQuiz(
    ['Points: 1', '1. Largest planet?', 'a. Mars', 'b. Jupiter', 'c. Venus', 'Answer: B'].map((text) => ({ text, bold: false, bullet: false, heading: false })),
  )
  const requests = fillTabRequests('t.new', r.lines, { check: ['Question 1: marked b) Jupiter correct, from the answer key.'], needsPerson: [] }, when)
  const out = apply(requests)

  it('puts the time stamp at the top', () => {
    expect(out.text.split('\n')[0]).toBe(`Reformatted questions — ${stampFor(when)}`)
    expect(stampFor(when)).toBe('Nov 23, 2026 at 3:15 PM')
  })

  it('writes a short header, pointing to the notes at the end', () => {
    expect(out.headings[0]).toMatch(/^Reformatted questions —/)
    const paras = out.text.split('\n')
    expect(paras[2]).toBe(`1 note about what to check or fix is at the end of this tab, under “${NOTES_TITLE}”.`)
    expect(isAppHeaderLine(paras[2], true)).toBe(true)
  })

  it('puts the notes after the questions, under their own heading', () => {
    const paras = out.text.split('\n')
    const notesAt = paras.indexOf(NOTES_TITLE)
    expect(notesAt).toBeGreaterThan(paras.indexOf('*b) Jupiter'))
    expect(out.headings).toContain(NOTES_TITLE)
    expect(paras.slice(notesAt)).toContain('Check: Question 1: marked b) Jupiter correct, from the answer key.')
    // The notes themselves are ordinary text, readable at normal size.
    expect(out.headings.some((h) => h.startsWith('Check:'))).toBe(false)
  })

  it('highlights exactly the changed lines', () => {
    expect(out.highlighted).toEqual(['1) Largest planet?', 'a) Mars', '*b) Jupiter', 'c) Venus'])
  })

  it('aims every request at the new tab', () => {
    for (const req of requests) {
      const inner = Object.values(req)[0] as any
      expect(inner.range?.tabId ?? inner.location?.tabId).toBe('t.new')
    }
  })

  it('reads back as the same questions, with the header ignored', () => {
    // Rebuild the tab as the Docs API would return it, headings included.
    const paras = out.text.split('\n')
    const headingSet = new Set(out.headings)
    const doc: DocsDocument = {
      body: {
        content: paras.map((p) => ({
          paragraph: {
            paragraphStyle: { namedStyleType: headingSet.has(p) && p ? 'HEADING_6' : 'NORMAL_TEXT' },
            elements: [{ textRun: { content: `${p}\n` } }],
          },
        })),
      },
    }
    const lines = docToLines(doc)
    expect(lines.filter((l) => isAppHeaderLine(l.text, l.heading))).toHaveLength(3)
    const questions = withoutAppNotes(lines)
    expect(questions.some((l) => /Check:|Notes from the app/.test(l.text))).toBe(false)
    const again = reformatQuiz(questions)
    expect(again.lines.some((l) => l.changed)).toBe(false) // already in the template format
    expect(again.parsed.questions[0].answers.find((a) => a.correct)?.text).toBe('Jupiter')
  })
})

describe('the notes', () => {
  it('writes the same note about several questions once', () => {
    expect(
      mergeNotes([
        'Question 1: the choices had no letters.',
        'Question 2: the choices had no letters.',
        'Question 3: the choices had no letters.',
        'Question 4: marked b) x correct.',
        'Question 5: the choices had no letters.',
        'Gave 2 questions with no points 1 point each.',
      ]),
    ).toEqual(['Questions 1–3, 5: the choices had no letters.', 'Question 4: marked b) x correct.', 'Gave 2 questions with no points 1 point each.'])
  })

  it('groups the notes by quiz, needing a person first', () => {
    expect(
      groupNotes({
        check: ['Quiz A · Question 1: lettered.', 'Quiz A · Question 2: lettered.', 'Quiz B · Question 1: lettered.'],
        needsPerson: ['Quiz B · Question 3: No answer is marked correct.'],
        order: ['Quiz A', 'Quiz B'],
      }),
    ).toEqual([
      { title: 'Quiz A', needsPerson: [], check: ['Questions 1–2: lettered.'] },
      { title: 'Quiz B', needsPerson: ['Question 3: No answer is marked correct.'], check: ['Question 1: lettered.'] },
    ])
  })

  it('writes no notes section when there is nothing to say', () => {
    const r = reformatQuiz(['Points: 1', '1) Pick', '*a) x', 'b) y'].map((text) => ({ text, bold: false, bullet: false, heading: false })))
    const text = (fillTabRequests('t.1', r.lines, { check: [], needsPerson: [] }, when)[0] as any).insertText.text as string
    expect(text).not.toContain(NOTES_TITLE)
    expect(text).not.toContain('at the end of this tab')
  })
})

describe('helpers', () => {
  it('names a second tab "Reformatted questions 2"', () => {
    expect(uniqueTabTitle(['Questions'])).toBe('Reformatted questions')
    expect(uniqueTabTitle(['Questions', 'Reformatted questions'])).toBe('Reformatted questions 2')
  })

  it('links to a tab', () => {
    expect(tabUrl('abc', 't.1')).toBe('https://docs.google.com/document/d/abc/edit?tab=t.1')
  })

  it('clears a tab but keeps its final newline', () => {
    expect(clearTabRequest('t.1', 50)).toEqual({ deleteContentRange: { range: { startIndex: 1, endIndex: 49, tabId: 't.1' } } })
    expect(clearTabRequest('t.1', 2)).toBeNull()
  })
})

describe('the Revised by Gemini tab', () => {
  const r = reformatQuiz(['Points: 1', '1) Pick', '*a) x', 'b) y'].map((text) => ({ text, bold: false, bullet: false, heading: false })))
  const lines = r.lines.map((l) => ({ ...l, changed: l.text === '*a) x' }))
  const requests = fillTabRequests('t.gem', lines, { check: [], needsPerson: [] }, when, 'gemini')
  const out = apply(requests)

  it('says it is Gemini’s, with the time stamp, and how it is highlighted', () => {
    const paras = out.text.split('\n')
    expect(paras[0]).toBe(`Revised by Gemini — ${stampFor(when)}`)
    expect(paras[1]).toMatch(/^Lines Gemini changed from the Reformatted questions tab are highlighted in purple/)
    expect(isAppHeaderLine(paras[0], true)).toBe(true)
    expect(isAppHeaderLine(paras[1], true)).toBe(true)
  })

  it('highlights Gemini’s lines in purple, not yellow', () => {
    const hl = (requests as any[]).filter((q) => q.updateTextStyle?.textStyle?.backgroundColor)
    expect(hl).toHaveLength(1)
    expect(hl[0].updateTextStyle.textStyle.backgroundColor.color.rgbColor).toEqual({ red: 0.91, green: 0.86, blue: 1 })
  })
})

describe('the tab a Doc opens on', () => {
  const tabs = [
    { id: 't.0', title: 'Tab 1' },
    { id: 't.1', title: 'Revised by Gemini' },
    { id: 't.2', title: 'Reformatted questions' },
    { id: 't.3', title: 'Reformatted questions 2' },
  ]
  const headers: Record<string, string[]> = {
    't.0': ['POLS 101 Quizzes'],
    't.1': ['Revised by Gemini — Nov 23, 2026 at 9:05 AM'],
    't.2': ['Reformatted questions — Nov 22, 2026 at 3:15 PM'],
    't.3': ['Reformatted questions — Nov 23, 2026 at 8:40 AM'],
  }

  it('is the newest tab the app wrote, by its time stamp rather than its place', () => {
    expect(newestAppTab(tabs, (id) => headers[id])).toEqual({ id: 't.1', title: 'Revised by Gemini' })
  })

  it('is none when the app wrote no tab, so the first tab is read', () => {
    expect(newestAppTab([tabs[0], { id: 't.9', title: 'Reformatted questions (my notes)' }], (id) => headers[id] ?? [])).toBeNull()
  })

  it('falls back to the later tab when a stamp cannot be read', () => {
    expect(newestAppTab(tabs.slice(2), () => ['Reformatted questions'])).toEqual({ id: 't.3', title: 'Reformatted questions 2' })
  })
})
