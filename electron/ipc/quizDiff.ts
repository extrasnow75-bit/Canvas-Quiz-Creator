/**
 * What changed between two versions of a quiz, worked out by comparing them.
 *
 * Used to show a person what a Gemini revision would do before anything is written. It is the
 * app's account, not the model's: a model's description of its own edit cannot be checked and
 * can leave things out. Answer and grading changes are reported apart from wording, because they
 * are the ones that change what students are graded on.
 *
 * Pure.
 */
import type { Question } from './quizModel'
import type { Change } from './reformat'
import { TYPE_LABELS } from './quizFormat'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function correctOf(q: Question): string[] {
  if (q.type === 'matching') return q.matches.map((m) => `${m.left} = ${m.right}`)
  return q.answers.filter((a) => a.correct).map((a) => norm(a.text))
}

function choicesOf(q: Question): string[] {
  if (q.type === 'matching') return [...q.matches.map((m) => `${m.left} = ${m.right}`), ...q.distractors.map((d) => `= ${d}`)]
  return q.answers.map((a) => norm(a.text))
}

const label = (q: Question, i: number) => `Question ${q.number ?? i + 1}`
const list = (xs: string[]) => (xs.length ? xs.map((x) => `“${x}”`).join(', ') : 'none')

export function diffQuizzes(before: Question[], after: Question[]): Change[] {
  const changes: Change[] = []
  const n = Math.max(before.length, after.length)

  if (before.length !== after.length) {
    changes.push({
      kind: 'grading',
      question: null,
      message: `The number of questions changes from ${before.length} to ${after.length}.`,
    })
  }

  for (let i = 0; i < n; i++) {
    const a = before[i]
    const b = after[i]
    if (!a && b) {
      changes.push({ kind: 'grading', question: b.number, message: `${label(b, i)} is new: “${norm(b.text)}”.` })
      continue
    }
    if (a && !b) {
      changes.push({ kind: 'grading', question: a.number, message: `${label(a, i)} is removed: “${norm(a.text)}”.` })
      continue
    }
    if (!a || !b) continue
    const name = label(b, i)

    if (correctOf(a).join('|') !== correctOf(b).join('|')) {
      changes.push({ kind: 'answer', question: b.number, message: `${name}: correct answer changes from ${list(correctOf(a))} to ${list(correctOf(b))}.` })
    }
    if ((a.points ?? 1) !== (b.points ?? 1)) {
      changes.push({ kind: 'grading', question: b.number, message: `${name}: points change from ${a.points ?? 1} to ${b.points ?? 1}.` })
    }
    if (a.type !== b.type) {
      changes.push({ kind: 'grading', question: b.number, message: `${name}: type changes from ${TYPE_LABELS[a.type]} to ${TYPE_LABELS[b.type]}.` })
    }
    if (norm(a.text) !== norm(b.text)) {
      changes.push({ kind: 'format', question: b.number, message: `${name}: question text changes from “${norm(a.text)}” to “${norm(b.text)}”.` })
    }
    const ca = choicesOf(a)
    const cb = choicesOf(b)
    if (ca.join('|') !== cb.join('|')) {
      const added = cb.filter((x) => !ca.includes(x))
      const removed = ca.filter((x) => !cb.includes(x))
      const parts = [added.length ? `adds ${list(added)}` : '', removed.length ? `removes ${list(removed)}` : '', !added.length && !removed.length ? 'reorders them' : '']
      changes.push({ kind: 'format', question: b.number, message: `${name}: choices change: ${parts.filter(Boolean).join('; ')}.` })
    }
  }

  const rank = { answer: 0, grading: 1, format: 2 }
  return changes.sort((x, y) => rank[x.kind] - rank[y.kind])
}
