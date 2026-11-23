import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, ExternalLink, FileText, Loader2, RefreshCw, Send, Square } from 'lucide-react'
import type { CourseChoice, CourseRunStatus, ProgressEvent, Question, QuizEngine, ReadDocResult, ReformatResult } from '../types'
import type { Issue } from '../../electron/ipc/quizModel'
import { engineIssues } from '../../electron/ipc/quizFormat'
import { canBuild } from '../../electron/ipc/quizPayloads'
import { useDrivePicker } from '../contexts/DrivePickerContext'
import { MultiCoursePicker } from './MultiCoursePicker'
import { QuestionPreview } from './QuestionPreview'
import { ErrorText } from './ErrorText'
import { ReformatCard, ReformatReview } from './ReformatPanel'
import { RevisionPanel } from './RevisionPanel'

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'

interface Props {
  /** A Gemini key is saved: the reformatter may use it, and Request changes is offered. */
  hasGemini: boolean
  site: string | null
  onSiteChange(site: string): void
  onTokenResult(result: { ok: true } | { ok: false; message: string }): void
}

type Loaded = Extract<ReadDocResult, { ok: true }> & { fileId: string; name: string }

/** A tab or Doc the reformatter wrote: its questions need a person's check before Canvas. */
const isReformatted = (doc: Loaded) => {
  const tab = doc.tabs.find((t) => t.id === doc.tabId)
  return /^Reformatted questions/i.test(tab?.title ?? '') || /Reformatted questions$/i.test(doc.name)
}

/** Enough of the questions to tell whether a re-read changed them. */
const fingerprint = (qs: Question[]) => JSON.stringify(qs.map(({ line: _l, ...q }) => q))

function stampOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/**
 * The create-a-quiz workflow, as numbered cards:
 *   1. the Google Doc (and which tab of it),
 *   2. the quiz: title and Classic or New Quizzes,
 *   3. the preview, every question as the app understood it,
 *   4. the Canvas courses,
 * then Create, which turns the screen into the per-course progress list from the mockup.
 */
export function QuizBuilder({ hasGemini, site, onSiteChange, onTokenResult }: Props) {
  const picker = useDrivePicker()
  const id = useId()

  const [doc, setDoc] = useState<Loaded | null>(null)
  const [docBusy, setDocBusy] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [link, setLink] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [engine, setEngine] = useState<QuizEngine | null>(null)
  const [courses, setCourses] = useState<CourseChoice[]>([])

  const [run, setRun] = useState<{ jobId: string; statuses: Record<string, CourseRunStatus>; done: boolean; stopping: boolean } | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Reformatting, and the person's sign-off on the result.
  const [reformatBusy, setReformatBusy] = useState(false)
  const [reformatError, setReformatError] = useState<string | null>(null)
  const [reformat, setReformat] = useState<Extract<ReformatResult, { ok: true }> | null>(null)
  /** "A person has checked these reformatted questions": required before a reformatted tab goes to Canvas. */
  const [checked, setChecked] = useState(false)
  const resultsRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    window.api.app.getLastEngine().then((e) => setEngine((cur) => cur ?? e ?? 'new')).catch(() => setEngine('new'))
  }, [])

  // ── Reading the document ──────────────────────────────────────────────────────

  const read = async (fileId: string, name: string, tabId?: string, refresh = false): Promise<Loaded | null> => {
    setDocBusy(true)
    setDocError(null)
    setBlocked(false)
    try {
      const res = await window.api.quiz.readDoc({ fileId, tabId, refresh })
      if (!res.ok) {
        setDocError(res.message)
        return null
      }
      const loaded = { ...res, fileId, name }
      // A different Doc or tab is a different set of questions: any earlier sign-off was for those.
      if (!doc || doc.fileId !== fileId || doc.tabId !== res.tabId) setChecked(false)
      // A hand edit keeps the sign-off, as in Canvas Rubric Creator, but is always announced.
      setNotice(res.manualEditAt ? `Manual edit detected at ${stampOf(res.manualEditAt)}. The preview below shows the Doc as it is now. Time stamp at the top of the tab may have changed.` : null)
      setDoc(loaded)
      setTitle((t) => (t && doc?.fileId === fileId ? t : res.title || name))
      return loaded
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Could not read that document.')
      return null
    } finally {
      setDocBusy(false)
    }
  }

  const runReformat = async () => {
    if (!doc) return
    setReformatBusy(true)
    setReformatError(null)
    setBlocked(false)
    try {
      const res = await window.api.quiz.reformat({ fileId: doc.fileId, tabId: doc.tabId ?? undefined })
      if (!res.ok) {
        setReformatError(res.message)
        return
      }
      setReformat(res)
      if (!res.nothingChanged) {
        // The app has written new questions: whatever was signed off before is not these.
        setChecked(false)
        await read(res.target.fileId, res.target.name, res.target.tabId ?? undefined, true)
        setNotice(null)
      }
      setTimeout(() => document.getElementById('reformat-review')?.focus(), 0)
    } catch (err) {
      setReformatError(err instanceof Error ? err.message : 'The reformat did not work.')
    } finally {
      setReformatBusy(false)
    }
  }

  const chooseFromDrive = async () => {
    const picked = await picker.pickFile({ mimeTypes: [GOOGLE_DOC_MIME], title: 'Choose the Google Doc with the quiz questions' })
    if (picked) await read(picked.fileId, picked.name)
  }

  const openLink = async () => {
    if (!link.trim()) return
    setDocBusy(true)
    setDocError(null)
    const res = await window.api.drive.resolveUrl(link.trim()).catch((e: unknown) => ({ ok: false as const, message: String(e) }))
    if (!res.ok) {
      setDocBusy(false)
      setDocError(res.message)
      return
    }
    if (res.mimeType !== GOOGLE_DOC_MIME) {
      setDocBusy(false)
      setDocError('That link is not a Google Doc. The questions need to be in a Google Doc.')
      return
    }
    setLink('')
    await read(res.fileId, res.name)
  }

  // ── What can be created ───────────────────────────────────────────────────────

  const questions: Question[] = doc?.result.questions ?? []
  const allIssues: Issue[] = useMemo(
    () => (doc ? [...doc.result.issues, ...(engine ? engineIssues(questions, engine) : [])] : []),
    [doc, engine, questions],
  )
  const general = allIssues.filter((i) => i.question === null)
  const byQuestion = (i: number) => allIssues.filter((x) => x.question === i)
  const errorCount = allIssues.filter((i) => i.severity === 'error').length
  const warningCount = allIssues.filter((i) => i.severity === 'warning').length
  const badQuestions = new Set(allIssues.filter((i) => i.severity === 'error' && i.question !== null).map((i) => i.question)).size
  const buildable = engine ? questions.filter((q) => canBuild(q, engine)) : []
  const totalPoints = buildable.reduce((n, q) => n + (q.type === 'text_only' ? 0 : (q.points ?? 1)), 0)

  const needsSignOff = !!doc && isReformatted(doc)
  const missing: string[] = []
  if (!doc) missing.push('choose the Google Doc')
  if (needsSignOff && !checked) missing.push('confirm a person has checked the reformatted questions')
  if (doc && buildable.length === 0) missing.push('have at least one question the app can build')
  if (!title.trim()) missing.push('give the quiz a title')
  if (courses.length === 0) missing.push('tick at least one course')

  // ── Creating ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    return window.api.canvas.onProgress((p: ProgressEvent) => {
      setRun((r) => (r ? { ...r, statuses: { ...r.statuses, [p.courseId]: p.status } } : r))
    })
  }, [])

  const create = async () => {
    if (!engine || missing.length > 0 || !doc) return
    if (errorCount > 0) {
      setBlocked(true)
      return
    }
    // Read the Doc once more, so Canvas gets exactly what it says now, not what it said earlier.
    const fresh = await read(doc.fileId, doc.name, doc.tabId ?? undefined, true)
    if (!fresh) return
    if (fingerprint(fresh.result.questions) !== fingerprint(questions)) {
      setNotice('The Google Doc changed since the preview was made. The preview now shows the questions as they are. Check them, then choose Create again.')
      return
    }
    const jobId = crypto.randomUUID()
    setRunError(null)
    setRun({ jobId, statuses: Object.fromEntries(courses.map((c) => [c.id, { state: 'waiting' } as CourseRunStatus])), done: false, stopping: false })
    setTimeout(() => resultsRef.current?.focus(), 0)
    try {
      const res = await window.api.canvas.createQuiz({
        courseIds: courses.map((c) => c.id),
        engine,
        settings: { title: title.trim(), description },
        questions,
        jobId,
      })
      if (!res.ok) setRunError(res.message)
      else setRun((r) => (r ? { ...r, statuses: Object.fromEntries(res.results.map((x) => [x.courseId, x.status])) } : r))
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Something went wrong while creating the quiz.')
    } finally {
      setRun((r) => (r ? { ...r, done: true } : r))
    }
  }

  if (run) {
    return (
      <RunView
        run={run}
        courses={courses}
        title={title}
        engine={engine ?? 'new'}
        count={buildable.length}
        error={runError}
        headingRef={resultsRef}
        onStop={() => {
          setRun((r) => (r ? { ...r, stopping: true } : r))
          void window.api.canvas.stopAfterCourse(run.jobId)
        }}
        onBack={() => setRun(null)}
      />
    )
  }

  // ── The form ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3.5">
      {/* 1. The document */}
      <section aria-labelledby={`${id}-doc`} className={`rounded-2xl border-2 bg-white p-4 ${doc ? 'border-green-200 shadow-[0_0_0_3px_rgba(240,253,244,1)]' : 'border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-4 h-4 text-brand flex-shrink-0" aria-hidden="true" />
          <h2 id={`${id}-doc`} className="font-black text-[15px] m-0">
            1. Quiz questions
          </h2>
        </div>
        <p className="text-[13px] text-gray-600 mb-2.5">
          The Google Doc with the questions, written in the eCampus quiz template format.
        </p>

        {doc ? (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-gray-200 p-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm truncate m-0">{doc.name}</p>
              <p className="text-xs text-gray-600 m-0">
                {questions.length} question{questions.length === 1 ? '' : 's'} found
              </p>
            </div>
            <button
              onClick={() => void read(doc.fileId, doc.name, doc.tabId ?? undefined, true)}
              disabled={docBusy}
              className="text-xs font-bold text-gray-700 border border-gray-400 rounded-lg px-2.5 py-1.5 hover:bg-white flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${docBusy ? 'animate-spin' : ''}`} aria-hidden="true" /> Read again
            </button>
            <button
              onClick={() => void chooseFromDrive()}
              className="text-xs font-bold text-gray-700 border border-gray-400 rounded-lg px-2.5 py-1.5 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Choose another
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => void chooseFromDrive()}
              disabled={docBusy}
              className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-brand text-brand hover:bg-blue-50 font-black text-sm py-2.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {docBusy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Choose from Google Drive
            </button>
            <div className="flex items-center gap-3 my-3 text-xs text-gray-600" aria-hidden="true">
              <span className="flex-1 border-t border-gray-200" /> or <span className="flex-1 border-t border-gray-200" />
            </div>
            <div className="flex gap-2">
              <label htmlFor={`${id}-link`} className="sr-only">
                Google Doc link
              </label>
              <input
                id={`${id}-link`}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void openLink()}
                placeholder="Paste a Google Doc link"
                spellCheck={false}
                className="flex-1 min-w-0 border-2 border-gray-500 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-blue-200 transition"
              />
              <button
                onClick={() => void openLink()}
                disabled={!link.trim() || docBusy}
                className="flex-shrink-0 px-4 rounded-xl border-2 border-brand text-brand font-black text-sm disabled:border-gray-300 disabled:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Open
              </button>
            </div>
          </>
        )}

        {doc && doc.tabs.length > 1 && (
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor={`${id}-tab`} className="text-[13px] font-bold text-gray-800">
              Tab with the questions
            </label>
            <select
              id={`${id}-tab`}
              value={doc.tabId ?? ''}
              onChange={(e) => void read(doc.fileId, doc.name, e.target.value)}
              className="flex-1 min-w-0 border-2 border-gray-500 rounded-lg px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand"
            >
              {doc.tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {'  '.repeat(t.depth)}
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {notice && (
          <p role="status" className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-300 p-2.5 text-[12.5px] text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
            <span>{notice}</span>
          </p>
        )}
        {docError && (
          <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12.5px] text-red-800">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span role="alert">
              <ErrorText message={docError} />
            </span>
          </p>
        )}
      </section>

      {/* Fixing the formatting: a tool card, and what it did */}
      <ReformatCard
        docName={doc ? (doc.tabs.find((t) => t.id === doc.tabId)?.title ?? doc.name) : null}
        hasGemini={hasGemini}
        busy={reformatBusy}
        error={reformatError}
        onRun={() => void runReformat()}
      />
      {reformat && <ReformatReview result={reformat} onDismiss={() => setReformat(null)} />}

      {/* 2. The quiz */}
      <section aria-labelledby={`${id}-quiz`} className="rounded-2xl border-2 border-gray-200 bg-white p-4">
        <h2 id={`${id}-quiz`} className="font-black text-[15px] m-0 mb-2.5">
          2. The quiz
        </h2>
        <label htmlFor={`${id}-title`} className="block text-[13px] font-bold text-gray-800 mb-1">
          Title
        </label>
        <input
          id={`${id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Module 3 Quiz"
          className="w-full border-2 border-gray-500 rounded-xl px-3.5 py-2.5 text-sm mb-3 focus:outline-none focus:border-brand focus:ring-2 focus:ring-blue-200 transition"
        />
        <label htmlFor={`${id}-desc`} className="block text-[13px] font-bold text-gray-800 mb-1">
          Instructions for students <span className="font-normal text-gray-600">(optional)</span>
        </label>
        <textarea
          id={`${id}-desc`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full border-2 border-gray-500 rounded-xl px-3.5 py-2.5 text-sm mb-3 focus:outline-none focus:border-brand focus:ring-2 focus:ring-blue-200 transition"
        />
        <fieldset>
          <legend className="text-[13px] font-bold text-gray-800 mb-1.5">Quiz type</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['classic', 'new'] as const).map((e) => (
              <label
                key={e}
                className={`flex items-start gap-2.5 rounded-xl border-2 p-3 cursor-pointer ${engine === e ? 'border-brand bg-[#eef3fc]' : 'border-gray-300 hover:border-gray-400'}`}
              >
                <input type="radio" name={`${id}-engine`} checked={engine === e} onChange={() => setEngine(e)} className="mt-0.5 accent-brand" />
                <span>
                  <b className="block text-[13.5px]">{e === 'classic' ? 'Classic Quizzes' : 'New Quizzes'}</b>
                  <small className="text-xs text-gray-600">
                    {e === 'classic' ? 'Includes multiple dropdowns and fill in the blank.' : 'Includes categorization, ordering and file limits.'}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {/* 3. Preview */}
      {doc && (
        <section aria-labelledby={`${id}-preview`} className="rounded-2xl border-2 border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <h2 id={`${id}-preview`} className="font-black text-[15px] m-0">
              3. Check the questions
            </h2>
            <span className="ml-auto text-[12px] text-gray-700" role="status">
              {buildable.length} question{buildable.length === 1 ? '' : 's'} · {totalPoints} point{totalPoints === 1 ? '' : 's'}
              {errorCount > 0 && <b className="text-red-800"> · {errorCount} to fix</b>}
              {warningCount > 0 && <b className="text-amber-900"> · {warningCount} to check</b>}
            </span>
          </div>
          {general.length > 0 && (
            <ul className="mb-2.5 space-y-1.5 p-0">
              {general.map((issue, i) => (
                <li key={i} className={`list-none flex items-start gap-2 rounded-lg p-2 text-[12.5px] ${issue.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
                  <AlertTriangle className="w-4 h-4 mt-px flex-shrink-0" aria-hidden="true" />
                  <span>
                    {issue.message}
                    {doc.lines[issue.line]?.text ? <span className="block text-gray-700 font-mono text-[11.5px] mt-0.5">“{doc.lines[issue.line].text.trim()}”</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ol className="space-y-2 p-0 m-0 max-h-[520px] overflow-y-auto pr-1" tabIndex={0} aria-label="Questions">
            {questions.map((q, i) => (
              <QuestionPreview key={i} q={q} index={i} issues={byQuestion(i)} />
            ))}
          </ol>
          {needsSignOff && (
            <label className={`mt-3 flex items-start gap-2.5 rounded-xl border-2 p-3 cursor-pointer ${checked ? 'border-green-300 bg-green-50' : 'border-purple-300 bg-white'}`}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 w-4 h-4 accent-brand flex-shrink-0" />
              <span className="text-[13px] text-gray-800">
                <b className="text-gray-900">Ready for Canvas.</b> A person has compared these reformatted questions with the originals,
                including every answer and point value the app changed.
              </span>
            </label>
          )}
        </section>
      )}

      {needsSignOff && doc?.tabId && (
        <RevisionPanel
          fileId={doc.fileId}
          tabId={doc.tabId}
          hasGemini={hasGemini}
          onApplied={async (stamp) => {
            setReformat(null)
            await read(doc.fileId, doc.name, doc.tabId ?? undefined, true)
            setChecked(false)
            setNotice(`Gemini’s change was written to the tab at ${stamp}. Check the questions again, then tick Ready for Canvas.`)
          }}
        />
      )}

      {/* 4. Courses */}
      <MultiCoursePicker selected={courses} onChange={setCourses} site={site} onSiteChange={onSiteChange} onTokenResult={onTokenResult} />

      {blocked && errorCount > 0 && (
        <div role="alert" className="p-3.5 bg-amber-50 border-2 border-amber-300 rounded-xl">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <p className="font-black text-[13px] text-gray-900 m-0">
                {badQuestions > 0 ? `${badQuestions} question${badQuestions === 1 ? ' has' : 's have'} formatting problems.` : 'The document has formatting problems.'}
              </p>
              <p className="text-[12.5px] text-gray-700 mt-1 mb-0">
                Nothing was sent to Canvas. The app can try to fix the formatting in a new tab of the Doc, leaving the original questions
                as they are, or you can fix the items marked in red in the Doc and choose <b>Read again</b>.
              </p>
              <div className="flex flex-wrap gap-2 mt-2.5">
                <button
                  onClick={() => void runReformat()}
                  disabled={reformatBusy}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-xs font-black focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                >
                  {reformatBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
                  {reformatBusy ? 'Reformatting…' : 'Try to fix the formatting'}
                </button>
                <button
                  onClick={() => setBlocked(false)}
                  className="px-3.5 py-2 rounded-lg border border-gray-400 bg-white text-gray-800 text-xs font-bold hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  I will fix it myself
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => void create()}
        disabled={missing.length > 0}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-black text-sm transition bg-brand hover:bg-brand-dark text-white disabled:bg-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        <Send className="w-4 h-4" aria-hidden="true" />
        {courses.length > 1 ? `Create quiz in ${courses.length} courses` : 'Create quiz'}
      </button>
      <p className="text-xs text-gray-600 text-center m-0">
        {missing.length > 0
          ? `To create the quiz, ${missing.join(', ')}.`
          : 'The quiz is created unpublished. Courses are done one at a time, and a failure in one does not stop the others.'}
      </p>
    </div>
  )
}

// ─── Progress and results ──────────────────────────────────────────────────────

function RunView(props: {
  run: { statuses: Record<string, CourseRunStatus>; done: boolean; stopping: boolean }
  courses: CourseChoice[]
  title: string
  engine: QuizEngine
  count: number
  error: string | null
  headingRef: React.RefObject<HTMLHeadingElement | null>
  onStop(): void
  onBack(): void
}) {
  const { run, courses } = props
  const list = courses.map((c) => ({ course: c, status: run.statuses[c.id] ?? ({ state: 'waiting' } as CourseRunStatus) }))
  const done = list.filter((x) => x.status.state === 'done').length
  const failed = list.filter((x) => x.status.state === 'failed').length
  const waiting = list.filter((x) => x.status.state === 'waiting').length
  const skipped = list.filter((x) => x.status.state === 'skipped').length
  const active = list.find((x) => x.status.state === 'working')
  const workingIndex = active ? list.indexOf(active) + 1 : 0
  const progress = list.reduce((n, x) => {
    const s = x.status
    if (s.state === 'done' || s.state === 'failed' || s.state === 'skipped') return n + 1
    if (s.state === 'working') return n + (s.total ? s.added / s.total : 0)
    return n
  }, 0)
  const pct = Math.round((progress / Math.max(1, list.length)) * 100)

  return (
    <div className="space-y-3.5">
      <section className="bg-white border border-gray-200 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-[42px] h-[42px] rounded-xl bg-brand text-white flex items-center justify-center flex-shrink-0">
            <Send className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 ref={props.headingRef} tabIndex={-1} className="font-black text-[14.5px] m-0 focus:outline-none">
              {run.done ? 'Finished' : 'Creating'} “{props.title}” in {courses.length} course{courses.length === 1 ? '' : 's'}
            </h2>
            <p className="text-xs text-gray-600 m-0">
              {props.engine === 'classic' ? 'Classic Quizzes' : 'New Quizzes'} · {props.count} questions each · created unpublished
            </p>
          </div>
        </div>

        {!run.done && (
          <div className="flex gap-2 mt-3.5">
            <div role="status" className="flex-1 rounded-xl bg-[#4f68a4] text-white font-black text-[13px] py-2.5 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              {active && active.status.state === 'working'
                ? `Course ${workingIndex} of ${list.length} · adding question ${Math.min(active.status.added + 1, active.status.total)} of ${active.status.total}`
                : 'Starting…'}
            </div>
            <button
              onClick={props.onStop}
              disabled={run.stopping}
              className="flex-shrink-0 px-4 rounded-xl border-2 border-red-700 text-red-700 bg-white font-black text-[13px] flex items-center gap-1.5 disabled:border-gray-300 disabled:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              {run.stopping ? 'Stopping after this course' : 'Stop after this course'}
            </button>
          </div>
        )}
        <div role="progressbar" aria-label="Overall progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-gray-600 tabular-nums m-0">
          {done} done · {failed} failed · {waiting} waiting{skipped ? ` · ${skipped} skipped` : ''}
        </p>
        {props.error && (
          <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12.5px] text-red-800">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span role="alert">
              <ErrorText message={props.error} />
            </span>
          </p>
        )}
      </section>

      <section aria-label="Each course" className="bg-white border-2 border-gray-200 rounded-2xl p-4 space-y-2">
        <h2 className="font-black text-[15px] m-0 mb-1">Each course</h2>
        {list.map(({ course, status }) => (
          <CourseRow key={course.id} course={course} status={status} />
        ))}
      </section>

      {run.done && (
        <>
          {failed > 0 && (
            <div className="flex items-start gap-2.5 p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
              <p className="text-[12.5px] text-amber-900 m-0">
                <b className="text-gray-900">Before trying a failed course again,</b> open it in Canvas. If the quiz was created there with
                some of its questions, delete it first, or the course will end up with two copies.
              </p>
            </div>
          )}
          <button
            onClick={props.onBack}
            className="w-full rounded-xl py-3 font-black text-sm border-2 border-brand text-brand hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Back to the quiz
          </button>
        </>
      )}
    </div>
  )
}

function CourseRow({ course, status }: { course: CourseChoice; status: CourseRunStatus }) {
  const name = <p className="m-0 text-[13.5px] font-black">{course.name}</p>
  switch (status.state) {
    case 'done':
      return (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-green-50 border border-green-200">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0 text-green-900">
            {name}
            <p className="m-0 text-xs text-green-800">Created with {status.added} questions.</p>
          </div>
          <a href={status.quizUrl} target="_blank" rel="noreferrer" className="flex-shrink-0 text-[12.5px] font-black text-brand inline-flex items-center gap-1">
            Open in Canvas <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      )
    case 'failed':
      return (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-700 flex-shrink-0 mt-px" aria-hidden="true" />
          <div className="flex-1 min-w-0 text-red-900">
            {name}
            <p className="m-0 text-xs text-red-800">
              <ErrorText message={status.message} />
              {status.quizUrl ? ` The quiz was created with ${status.added} question${status.added === 1 ? '' : 's'} before this happened.` : ' Nothing was created here.'}
            </p>
          </div>
          {status.quizUrl && (
            <a href={status.quizUrl} target="_blank" rel="noreferrer" className="flex-shrink-0 text-[12.5px] font-black text-brand inline-flex items-center gap-1">
              Open in Canvas <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      )
    case 'working':
      return (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[#eef3fc] shadow-[inset_0_0_0_2px_#0033a0]">
          <Loader2 className="w-5 h-5 text-brand animate-spin flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            {name}
            <p className="m-0 text-xs text-gray-700">
              {status.added === 0 ? 'Creating the quiz…' : `Added ${status.added} of ${status.total} questions…`}
            </p>
            <div className="mt-1.5 h-1 bg-[#dbe7fb] rounded-full overflow-hidden">
              <div className="h-full bg-brand" style={{ width: `${Math.round((status.added / Math.max(1, status.total)) * 100)}%` }} />
            </div>
          </div>
        </div>
      )
    case 'skipped':
      return (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-200">
          <Square className="w-5 h-5 text-gray-600 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            {name}
            <p className="m-0 text-xs text-gray-600">Skipped: stopped before this course. Nothing was created here.</p>
          </div>
        </div>
      )
    default:
      return (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-200">
          <Clock className="w-5 h-5 text-gray-600 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            {name}
            <p className="m-0 text-xs text-gray-600">
              Waiting.{course.blueprint ? ' Blueprint course: associated courses get the quiz at the next sync.' : ''}
            </p>
          </div>
        </div>
      )
  }
}
