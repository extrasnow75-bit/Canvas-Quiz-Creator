import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Wand2, Sparkles, ChevronDown } from 'lucide-react'
import type { CourseChoice, CourseRunStatus, DocQuiz, ProgressEvent, Question, QuizEngine, ReadDocResult, ReformatResult } from '../types'
import type { Issue } from '../../electron/ipc/quizModel'
import { engineIssues } from '../../electron/ipc/quizFormat'
import { canBuild } from '../../electron/ipc/quizPayloads'
import { MultiCoursePicker } from './MultiCoursePicker'
import { QuestionPreview } from './QuestionPreview'
import { ErrorText } from './ErrorText'
import { ReformatReview } from './ReformatPanel'
import { RevisionPanel } from './RevisionPanel'
import { InlineDrivePicker } from './InlineDrivePicker'
import { RunView, runKey, type RunQuiz } from './RunView'
import { CheckFixIcon, DocIcon, ENGINE_TILE, IconTile, Rocket, STEP_TILE } from './Icons'

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const ENGINE_NAME: Record<QuizEngine, string> = { classic: 'Classic Quizzes', new: 'New Quizzes' }

interface Props {
  /** A Gemini key is saved: offered as the last resort in step 3, and for Request changes. */
  hasGemini: boolean
  site: string | null
  onSiteChange(site: string): void
  onTokenResult(result: { ok: true } | { ok: false; message: string }): void
}

type Loaded = Extract<ReadDocResult, { ok: true }> & { fileId: string; name: string }

/** What the developer has decided for one quiz in the Doc. */
interface Plan {
  include: boolean
  engine: QuizEngine
  title: string
  /** "Ready for Canvas": a person has checked this quiz's reformatted questions. */
  checked: boolean
}

const isReformatted = (doc: Loaded) => {
  const tab = doc.tabs.find((t) => t.id === doc.tabId)
  return /^Reformatted questions/i.test(tab?.title ?? '') || /Reformatted questions$/i.test(doc.name)
}

const errorsIn = (issues: Issue[]) => issues.filter((i) => i.severity === 'error').length
const engineErrors = (q: DocQuiz, e: QuizEngine) => errorsIn(engineIssues(q.result.questions, e))
const fits = (q: DocQuiz, e: QuizEngine) => q.result.questions.length > 0 && engineErrors(q, e) === 0
const buildable = (q: DocQuiz, e: QuizEngine) => q.result.questions.filter((x) => canBuild(x, e))
const pointsOf = (qs: Question[]) => qs.reduce((n, q) => n + (q.type === 'text_only' ? 0 : (q.points ?? 1)), 0)
const fingerprint = (qs: DocQuiz[]) => JSON.stringify(qs.map((q) => [q.title, q.result.questions.map(({ line: _l, ...x }) => x)]))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function stampOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/** A numbered step, with its coloured icon tile as on the extractor's cards. */
function Step(props: { n: number; title: string; icon: React.ReactNode; color: string; tone?: 'done' | 'warn' | 'active'; right?: React.ReactNode; children?: React.ReactNode; id: string }) {
  const border =
    props.tone === 'done'
      ? 'border-green-200 shadow-[0_0_0_3px_rgba(240,253,244,1)]'
      : props.tone === 'warn'
        ? 'border-amber-300'
        : props.tone === 'active'
          ? 'border-brand'
          : 'border-gray-200'
  return (
    <section aria-labelledby={props.id} className={`rounded-2xl border-2 bg-white p-4 ${border}`}>
      <div className="flex items-center gap-3">
        <IconTile color={props.color}>{props.icon}</IconTile>
        <div className="flex-1 min-w-0">
          <p className="m-0 text-[11px] font-black tracking-wider text-gray-700">STEP {props.n}</p>
          <h2 id={props.id} className="font-black text-[15px] m-0">
            {props.title}
          </h2>
        </div>
        {props.right}
      </div>
      {props.children && <div className="mt-3">{props.children}</div>}
    </section>
  )
}

/**
 * The main screen, layout B from the design mockups:
 *   1. the Google Doc, chosen in a Drive picker built into the card;
 *   2. which kind of quiz: the two rocket cards count how many of the Doc's quizzes and questions
 *      fit each, and the table below sets Classic or New for each quiz (a Doc may hold several,
 *      one per heading);
 *   3. check and fix: how many problems there are, how many the automatic fixes can clear, and
 *      Gemini only as the last resort;
 *   4. the Canvas courses — the same courses for every quiz in the Doc;
 * then Launch, which turns into the per-course results.
 */
export function QuizBuilder({ hasGemini, site, onSiteChange, onTokenResult }: Props) {
  const id = useId()
  const [doc, setDoc] = useState<Loaded | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [docBusy, setDocBusy] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [lastEngine, setLastEngine] = useState<QuizEngine>('new')

  const [reformatBusy, setReformatBusy] = useState<'rules' | 'gemini' | null>(null)
  const [reformatError, setReformatError] = useState<string | null>(null)
  const [reformat, setReformat] = useState<Extract<ReformatResult, { ok: true }> | null>(null)
  /** The tab the reformatted questions came from, for Gemini's pass over the same original. */
  const [sourceTabId, setSourceTabId] = useState<string | null>(null)
  const [showQuiz, setShowQuiz] = useState<number | null>(null)

  const [courses, setCourses] = useState<CourseChoice[]>([])
  const [blocked, setBlocked] = useState(false)
  const [run, setRun] = useState<{ jobId: string; quizzes: RunQuiz[]; courses: CourseChoice[]; statuses: Record<string, CourseRunStatus>; done: boolean; stopping: boolean } | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    window.api.app.getLastEngine().then((e) => e && setLastEngine(e)).catch(() => undefined)
    return window.api.canvas.onProgress((p: ProgressEvent) => {
      setRun((r) => (r ? { ...r, statuses: { ...r.statuses, [runKey(p.quizKey ?? '0', p.courseId)]: p.status } } : r))
    })
  }, [])

  // ── Reading the Doc ──────────────────────────────────────────────────────────

  const read = async (fileId: string, name: string, opts: { tabId?: string; refresh?: boolean; level?: number | null } = {}): Promise<Loaded | null> => {
    setDocBusy(true)
    setDocError(null)
    setBlocked(false)
    try {
      const res = await window.api.quiz.readDoc({ fileId, tabId: opts.tabId, refresh: opts.refresh, level: opts.level })
      if (!res.ok) {
        setDocError(res.message)
        return null
      }
      const loaded: Loaded = { ...res, fileId, name }
      const sameSource = !!doc && doc.fileId === fileId && doc.tabId === res.tabId
      setPlans((old) =>
        res.quizzes.map((q, i) => {
          const before = sameSource ? old[i] : undefined
          // Keep what the developer chose for a quiz still in the same place; otherwise start fresh.
          if (before && sameSource) return { ...before, engine: fits(q, before.engine) || !fits(q, other(before.engine)) ? before.engine : other(before.engine) }
          const engine = fits(q, lastEngine) || !fits(q, other(lastEngine)) ? lastEngine : other(lastEngine)
          return { include: q.result.questions.length > 0, engine, title: q.title ?? res.title ?? name, checked: false }
        }),
      )
      setNotice(res.manualEditAt ? `Manual edit detected at ${stampOf(res.manualEditAt)}. The questions below are the Doc as it is now. The time stamp at the top of the tab may have changed.` : null)
      setDoc(loaded)
      return loaded
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Could not read that document.')
      return null
    } finally {
      setDocBusy(false)
    }
  }

  const openLink = async () => {
    if (!link.trim()) return
    setDocBusy(true)
    setDocError(null)
    const res = await window.api.drive.resolveUrl(link.trim()).catch((e: unknown) => ({ ok: false as const, message: String(e) }))
    setDocBusy(false)
    if (!res.ok) return setDocError(res.message)
    if (res.mimeType !== GOOGLE_DOC_MIME) return setDocError('That link is not a Google Doc. The questions need to be in a Google Doc.')
    setLink('')
    await read(res.fileId, res.name)
  }

  const chooseAnother = () => {
    setDoc(null)
    setPlans([])
    setReformat(null)
    setSourceTabId(null)
    setNotice(null)
    setShowQuiz(null)
  }

  // ── Fixing ───────────────────────────────────────────────────────────────────

  const runReformat = async (useAi: boolean) => {
    if (!doc) return
    setReformatBusy(useAi ? 'gemini' : 'rules')
    setReformatError(null)
    setBlocked(false)
    try {
      const signedOffTab = isReformatted(doc)
      const res = await window.api.quiz.reformat(
        useAi && signedOffTab
          ? { fileId: doc.fileId, tabId: sourceTabId ?? doc.tabId ?? undefined, useAi: true, replaceTabId: doc.tabId ?? undefined, level: doc.level }
          : { fileId: doc.fileId, tabId: doc.tabId ?? undefined, useAi, level: doc.level },
      )
      if (!res.ok) return setReformatError(res.message)
      setReformat(res)
      if (!res.nothingChanged) {
        setSourceTabId(res.target.sourceTabId)
        await read(res.target.fileId, res.target.name, { tabId: res.target.tabId ?? undefined, refresh: true, level: doc.level })
        // New questions from the app: every quiz needs a person's check again.
        setPlans((ps) => ps.map((p) => ({ ...p, checked: false })))
        setNotice(null)
      }
      setTimeout(() => document.getElementById('reformat-review')?.focus(), 0)
    } catch (err) {
      setReformatError(err instanceof Error ? err.message : 'The reformat did not work.')
    } finally {
      setReformatBusy(null)
    }
  }

  // ── What is ready ────────────────────────────────────────────────────────────

  const quizzes = doc?.quizzes ?? []
  const signOff = !!doc && isReformatted(doc)
  const chosen = quizzes.filter((_, i) => plans[i]?.include)

  const engineSummary = (e: QuizEngine) => {
    const quizFit = quizzes.filter((q) => fits(q, e)).length
    const total = quizzes.reduce((n, q) => n + q.result.questions.length, 0)
    const qFit = quizzes.reduce((n, q) => n + q.result.questions.length - engineIssues(q.result.questions, e).filter((x) => x.severity === 'error').length, 0)
    const misfit = quizzes.find((q) => !fits(q, e) && q.result.questions.length > 0)
    const reason = misfit ? engineIssues(misfit.result.questions, e).find((x) => x.severity === 'error')?.message : null
    return { quizFit, qFit, total, misfit, reason }
  }

  const totals = useMemo(() => {
    const included = quizzes.filter((_, i) => plans[i]?.include)
    return {
      problems: included.reduce((n, q) => n + q.fixPreview.problems, 0),
      auto: included.reduce((n, q) => n + q.fixPreview.autoFixable, 0),
      person: included.reduce((n, q) => n + q.fixPreview.needsPerson, 0),
      anyChange: included.some((q) => q.fixPreview.anyChange),
      ready: included.reduce(
        (n, q) => n + q.result.questions.filter((_, qi) => !q.result.issues.some((x) => x.severity === 'error' && x.question === qi)).length,
        0,
      ),
    }
  }, [quizzes, plans])

  const missing: string[] = []
  if (!doc) missing.push('choose the Google Doc')
  else if (chosen.length === 0) missing.push('include at least one quiz')
  if (doc && totals.problems > 0) missing.push(`fix ${plural(totals.problems, 'problem')} in step 3`)
  quizzes.forEach((q, i) => {
    const p = plans[i]
    if (!p?.include) return
    if (!fits(q, p.engine)) missing.push(`choose the other quiz type for “${p.title}”`)
    if (!p.title.trim()) missing.push('give every quiz a title')
    if (signOff && !p.checked) missing.push(`tick Checked for “${p.title}”`)
  })
  if (courses.length === 0) missing.push('tick at least one course')
  const unique = [...new Set(missing)]

  // ── Launching ────────────────────────────────────────────────────────────────

  const launch = async () => {
    if (!doc || unique.length > 0) {
      if (totals.problems > 0) setBlocked(true)
      return
    }
    const fresh = await read(doc.fileId, doc.name, { tabId: doc.tabId ?? undefined, refresh: true, level: doc.level })
    if (!fresh) return
    if (fingerprint(fresh.quizzes) !== fingerprint(doc.quizzes)) {
      setNotice('The Google Doc changed since you last read it. The quizzes below are the Doc as it is now. Check them, then launch again.')
      return
    }
    const list = fresh.quizzes.flatMap((q, i) => {
      const p = plans[i]
      return p?.include ? [{ key: String(i), title: p.title.trim(), engine: p.engine, questions: buildable(q, p.engine) }] : []
    })
    const jobId = crypto.randomUUID()
    setRunError(null)
    setRun({
      jobId,
      quizzes: list.map((q) => ({ key: q.key, title: q.title, engine: q.engine, count: q.questions.length })),
      courses,
      statuses: Object.fromEntries(courses.flatMap((c) => list.map((q) => [runKey(q.key, c.id), { state: 'waiting' } as CourseRunStatus]))),
      done: false,
      stopping: false,
    })
    setTimeout(() => resultsRef.current?.focus(), 0)
    try {
      const res = await window.api.canvas.createQuizzes({ courseIds: courses.map((c) => c.id), quizzes: list, jobId })
      if (!res.ok) setRunError(res.message)
      else setRun((r) => (r ? { ...r, statuses: { ...r.statuses, ...Object.fromEntries(res.results.map((x) => [runKey(x.quizKey ?? '0', x.courseId), x.status])) } } : r))
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Something went wrong while creating the quizzes.')
    } finally {
      setRun((r) => (r ? { ...r, done: true } : r))
    }
  }

  if (run) {
    return (
      <RunView
        quizzes={run.quizzes}
        courses={run.courses}
        statuses={run.statuses}
        done={run.done}
        stopping={run.stopping}
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

  const setPlan = (i: number, patch: Partial<Plan>) => setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const launchEngines = [...new Set(chosen.map((q) => plans[quizzes.indexOf(q)]?.engine))]
  const launchLabel = `Launch ${chosen.length > 1 ? plural(chosen.length, 'quiz', 'quizzes') : launchEngines[0] === 'classic' ? 'Classic Quiz' : 'New Quiz'}${courses.length ? ` in ${plural(courses.length, 'course')}` : ''}`

  return (
    <div className="space-y-3.5">
      {/* 1 · The Doc */}
      <Step n={1} id={`${id}-s1`} title="Quiz questions" color={STEP_TILE.doc} icon={<DocIcon />} tone={doc ? 'done' : 'active'}
        right={doc && (
          <span className="flex gap-2">
            <button onClick={() => void read(doc.fileId, doc.name, { tabId: doc.tabId ?? undefined, refresh: true, level: doc.level })} disabled={docBusy}
              className="text-xs font-bold text-gray-700 border border-gray-400 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <RefreshCw className={`w-3.5 h-3.5 ${docBusy ? 'animate-spin' : ''}`} aria-hidden="true" /> Read again
            </button>
            <button onClick={chooseAnother} className="text-xs font-bold text-gray-700 border border-gray-400 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              Choose another
            </button>
          </span>
        )}
      >
        {doc ? (
          <div className="space-y-2.5">
            <p className="m-0 text-[13.5px]">
              <b>{doc.name}</b>
              <span className="text-gray-600"> · {plural(quizzes.length, 'quiz', 'quizzes')} · {plural(quizzes.reduce((n, q) => n + Math.max(q.result.questions.length, q.fixPreview.questionsAfterFix), 0), 'question')}</span>
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {doc.tabs.length > 1 && (
                <label className="flex items-center gap-2 text-[13px] font-bold text-gray-800">
                  Tab
                  <select value={doc.tabId ?? ''} onChange={(e) => void read(doc.fileId, doc.name, { tabId: e.target.value })}
                    className="border-2 border-gray-500 rounded-lg px-2 py-1 text-[13px] bg-white font-normal focus:outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand">
                    {doc.tabs.map((t) => <option key={t.id} value={t.id}>{'  '.repeat(t.depth)}{t.title}</option>)}
                  </select>
                </label>
              )}
              {doc.levels.length > 1 && (
                <label className="flex items-center gap-2 text-[13px] font-bold text-gray-800">
                  Each quiz starts at
                  <select value={doc.level ?? ''} onChange={(e) => void read(doc.fileId, doc.name, { tabId: doc.tabId ?? undefined, level: Number(e.target.value) })}
                    className="border-2 border-gray-500 rounded-lg px-2 py-1 text-[13px] bg-white font-normal focus:outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand">
                    {doc.levels.map((l) => <option key={l} value={l}>Heading {l}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-gray-600 mt-0 mb-2.5">Choose the Google Doc with the faculty member’s questions. A Doc can hold several quizzes, one under each heading.</p>
            <InlineDrivePicker busy={docBusy} onPick={(f) => void read(f.fileId, f.name)} />
            <div className="flex items-center gap-3 my-3 text-xs text-gray-600" aria-hidden="true">
              <span className="flex-1 border-t border-gray-200" /> or <span className="flex-1 border-t border-gray-200" />
            </div>
            <div className="flex gap-2">
              <label htmlFor={`${id}-link`} className="sr-only">Google Doc link</label>
              <input id={`${id}-link`} value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void openLink()} placeholder="Paste a Google Doc link" spellCheck={false}
                className="flex-1 min-w-0 border-2 border-gray-500 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-blue-200 transition" />
              <button onClick={() => void openLink()} disabled={!link.trim() || docBusy}
                className="flex-shrink-0 px-4 rounded-xl border-2 border-brand text-brand font-black text-sm disabled:border-gray-300 disabled:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                {docBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Opening" /> : 'Open'}
              </button>
            </div>
          </>
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
            <span role="alert"><ErrorText message={docError} /></span>
          </p>
        )}
      </Step>

      {doc && (
        <>
          {/* 2 · Which kind of quiz */}
          <Step n={2} id={`${id}-s2`} title="Which kind of quiz?" color={STEP_TILE.engine} icon={<Rocket engine="classic" size={20} />}>
            <div className="grid grid-cols-2 gap-3">
              {(['classic', 'new'] as const).map((e) => {
                const s = engineSummary(e)
                const every = quizzes.length > 0 && chosen.every((q) => plans[quizzes.indexOf(q)]?.engine === e)
                return (
                  <button key={e} onClick={() => setPlans((ps) => ps.map((p, i) => (fits(quizzes[i], e) ? { ...p, engine: e } : p)))}
                    aria-pressed={every}
                    className={`text-left rounded-2xl border-2 p-3.5 flex flex-col gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${every ? 'border-brand bg-[#eef3fc]' : 'border-gray-300 hover:border-gray-400 bg-white'}`}>
                    <span className="flex items-center gap-3">
                      <IconTile color={ENGINE_TILE[e]} size={46}><Rocket engine={e} size={25} /></IconTile>
                      <span className="flex-1">
                        <b className="block text-[14.5px]">{ENGINE_NAME[e]}</b>
                        <small className="text-xs text-gray-600">{quizzes.length > 1 ? 'Build every quiz that fits as this' : 'Build the quiz as this'}</small>
                      </span>
                    </span>
                    <span className={`rounded-lg px-2.5 py-2 text-[12.5px] ${s.quizFit === quizzes.length ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>
                      <b className="text-gray-900">{s.quizFit} of {plural(quizzes.length, 'quiz', 'quizzes')}</b> fit · {s.qFit} of {plural(s.total, 'question')}
                      {s.misfit && s.reason && <span className="block mt-0.5">{s.misfit.title ?? 'The quiz'}: {s.reason}</span>}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* One row per quiz */}
            <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-[13px] border-collapse">
                <caption className="sr-only">Quizzes in the Doc</caption>
                <thead className="bg-slate-50 text-left text-[11.5px] uppercase tracking-wide text-gray-700">
                  <tr>
                    <th scope="col" className="px-2.5 py-2 w-8"><span className="sr-only">Include</span></th>
                    <th scope="col" className="px-2 py-2">Quiz</th>
                    <th scope="col" className="px-2 py-2">Formatting</th>
                    <th scope="col" className="px-2 py-2">Build as</th>
                    {signOff && <th scope="col" className="px-2 py-2">Checked</th>}
                  </tr>
                </thead>
                <tbody>
                  {quizzes.map((q, i) => {
                    const p = plans[i]
                    if (!p) return null
                    const n = q.result.questions.length
                    const toFix = q.fixPreview.problems
                    return (
                      <tr key={i} className={`border-t border-gray-200 align-top ${p.include ? '' : 'opacity-60'}`}>
                        <td className="px-2.5 py-2.5">
                          <input type="checkbox" checked={p.include} disabled={n === 0} onChange={(e) => setPlan(i, { include: e.target.checked })} aria-label={`Include ${p.title}`} className="w-4 h-4 accent-brand" />
                        </td>
                        <td className="px-2 py-2">
                          <label className="sr-only" htmlFor={`${id}-t${i}`}>Title of quiz {i + 1}</label>
                          <input id={`${id}-t${i}`} value={p.title} onChange={(e) => setPlan(i, { title: e.target.value })}
                            className="w-full font-bold border border-transparent hover:border-gray-300 focus:border-brand rounded-md px-1.5 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
                          <span className="block px-1.5 text-xs text-gray-600">
                            {q.fixPreview.questionsAfterFix > n
                              ? `${plural(q.fixPreview.questionsAfterFix, 'question')} (${q.fixPreview.questionsAfterFix - n} not readable until fixed)`
                              : plural(n, 'question')}{' '}
                            · {plural(pointsOf(q.result.questions), 'point')} ·{' '}
                            <button onClick={() => setShowQuiz(showQuiz === i ? null : i)} className="font-bold text-brand underline underline-offset-2">
                              {showQuiz === i ? 'Hide questions' : 'Show questions'}
                            </button>
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          {toFix === 0 ? (
                            <span className="inline-flex items-center gap-1 text-[12px] font-black text-green-800"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-hidden="true" /> Ready</span>
                          ) : (
                            <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">{toFix} TO FIX</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden" role="radiogroup" aria-label={`Quiz type for ${p.title}`}>
                            {(['classic', 'new'] as const).map((e) => {
                              const ok = fits(q, e)
                              const on = p.engine === e
                              return (
                                <button key={e} role="radio" aria-checked={on} disabled={!ok} onClick={() => setPlan(i, { engine: e })}
                                  title={ok ? ENGINE_NAME[e] : engineIssues(q.result.questions, e).find((x) => x.severity === 'error')?.message}
                                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${on ? 'bg-[#eef3fc] text-gray-900' : 'bg-white text-gray-700'} ${ok ? '' : 'line-through text-gray-500 cursor-not-allowed'}`}>
                                  <IconTile color={ENGINE_TILE[e]} size={18}><Rocket engine={e} size={11} /></IconTile>
                                  {e === 'classic' ? 'Classic' : 'New'}
                                </button>
                              )
                            })}
                          </div>
                        </td>
                        {signOff && (
                          <td className="px-2 py-2.5">
                            <input type="checkbox" checked={p.checked} onChange={(e) => setPlan(i, { checked: e.target.checked })} disabled={!p.include}
                              aria-label={`A person has checked the reformatted questions in ${p.title}`} className="w-4 h-4 accent-brand" />
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {signOff && (
              <p className="mt-2 mb-0 text-xs text-gray-700">
                <b className="text-gray-900">Checked</b> means a person has compared that quiz’s reformatted questions with the originals, including every answer and point value the app changed.
              </p>
            )}
            {showQuiz !== null && quizzes[showQuiz] && (
              <ol className="mt-3 space-y-2 p-0 m-0 max-h-[480px] overflow-y-auto pr-1" tabIndex={0} aria-label={`Questions in ${plans[showQuiz]?.title}`}>
                {quizzes[showQuiz].result.questions.map((qq, qi) => (
                  <QuestionPreview key={qi} q={qq} index={qi}
                    issues={[...quizzes[showQuiz].result.issues, ...engineIssues(quizzes[showQuiz].result.questions, plans[showQuiz]?.engine ?? 'new')].filter((x) => x.question === qi)} />
                ))}
              </ol>
            )}
          </Step>

          {/* 3 · Check and fix */}
          <Step n={3} id={`${id}-s3`} title="Check and fix the questions" color={STEP_TILE.check} icon={<CheckFixIcon />} tone={totals.problems > 0 ? 'warn' : 'done'}
            right={totals.problems > 0
              ? <span className="text-[11px] font-black tracking-wide px-3 py-1 rounded-full bg-amber-100 text-amber-900">{totals.problems} TO FIX</span>
              : <span className="text-[11px] font-black tracking-wide px-3 py-1 rounded-full bg-green-100 text-green-900">READY</span>}
          >
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 border border-gray-200 px-3 py-2.5"><b className="block text-[22px] leading-tight">{totals.ready}</b><small className="text-xs text-gray-700">{totals.ready === 1 ? 'question' : 'questions'} ready</small></div>
              <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2.5"><b className="block text-[22px] leading-tight text-green-900">{totals.auto}</b><small className="text-xs text-green-800">the app can fix automatically</small></div>
              <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5"><b className="block text-[22px] leading-tight text-red-900">{totals.person}</b><small className="text-xs text-red-800">{totals.person === 1 ? 'needs' : 'need'} a person</small></div>
            </div>

            {chosen.some((q) => q.fixPreview.problems > 0 || q.fixPreview.wouldChange.length > 0) && (
              <div className="mt-3 space-y-2">
                {chosen.filter((q) => q.fixPreview.problems > 0 || q.fixPreview.wouldChange.length > 0).map((q) => (
                  <details key={q.index} className="rounded-xl border border-gray-200 px-3 py-2" open={chosen.length === 1}>
                    <summary className="cursor-pointer text-[13px] font-bold text-gray-900 flex items-center gap-2">
                      <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                      {plans[q.index]?.title}
                      <span className="font-normal text-gray-600">· {q.fixPreview.autoFixable} automatic · {q.fixPreview.needsPerson} for a person</span>
                    </summary>
                    <ul className="mt-1.5 mb-1 pl-5 text-[12.5px] text-gray-800 space-y-0.5">
                      {q.fixPreview.wouldChange.slice(0, 8).map((m, k) => <li key={`c${k}`}>{m.replace(/^[^·]+ · /, '')}</li>)}
                      {q.fixPreview.needsPersonMessages.map((m, k) => <li key={`p${k}`} className="text-red-900 font-bold">{m.replace(/^[^·]+ · /, '')}</li>)}
                    </ul>
                  </details>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <button onClick={() => void runReformat(false)} disabled={reformatBusy !== null || (!totals.anyChange && totals.problems === 0)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white text-[13px] font-black disabled:bg-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
                {reformatBusy === 'rules' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Wand2 className="w-4 h-4" aria-hidden="true" />}
                {reformatBusy === 'rules' ? 'Fixing…' : totals.auto > 0 ? `Fix ${totals.auto} automatically` : 'Tidy the formatting automatically'}
              </button>
              <span className="text-xs text-gray-600">No AI. Writes a new “Reformatted questions” tab in the Doc, with changes highlighted; the original is not changed.</span>
            </div>

            <div className="mt-3 pt-2.5 border-t border-dashed border-gray-300 text-xs text-gray-700">
              <span className="font-bold text-gray-800">Last resort:</span>{' '}
              {signOff && totals.problems > 0 && hasGemini ? (
                <button onClick={() => void runReformat(true)} disabled={reformatBusy !== null}
                  className="inline-flex items-center gap-1.5 font-black text-[#5b3f93] underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  {reformatBusy === 'gemini' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
                  {reformatBusy === 'gemini' ? 'Asking Gemini…' : `Ask Gemini to lay out what is left (${totals.problems})`}
                </button>
              ) : (
                <span>
                  {!hasGemini ? 'with a Gemini key in Initial setup, ' : !signOff ? 'after the automatic fixes, ' : ''}Gemini can lay out what the app’s rules could not. It never decides which answer is correct.
                </span>
              )}
            </div>

            {reformatError && (
              <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12.5px] text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span role="alert"><ErrorText message={reformatError} /></span>
              </p>
            )}
          </Step>

          {reformat && <ReformatReview result={reformat} onDismiss={() => setReformat(null)} />}
          {signOff && doc.tabId && (
            <RevisionPanel fileId={doc.fileId} tabId={doc.tabId} hasGemini={hasGemini}
              onApplied={async (stamp) => {
                setReformat(null)
                await read(doc.fileId, doc.name, { tabId: doc.tabId ?? undefined, refresh: true, level: doc.level })
                setPlans((ps) => ps.map((p) => ({ ...p, checked: false })))
                setNotice(`Gemini’s change was written to the tab at ${stamp}. Check the quizzes again, then tick Checked for each.`)
              }} />
          )}
        </>
      )}

      {/* 4 · Courses */}
      <MultiCoursePicker selected={courses} onChange={setCourses} site={site} onSiteChange={onSiteChange} onTokenResult={onTokenResult} />

      {blocked && totals.problems > 0 && (
        <div role="alert" className="p-3.5 bg-amber-50 border-2 border-amber-300 rounded-xl flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
          <p className="text-[12.5px] text-gray-800 m-0">
            <b className="text-gray-900">{plural(totals.problems, 'formatting problem')} still to fix.</b> Nothing was sent to Canvas. Use step 3, or fix them in the Doc and choose Read again.
          </p>
        </div>
      )}

      <button onClick={() => void launch()} disabled={unique.length > 0}
        className="w-full flex items-center justify-center gap-2.5 rounded-xl py-3 font-black text-sm transition bg-brand hover:bg-brand-dark text-white disabled:bg-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
        <Rocket engine={launchEngines.length === 1 ? (launchEngines[0] ?? 'new') : 'new'} size={18} color="currentColor" />
        {launchLabel}
      </button>
      <p className="text-xs text-gray-600 text-center m-0">
        {unique.length > 0 ? `To launch: ${unique.slice(0, 4).join('; ')}${unique.length > 4 ? '; …' : ''}.` : 'Every quiz is created unpublished, one course at a time. A failure in one does not stop the others.'}
      </p>
    </div>
  )
}

function other(e: QuizEngine): QuizEngine {
  return e === 'classic' ? 'new' : 'classic'
}
