import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, Loader2, Wand2, X } from 'lucide-react'
import type { ReformatResult } from '../types'
import { ErrorText } from './ErrorText'

type Done = Extract<ReformatResult, { ok: true }>

/**
 * "Fix quiz formatting": a tool card in the Canvas Extractor Tools style.
 *
 * Works on the Doc and tab chosen in step 1. The reformatted questions go into a new tab of that
 * Doc, never over the original, and nothing reaches Canvas from here: the person checks the new
 * tab and ticks "Ready for Canvas" first.
 */
export function ReformatCard(props: {
  docName: string | null
  hasGemini: boolean
  busy: boolean
  error: string | null
  onRun(): void
}) {
  return (
    <section aria-labelledby="reformat-h" className="bg-white border border-gray-200 rounded-2xl p-4 hover:border-gray-300 hover:shadow-sm transition">
      <div className="flex items-center gap-3">
        <div className="w-[42px] h-[42px] rounded-xl flex items-center justify-center flex-shrink-0 text-white bg-[#6b4fa3]" aria-hidden="true">
          <Wand2 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="reformat-h" className="font-black text-[14.5px] text-gray-900 m-0">
            Fix quiz formatting
          </h2>
          <p className="text-xs text-gray-600 mt-0.5 mb-0">
            Rewrites the questions in the eCampus template format in a new tab of the same Google Doc, with every change highlighted.
            The original questions are not changed.
          </p>
        </div>
        <span className="text-[10px] font-black tracking-wide px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 flex-shrink-0">
          {props.hasGemini ? 'GEMINI IF NEEDED' : 'NO AI'}
        </span>
      </div>
      <button
        onClick={props.onRun}
        disabled={props.busy || !props.docName}
        className="mt-3.5 w-full rounded-xl py-2.5 font-black text-[13px] flex items-center justify-center gap-2 transition bg-brand hover:bg-brand-dark text-white disabled:bg-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        {props.busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Wand2 className="w-4 h-4" aria-hidden="true" />}
        {props.busy ? 'Reformatting…' : props.docName ? `Fix formatting in “${props.docName}”` : 'Choose a Google Doc in step 1 first'}
      </button>
      {props.error && (
        <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12.5px] text-red-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span role="alert">
            <ErrorText message={props.error} />
          </span>
        </p>
      )}
    </section>
  )
}

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
          <p className="flex items-center gap-2 text-xs font-black text-amber-900 uppercase tracking-wide m-0">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            Check these answers and points
          </p>
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
          <p className="flex items-center gap-2 text-xs font-black text-red-800 uppercase tracking-wide m-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            Still needs a person ({result.problems.length})
          </p>
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
          <p className="text-xs font-black text-gray-800 uppercase tracking-wide m-0">Formatting fixes</p>
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
