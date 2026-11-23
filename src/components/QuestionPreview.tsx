import { AlertCircle, AlertTriangle, Check, X } from 'lucide-react'
import type { Issue, Question } from '../../electron/ipc/quizModel'
import { TYPE_LABELS } from '../../electron/ipc/quizFormat'

/**
 * One question as it will land in Canvas, with its problems under it.
 *
 * Shows what the app understood, not what the document said: if a correct answer is missing a
 * tick here, it is missing in Canvas. That is the point of the preview.
 */
export function QuestionPreview({ q, index, issues }: { q: Question; index: number; issues: Issue[] }) {
  const hasError = issues.some((i) => i.severity === 'error')
  const hasWarning = issues.some((i) => i.severity === 'warning')
  const border = hasError ? 'border-red-300' : hasWarning ? 'border-amber-300' : 'border-gray-200'
  const points = q.type === 'text_only' ? null : (q.points ?? 1)

  return (
    <li className={`list-none bg-white border-2 ${border} rounded-xl p-3.5`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[12px] font-black text-gray-900">{q.number !== null ? `Question ${q.number}` : `Item ${index + 1}`}</span>
        <span className="text-[10.5px] font-black tracking-wide px-2 py-0.5 rounded-full bg-[#dbe7fb] text-[#0a2a6b]">
          {TYPE_LABELS[q.type].toUpperCase()}
        </span>
        {points !== null && (
          <span className="ml-auto text-[12px] font-bold text-gray-700">
            {points} {points === 1 ? 'point' : 'points'}
          </span>
        )}
      </div>

      <p className="text-[13.5px] text-gray-900 whitespace-pre-line m-0">{q.text || <i className="text-gray-600">No question text</i>}</p>

      <QuestionBody q={q} />

      {issues.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 p-0">
          {issues.map((issue, i) => (
            <li
              key={i}
              className={`list-none flex items-start gap-2 rounded-lg p-2 text-[12.5px] ${
                issue.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
              }`}
            >
              {issue.severity === 'error' ? (
                <AlertCircle className="w-4 h-4 mt-px flex-shrink-0 text-red-700" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 mt-px flex-shrink-0 text-amber-700" aria-hidden="true" />
              )}
              <span>
                <span className="sr-only">{issue.severity === 'error' ? 'Problem: ' : 'Check: '}</span>
                {issue.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function Choice({ text, correct }: { text: string; correct: boolean }) {
  return (
    <li className={`list-none flex items-start gap-2 text-[13px] ${correct ? 'text-green-900 font-bold' : 'text-gray-700'}`}>
      {correct ? (
        <Check className="w-4 h-4 mt-px flex-shrink-0 text-green-700" aria-hidden="true" />
      ) : (
        <X className="w-4 h-4 mt-px flex-shrink-0 text-gray-600" aria-hidden="true" />
      )}
      <span>
        {text}
        <span className="sr-only">{correct ? ' (correct)' : ' (incorrect)'}</span>
      </span>
    </li>
  )
}

function QuestionBody({ q }: { q: Question }) {
  switch (q.type) {
    case 'multiple_choice':
    case 'multiple_answers':
    case 'true_false':
      return (
        <ul className="mt-2 space-y-1 p-0">
          {q.answers.map((a, i) => (
            <Choice key={i} text={a.text} correct={a.correct} />
          ))}
        </ul>
      )
    case 'fill_in_blank':
      return (
        <p className="mt-2 text-[13px] text-gray-700 m-0">
          Accepted answers: <b className="text-gray-900">{q.answers.map((a) => a.text).join(' · ') || 'none'}</b>
        </p>
      )
    case 'ordering':
      return (
        <ol className="mt-2 pl-5 text-[13px] text-gray-800">
          {q.answers.map((a, i) => (
            <li key={i}>{a.text}</li>
          ))}
        </ol>
      )
    case 'matching':
      return (
        <div className="mt-2 text-[13px]">
          <ul className="space-y-1 p-0">
            {q.matches.map((m, i) => (
              <li key={i} className="list-none text-gray-800">
                {m.left} <span className="text-gray-600">→</span> <b className="text-gray-900">{m.right}</b>
              </li>
            ))}
          </ul>
          {q.distractors.length > 0 && <p className="mt-1 text-gray-600 m-0">Extra wrong matches: {q.distractors.join(', ')}</p>}
        </div>
      )
    case 'multiple_dropdowns':
      return (
        <ul className="mt-2 space-y-1 p-0 text-[13px]">
          {q.dropdowns.map((d, i) => (
            <li key={i} className="list-none text-gray-800">
              <b>[{d.variable}]</b> {d.options.map((o, k) => <span key={k}>{k > 0 && ' · '}{o.correct && <><span aria-hidden="true">✓ </span><span className="sr-only">(correct) </span></>}{o.text}</span>)}
            </li>
          ))}
        </ul>
      )
    case 'categorization':
      return (
        <div className="mt-2 text-[13px] space-y-1">
          {q.categories.map((c, i) => (
            <p key={i} className="m-0 text-gray-800">
              <b>{c.name}</b>
              {c.description ? ` (${c.description})` : ''}: {c.items.join(', ')}
            </p>
          ))}
          {q.distractors.length > 0 && <p className="m-0 text-gray-600">In no category: {q.distractors.join(', ')}</p>}
        </div>
      )
    case 'numeric': {
      const n = q.numeric
      const text = !n
        ? 'No answer'
        : n.kind === 'exact'
          ? `Exactly ${n.value}`
          : n.kind === 'margin'
            ? `${n.value} ± ${n.margin}${n.marginType === 'percent' ? '%' : ''}`
            : n.kind === 'range'
              ? `Between ${n.start} and ${n.end}`
              : `${n.value} to ${n.precision} ${n.precisionType === 'significant' ? 'significant digits' : 'decimal places'}`
      return <p className="mt-2 text-[13px] text-gray-800 m-0">Answer: <b>{text}</b></p>
    }
    case 'file_upload': {
      const f = q.fileUpload
      const parts = [
        f?.fileLimit ? `up to ${f.fileLimit} file${f.fileLimit === 1 ? '' : 's'}` : 'any number of files',
        f?.fileTypes.length ? `types: ${f.fileTypes.join(', ')}` : 'any file type',
        f?.showCalculator ? 'calculator shown' : null,
      ].filter(Boolean)
      return <p className="mt-2 text-[13px] text-gray-700 m-0">Students upload {parts.join(' · ')}.</p>
    }
    default:
      return null
  }
}
