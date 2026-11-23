import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Check, Loader2, Sparkles, X } from 'lucide-react'
import type { ProposeRevisionResult } from '../types'
import { ErrorText, cleanErrorMessage } from './ErrorText'

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
  /** Called after an accepted revision is written, with the tab it went to (Revised by Gemini). */
  onApplied(stamp: string, target: { fileId: string; name: string; tabId: string | null }): void
}) {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<'asking' | 'writing' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const proposalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // A proposal belongs to the tab as it was read: the panel is remounted on every read, and the
  // proposal held in the main process goes with it.
  const held = useRef<string | null>(null)
  held.current = proposal?.proposalId ?? null
  useEffect(() => () => {
    if (held.current) void window.api.quiz.discardRevision()
  }, [])

  const ask = async () => {
    setBusy('asking')
    setError(null)
    setProposal(null)
    try {
      const res = await window.api.quiz.proposeRevision({ fileId: props.fileId, tabId: props.tabId, instruction })
      if (res.ok) {
        setProposal(res)
        setTimeout(() => proposalRef.current?.focus(), 0)
      } else setError(res.message)
    } catch (e) {
      setError(e instanceof Error ? cleanErrorMessage(e.message) : 'Gemini’s change could not be prepared. Nothing was written. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const apply = async (replaceGemini = false) => {
    if (!proposal) return
    setBusy('writing')
    setError(null)
    setConfirm(null)
    try {
      const res = await window.api.quiz.applyRevision({ proposalId: proposal.proposalId, replaceGemini })
      if (!res.ok) {
        if (res.needsConfirm) setConfirm(res.message)
        else setError(res.message)
        return
      }
      setProposal(null)
      setInstruction('')
      props.onApplied(res.stamp, { fileId: res.fileId, name: res.name, tabId: res.tabId })
    } catch (e) {
      setError(e instanceof Error ? cleanErrorMessage(e.message) : 'Gemini’s change could not be written to the Doc. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const discard = () => {
    setProposal(null)
    setConfirm(null)
    void window.api.quiz.discardRevision()
    setTimeout(() => inputRef.current?.focus(), 0)
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
            ref={inputRef}
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
        <div ref={proposalRef} tabIndex={-1} role="group" aria-labelledby="revise-proposal-h" className="rounded-xl border-2 border-purple-300 p-3.5 space-y-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <h3 id="revise-proposal-h" className="text-sm font-black text-gray-900 m-0">Gemini’s proposed change</h3>
          {graded.length > 0 && (
            <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
              <h4 className="flex items-center gap-2 text-xs font-black text-amber-900 uppercase tracking-wide m-0">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                Check these answers and points
              </h4>
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
              <h4 className="text-xs font-black text-gray-800 uppercase tracking-wide m-0">Other changes</h4>
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
              onClick={() => void apply(false)}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-xs font-black disabled:bg-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              {busy === 'writing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Check className="w-3.5 h-3.5" aria-hidden="true" />}
              {busy === 'writing' ? 'Writing to the tab…' : 'Use this version'}
            </button>
            <button
              onClick={discard}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-500 bg-white text-gray-800 text-xs font-bold hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Discard
            </button>
          </div>
          {confirm && (
            <div role="alert" onKeyDown={(e) => e.key === 'Escape' && setConfirm(null)} className="rounded-lg border border-purple-300 bg-purple-50 p-2.5">
              <p className="m-0 text-[12.5px] text-gray-800">{confirm}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <button ref={(el) => el?.focus()} onClick={() => void apply(true)} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-black focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
                  Replace it
                </button>
                <button onClick={() => setConfirm(null)} className="px-3 py-1.5 rounded-lg border border-gray-500 bg-white text-xs font-bold text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  Keep it
                </button>
              </div>
            </div>
          )}
          <p className="text-xs text-gray-600 m-0">
            Using it writes to the <b>Revised by Gemini</b> tab, with a new time stamp at the top. The original and the no-AI Reformatted
            questions tab are not changed. You will need to tick Checked again.
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
