import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, Loader2, Wand2, X } from 'lucide-react'
import type { ReformatResult } from '../types'
import { ErrorText } from './ErrorText'

type Done = Extract<ReformatResult, { ok: true }>

/**
 * What the reformat did, for a person to check — modelled on Canvas Rubric Creator's repair panel.
 *
 * Purple border: changes nobody has approved yet. Answer and grading changes come first and in
 * amber, apart from formatting, because they are the ones that change what students are graded
 * on; the list is the app's own record of what it changed, not an AI's account.
 */
export function ReformatReview({ result, onDismiss }: { result: Done; onDismiss(): void }) {
  const graded = result.changes.filter((c) => c.kind !== 'format')
  const format = result.changes.filter((c) => c.kind === 'format')

  return (
    <section
      aria-labelledby="review-h"
      tabIndex={-1}
      id="reformat-review"
      className="rounded-2xl border-2 border-purple-300 bg-white p-4 space-y-3 focus:outline-none"
    >
      <div className="flex items-start gap-2">
        <h2 id="review-h" className="font-black text-[15px] text-gray-900 m-0 flex-1">
          {result.nothingChanged ? 'Nothing to reformat' : 'Check the reformatted questions'}
        </h2>
        <button onClick={onDismiss} aria-label="Close this summary" className="p-1 rounded text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {result.nothingChanged ? (
        <p className="text-[13px] text-gray-700 m-0">
          The questions are already in the template format, as far as the app can tell. {result.problems.length > 0 ? 'What is left needs a person:' : ''}
        </p>
      ) : (
        <div className="rounded-xl bg-slate-50 border border-gray-200 p-3 text-[13px] text-gray-800">
          <p className="m-0">
            Written to {result.target.inNewDoc ? <>a new Doc, <b>{result.target.name}</b></> : <>the tab <b>{result.target.tabTitle}</b></>} on{' '}
            {result.stamp}. Changed lines are highlighted there.
          </p>
          {result.target.why && <p className="m-0 mt-1 text-amber-900">{result.target.why}</p>}
          <a href={result.target.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 font-black text-brand text-[12.5px]">
            Open it in Google Docs to compare <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      )}

      {result.ai && (
        <p className={`text-[12.5px] m-0 flex items-start gap-2 ${result.ai.used ? 'text-purple-900' : 'text-gray-700'}`}>
          <span className="text-[10px] font-black tracking-wide px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 flex-shrink-0">GEMINI</span>
          <span>{result.ai.note}</span>
        </p>
      )}

      {graded.length > 0 && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
          <h3 className="flex items-center gap-2 text-xs font-black text-amber-900 uppercase tracking-wide m-0">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            Check these answers and points
          </h3>
          <p className="mt-1 mb-0 text-xs text-amber-900">These change what students are graded on. Compare each one with the original.</p>
          <ul className="mt-2 mb-0 space-y-1 pl-4">
            {graded.map((c, i) => (
              <li key={i} className="text-[12.5px] text-gray-900">
                {c.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.problems.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <h3 className="flex items-center gap-2 text-xs font-black text-red-800 uppercase tracking-wide m-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            Still needs a person ({result.problems.length})
          </h3>
          <ul className="mt-2 mb-0 space-y-1 pl-4">
            {result.problems.map((p, i) => (
              <li key={i} className="text-[12.5px] text-red-900">
                {p}
              </li>
            ))}
          </ul>
          <p className="mt-2 mb-0 text-xs text-red-900">
            Fix these in the {result.nothingChanged ? 'Doc' : 'new tab'}, then choose <b>Read again</b> in step 1.
          </p>
        </div>
      )}

      {format.length > 0 && (
        <div>
          <h3 className="text-xs font-black text-gray-800 uppercase tracking-wide m-0">Formatting fixes</h3>
          <ul className="mt-1 mb-0 space-y-0.5 pl-4">
            {format.map((c, i) => (
              <li key={i} className="text-[12.5px] text-gray-700">
                {c.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!result.nothingChanged && result.problems.length === 0 && (
        <p className="flex items-center gap-2 text-[12.5px] text-green-800 m-0">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" aria-hidden="true" />
          All {result.questionCount} questions now read correctly. Step 1 is showing the new tab.
        </p>
      )}
    </section>
  )
}
