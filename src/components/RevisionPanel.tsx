import { useState } from 'react'
import { AlertCircle, AlertTriangle, Check, Loader2, Sparkles, X } from 'lucide-react'
import type { ProposeRevisionResult } from '../types'
import { ErrorText } from './ErrorText'

type Proposal = Extract<ProposeRevisionResult, { ok: true }>

/**
 * "Request changes": ask Gemini to revise the reformatted questions in plain English.
 *
 * Follows Canvas Rubric Creator's repair panel: nothing applies itself. The proposal is shown as
 * the app's own list of what would change, answers and points first, and is written to the tab
 * only when the person chooses "Use this version". Hand edits are the other way, and need no AI:
 * edit the tab in Google Docs and choose Read again.
 */
export function RevisionPanel(props: {
  fileId: string
  tabId: string
  hasGemini: boolean
  /** Called after an accepted revision is written, so the screen can read the tab again. */
  onApplied(stamp: string): void
}) {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<'asking' | 'writing' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)

  const ask = async () => {
    setBusy('asking')
    setError(null)
    setProposal(null)
    try {
      const res = await window.api.quiz.proposeRevision({ fileId: props.fileId, tabId: props.tabId, instruction })
      if (res.ok) setProposal(res)
      else setError(res.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request did not work.')
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (!proposal) return
    setBusy('writing')
    setError(null)
    try {
      const res = await window.api.quiz.applyRevision({ proposalId: proposal.proposalId })
      if (!res.ok) {
        setError(res.message)
        return
      }
      setProposal(null)
      setInstruction('')
      props.onApplied(res.stamp)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The revision could not be written.')
    } finally {
      setBusy(null)
    }
  }

  const discard = () => {
    setProposal(null)
    void window.api.quiz.discardRevision()
  }

  const graded = proposal?.changes.filter((c) => c.kind !== 'format') ?? []
  const wording = proposal?.changes.filter((c) => c.kind === 'format') ?? []

  return (
    <section aria-labelledby="revise-h" className="rounded-2xl border-2 border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-[#6b4fa3] flex-shrink-0" aria-hidden="true" />
        <h2 id="revise-h" className="font-black text-[15px] m-0">
          Change the reformatted questions
        </h2>
      </div>
      <p className="text-[13px] text-gray-600 mb-2.5">
        <b className="text-gray-800">By hand, no AI:</b> edit the tab in Google Docs, then choose <b className="text-gray-800">Read again</b>{' '}
        in step 1.
        {props.hasGemini ? (
          <>
            {' '}
            <b className="text-gray-800">With Gemini:</b> describe the change below. You see exactly what it would change before anything is
            written.
          </>
        ) : (
          <> To ask for changes in plain English instead, add a Gemini API key in Initial setup.</>
        )}
      </p>

      {props.hasGemini && !proposal && (
        <>
          <label htmlFor="revise-input" className="sr-only">
            The change you would like
          </label>
          <textarea
            id="revise-input"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="For example: Question 4 is really two questions. Split it."
            className="w-full border-2 border-gray-500 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-blue-200 transition"
          />
          <button
            onClick={() => void ask()}
            disabled={!instruction.trim() || busy !== null}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-xs font-black disabled:bg-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {busy === 'asking' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
            {busy === 'asking' ? 'Asking Gemini…' : 'Ask Gemini for this change'}
          </button>
        </>
      )}

      {proposal && (
        <div role="group" aria-label="Proposed change" className="rounded-xl border-2 border-purple-300 p-3.5 space-y-3">
          <p className="text-sm font-black text-gray-900 m-0">Gemini’s proposed change</p>
          {graded.length > 0 && (
            <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
              <p className="flex items-center gap-2 text-xs font-black text-amber-900 uppercase tracking-wide m-0">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                Check these answers and points
              </p>
              <ul className="mt-2 mb-0 space-y-1 pl-4">
                {graded.map((c, i) => (
                  <li key={i} className="text-[12.5px] text-gray-900">
                    {c.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {wording.length > 0 && (
            <div>
              <p className="text-xs font-black text-gray-800 uppercase tracking-wide m-0">Other changes</p>
              <ul className="mt-1 mb-0 space-y-0.5 pl-4">
                {wording.map((c, i) => (
                  <li key={i} className="text-[12.5px] text-gray-700">
                    {c.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {proposal.problems.length > 0 && (
            <p className="text-[12.5px] text-red-800 m-0">
              Still needs a person afterwards: {proposal.problems.join(' ')}
            </p>
          )}
          {proposal.notes && (
            <p className="text-xs text-gray-600 italic m-0">
              Gemini describes its change as: “{proposal.notes.replace(/[.\s]+$/, '')}”. The lists above are what it actually changes.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void apply()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-xs font-black disabled:bg-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              {busy === 'writing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Check className="w-3.5 h-3.5" aria-hidden="true" />}
              {busy === 'writing' ? 'Writing to the tab…' : 'Use this version'}
            </button>
            <button
              onClick={discard}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-400 bg-white text-gray-800 text-xs font-bold hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Discard
            </button>
          </div>
          <p className="text-xs text-gray-600 m-0">
            Using it rewrites the reformatted tab, with a new time stamp at the top. You will need to tick Ready for Canvas again.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12.5px] text-red-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span role="alert">
            <ErrorText message={error} />
          </span>
        </p>
      )}
    </section>
  )
}
