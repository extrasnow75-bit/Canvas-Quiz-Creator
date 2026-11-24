import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Check, CheckCircle2, Loader2, RefreshCw, Wand2, Sparkles, ChevronDown } from 'lucide-react'
import type { CourseChoice, CourseRunStatus, DocQuiz, Question, QuizEngine, ReadDocResult, ReformatResult } from '../types'
import type { Issue } from '../../electron/ipc/quizModel'
import { engineIssues } from '../../electron/ipc/quizFormat'
import { canBuild } from '../../electron/ipc/quizPayloads'
import { MultiCoursePicker } from './MultiCoursePicker'
import { QuestionPreview } from './QuestionPreview'
import { ErrorText, cleanErrorMessage } from './ErrorText'
import { ReformatReview } from './ReformatPanel'
import { RevisionPanel } from './RevisionPanel'
import { InlineDrivePicker } from './InlineDrivePicker'
import { RunView, runKey, type RunQuiz } from './RunView'
import { CheckFixIcon, DocIcon, ENGINE_TILE, IconTile, Rocket, STEP_TILE } from './Icons'

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const ENGINE_NAME: Record<QuizEngine, string> = { classic: 'Classic Quizzes', new: 'New Quizzes' }

interface Props {
  /** Google and the Canvas token are set up. While not, the choices stay but nothing can run. */
  ready: boolean
  /** Told when a run starts and ends, so Initial setup can hold back Sign out and Remove token. */
  onRunBusy(busy: boolean): void
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

/** Which of the app's tabs this is: its own fixes, Gemini's, or neither (the faculty member's). */
function tabKind(doc: Loaded): 'rules' | 'gemini' | 'original' {
  const title = doc.tabs.find((t) => t.id === doc.tabId)?.title ?? ''
  if (/^Revised by Gemini/i.test(title) || /Revised by Gemini$/i.test(doc.name)) return 'gemini'
  if (/^Reformatted questions/i.test(title) || /Reformatted questions$/i.test(doc.name)) return 'rules'
  return 'original'
}

/** Questions the app or Gemini wrote: each quiz needs a person's check before Canvas. */
const isReformatted = (doc: Loaded) => tabKind(doc) !== 'original'

const TAB_BADGE = {
  original: { label: 'Original questions', style: 'bg-gray-100 text-gray-800' },
  rules: { label: 'Reformatted, no AI', style: 'bg-amber-100 text-amber-900' },
  gemini: { label: 'Revised by Gemini', style: 'bg-purple-100 text-purple-900' },
} as const

const errorsIn = (issues: Issue[]) => issues.filter((i) => i.severity === 'error').length
const engineErrors = (q: DocQuiz, e: QuizEngine) => errorsIn(engineIssues(q.result.questions, e))
const fits = (q: DocQuiz, e: QuizEngine) => q.result.questions.length > 0 && engineErrors(q, e) === 0
const buildable = (q: DocQuiz, e: QuizEngine) => q.result.questions.filter((x) => canBuild(x, e))
const pointsOf = (qs: Question[]) => qs.reduce((n, q) => n + (q.type === 'text_only' ? 0 : (q.points ?? 1)), 0)
/**
 * Each quiz's identity across reads: its title in the Doc and which of that title it is. A plan
 * (included, quiz type, Checked) follows the quiz by this, not by its position, so a quiz added
 * above another does not take over its settings.
 */
function quizKeys(qs: Array<{ title: string | null }>): string[] {
  const seen = new Map<string, number>()
  return qs.map((q) => {
    const t = (q.title ?? '').trim().toLowerCase()
    const n = (seen.get(t) ?? 0) + 1
    seen.set(t, n)
    return `${t}#${n}`
  })
}
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
          <h2 id={props.id} tabIndex={-1} className="font-black text-[15px] m-0 focus:outline-none">
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
export function QuizBuilder({ ready, onRunBusy, hasGemini, site, onSiteChange, onTokenResult }: Props) {
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
  /**
   * For each Reformatted questions tab this session made, the tab it was made from, so Gemini's
   * pass works from the faculty member's original rather than from the app's or its own output.
   */
  const [sources, setSources] = useState<Record<string, string>>({})
  const [showQuiz, setShowQuiz] = useState<number | null>(null)
  /** "Points for questions with none", as typed. Applied when the automatic fixes run. */
  const [defaultPoints, setDefaultPoints] = useState('1')

  const [courses, setCourses] = useState<CourseChoice[]>([])
  const [run, setRun] = useState<{ jobId: string; quizzes: RunQuiz[]; courses: CourseChoice[]; statuses: Record<string, CourseRunStatus>; done: boolean; stopping: boolean } | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  /** "title|engine|courseId" for every quiz created (even partly) this session: Launch warns before making it twice. */
  const [created, setCreated] = useState<string[]>([])
  const [dupConfirm, setDupConfirm] = useState<string | null>(null)
  const resultsRef = useRef<HTMLHeadingElement>(null)
  const runIdRef = useRef<string | null>(null)
  /** Only the newest read may change the screen: an older one that answers late is ignored. */
  const readSeq = useRef(0)
  /** Counts reads, so a Gemini proposal made from an earlier read of the tab is thrown away. */
  const [readCount, setReadCount] = useState(0)
  const docRef = useRef<Loaded | null>(null)
  docRef.current = doc
  const plansRef = useRef<Plan[]>([])
  plansRef.current = plans

  const running = !!run && !run.done
  useEffect(() => onRunBusy(running || launching), [running, launching, onRunBusy])

  useEffect(() => {
    window.api.app.getLastEngine().then((e) => e && setLastEngine(e)).catch(() => undefined)
    // A window reloaded during a run picks the run up again rather than offering a second Launch.
    window.api.canvas
      .currentRun()
      .then((r) => {
        if (!r || r.done) return
        runIdRef.current = r.jobId
        setRun((cur) => cur ?? { jobId: r.jobId, quizzes: r.quizzes, courses: r.courses, statuses: r.statuses, done: false, stopping: false })
      })
      .catch(() => undefined)
    return window.api.canvas.onProgress((p) => {
      if (p.jobId && p.jobId !== runIdRef.current) return
      setRun((r) => (r ? { ...r, statuses: { ...r.statuses, [runKey(p.quizKey ?? '0', p.courseId)]: p.status } } : r))
    })
  }, [])

  // A reloaded run has no promise to wait on: check now and then until main says it is over.
  useEffect(() => {
    if (!run || run.done || launching) return
    const t = setInterval(() => {
      window.api.canvas
        .currentRun()
        .then((r) => {
          if (r && r.jobId === run.jobId && r.done) {
            setRun((cur) => (cur && cur.jobId === r.jobId ? { ...cur, statuses: r.statuses, done: true } : cur))
            if (r.error) setRunError(r.error)
          }
        })
        .catch(() => undefined)
    }, 3000)
    return () => clearInterval(t)
  }, [run?.jobId, run?.done, launching])

  // ── Reading the Doc ──────────────────────────────────────────────────────────

  const read = async (fileId: string, name: string, opts: { tabId?: string; refresh?: boolean; level?: number | null } = {}): Promise<Loaded | null> => {
    const seq = ++readSeq.current
    setDocBusy(true)
    setDocError(null)
    try {
      const res = await window.api.quiz.readDoc({ fileId, tabId: opts.tabId, refresh: opts.refresh, level: opts.level })
      if (seq !== readSeq.current) return null
      if (!res.ok) {
        setDocError(res.message)
        return null
      }
      const loaded: Loaded = { ...res, fileId, name }
      const before = docRef.current
      // Plans follow each quiz by its title, across tabs of the same Doc (the original and its
      // Reformatted questions tab hold the same quizzes). A different Doc starts fresh.
      const old = new Map<string, Plan>()
      /** Quizzes that could not be ticked before because none of their questions could be read. */
      const wasUnreadable = new Set<string>()
      if (before && before.fileId === fileId) {
        const keys = quizKeys(before.quizzes)
        plansRef.current.forEach((p, i) => p && old.set(keys[i], p))
        before.quizzes.forEach((q, i) => q.result.questions.length === 0 && wasUnreadable.add(keys[i]))
      }
      const sameTab = !!before && before.fileId === fileId && before.tabId === res.tabId
      const keys = quizKeys(res.quizzes)
      setPlans(
        res.quizzes.map((q, i) => {
          const prev = old.get(keys[i])
          if (prev) {
            const engine = fits(q, prev.engine) || !fits(q, other(prev.engine)) ? prev.engine : other(prev.engine)
            // Checked belongs to the questions a person looked at: only kept on the same tab.
            // A quiz that was greyed out only because it could not be read is ticked once it can be.
            const include = (prev.include || wasUnreadable.has(keys[i])) && q.result.questions.length > 0
            return { ...prev, engine, include, checked: sameTab && prev.checked }
          }
          const engine = fits(q, lastEngine) || !fits(q, other(lastEngine)) ? lastEngine : other(lastEngine)
          return { include: q.result.questions.length > 0, engine, title: q.title ?? res.title ?? name, checked: false }
        }),
      )
      if (!before || before.fileId !== fileId) {
        setReformat(null)
        setSources({})
      }
      if (!sameTab) {
        setGeminiConfirm(null)
        setReformatError(null)
        setShowQuiz(null)
      }
      const notes = [
        res.openedNewest ? `Opened the ${res.openedNewest} tab, the newest version the app fixed. The original questions are in the Tab menu.` : null,
        res.manualEditAt ? `Manual edit detected at ${stampOf(res.manualEditAt)}. The questions below are the Doc as it is now. The time stamp at the top of the tab may have changed.` : null,
      ].filter(Boolean)
      setNotice(notes.length ? notes.join(' ') : null)
      setDoc(loaded)
      setReadCount((n) => n + 1)
      return loaded
    } catch (err) {
      if (seq === readSeq.current) setDocError(err instanceof Error ? cleanErrorMessage(err.message) : 'The Google Doc could not be read. Please try again.')
      return null
    } finally {
      if (seq === readSeq.current) setDocBusy(false)
    }
  }

  const openLink = async () => {
    if (!link.trim()) return
    setDocBusy(true)
    setDocError(null)
    const res = await window.api.drive
      .resolveUrl(link.trim())
      .catch((e: unknown) => ({ ok: false as const, message: cleanErrorMessage(e instanceof Error ? e.message : String(e)) }))
    setDocBusy(false)
    if (!res.ok) return setDocError(res.message)
    if (res.mimeType !== GOOGLE_DOC_MIME)
      return setDocError('That link is not to a Google Doc. The questions need to be in a Google Doc: open the file in Google Drive, choose File → Save as Google Docs, then paste the new link.')
    setLink('')
    await read(res.fileId, res.name)
  }

  const chooseAnother = () => {
    readSeq.current++ // a read still on its way no longer counts
    setDocBusy(false)
    setDoc(null)
    setPlans([])
    setReformat(null)
    setSources({})
    setNotice(null)
    setShowQuiz(null)
    setDocError(null)
    setReformatError(null)
    setGeminiConfirm(null)
    setDupConfirm(null)
    setTimeout(() => document.getElementById(`${id}-s1`)?.focus(), 0)
  }

  // ── Fixing ───────────────────────────────────────────────────────────────────

  const [geminiConfirm, setGeminiConfirm] = useState<string | null>(null)

  const runReformat = async (useAi: boolean, replaceGemini = false) => {
    if (!doc) return
    setGeminiConfirm(null)
    setReformatBusy(useAi ? 'gemini' : 'rules')
    setReformatError(null)
    try {
      const points = totals.missingPoints > 0 && pointsValue !== null ? pointsValue : null
      // Gemini works from the faculty member's original where the app knows it, else from the
      // newest no-AI tab: never from its own earlier output.
      const rulesTabs = doc.tabs.filter((t) => /^Reformatted questions/i.test(t.title))
      const newestRules = rulesTabs[rulesTabs.length - 1]?.id
      const kind = tabKind(doc)
      const fromRules = (tab: string | null | undefined) => (tab ? (sources[tab] ?? tab) : null)
      const geminiSource = kind === 'original' ? doc.tabId : kind === 'rules' ? fromRules(doc.tabId) : (fromRules(newestRules) ?? doc.tabId)
      const res = await window.api.quiz.reformat({
        fileId: doc.fileId,
        tabId: (useAi ? geminiSource : doc.tabId) ?? undefined,
        useAi,
        replaceGemini,
        level: doc.level,
        defaultPoints: points,
      })
      if (!res.ok) {
        if (res.needsConfirm) return setGeminiConfirm(res.message)
        return setReformatError(res.message)
      }
      setReformat(res)
      if (!res.nothingChanged) {
        const made = res.target.tabId
        const from = res.target.sourceTabId
        if (!useAi && made && from) setSources((m) => ({ ...m, [made]: m[from] ?? from }))
        await read(res.target.fileId, res.target.name, { tabId: res.target.tabId ?? undefined, refresh: true, level: doc.level })
        // New questions from the app: every quiz needs a person's check again.
        setPlans((ps) => ps.map((p) => ({ ...p, checked: false })))
        setNotice(null)
      }
      setTimeout(() => document.getElementById('reformat-review')?.focus(), 0)
    } catch (err) {
      setReformatError(err instanceof Error ? cleanErrorMessage(err.message) : 'The questions could not be reformatted. Please try again.')
    } finally {
      setReformatBusy(null)
    }
  }

  // ── What is ready ────────────────────────────────────────────────────────────

  const quizzes = doc?.quizzes ?? []
  const signOff = !!doc && isReformatted(doc)
  const chosen = quizzes.filter((_, i) => plans[i]?.include)
  /** Quizzes with no question the app can read now, but some once the automatic fixes run. */
  const unreadable = quizzes.filter((q) => q.result.questions.length === 0 && q.fixPreview.questionsAfterFix > 0)
  /** Quizzes with no question the app can find at all, even after the automatic fixes. */
  const empty = quizzes.filter((q) => q.result.questions.length === 0 && q.fixPreview.questionsAfterFix === 0)

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
      // A quiz that cannot be ticked until it is tidied still counts: tidying is how it becomes tickable.
      anyChange: included.some((q) => q.fixPreview.anyChange) || quizzes.some((q) => q.result.questions.length === 0 && q.fixPreview.questionsAfterFix > 0),
      missingPoints: included.reduce((n, q) => n + q.fixPreview.missingPoints, 0),
      ready: included.reduce(
        (n, q) => n + q.result.questions.filter((_, qi) => !q.result.issues.some((x) => x.severity === 'error' && x.question === qi)).length,
        0,
      ),
    }
  }, [quizzes, plans])
  const tidyLabel = totals.auto > 0 ? `Fix ${totals.auto} automatically` : 'Tidy the formatting automatically'

  const dp = Number(defaultPoints)
  const pointsInvalid = defaultPoints.trim() !== '' && !(Number.isFinite(dp) && dp >= 0 && dp <= 1000)
  const pointsValue = defaultPoints.trim() !== '' && !pointsInvalid ? dp : null

  const missing: string[] = []
  if (!ready) missing.push('finish Initial setup')
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

  const launch = async (confirmedDuplicate = false) => {
    if (!doc || unique.length > 0 || launching || running) return
    const picks = quizzes.flatMap((q, i) => (plans[i]?.include ? [{ index: q.index, title: plans[i].title.trim(), engine: plans[i].engine }] : []))
    const repeats = picks.filter((p) => courses.some((c) => created.includes(`${p.title}|${p.engine}|${c.id}`)))
    if (repeats.length > 0 && !confirmedDuplicate) {
      setDupConfirm(
        `${repeats.length === 1 ? `“${repeats[0].title}” was` : `${plural(repeats.length, 'quiz', 'quizzes')} were`} already created in ${repeats.length === 1 ? 'some of these courses' : 'some of these courses'} this session. Launching again makes a second copy in each. To add to the courses you have not done yet, untick the others in step 4 first.`,
      )
      setTimeout(() => document.getElementById(`${id}-dup`)?.focus(), 0)
      return
    }
    setDupConfirm(null)
    setLaunching(true)
    const jobId = crypto.randomUUID()
    runIdRef.current = jobId
    const runQuizzes = picks.map((p) => ({ key: String(p.index), title: p.title, engine: p.engine, count: buildable(quizzes[p.index], p.engine).length }))
    setRunError(null)
    setRun({
      jobId,
      quizzes: runQuizzes,
      courses,
      statuses: Object.fromEntries(courses.flatMap((c) => runQuizzes.map((q) => [runKey(q.key, c.id), { state: 'waiting' } as CourseRunStatus]))),
      done: false,
      stopping: false,
    })
    setTimeout(() => resultsRef.current?.focus(), 0)
    let finished: Record<string, CourseRunStatus> | null = null
    try {
      const res = await window.api.canvas.createQuizzes({ fileId: doc.fileId, tabId: doc.tabId, level: doc.level, picks, courses, jobId })
      if (!res.ok && res.changed) {
        // Nothing was created: back to the main screen, with the Doc as it is now.
        setRun(null)
        runIdRef.current = null
        await read(doc.fileId, doc.name, { tabId: doc.tabId ?? undefined, refresh: true, level: doc.level })
        setNotice(res.message)
        return
      }
      if (!res.ok) setRunError(res.message)
      else {
        finished = Object.fromEntries(res.results.map((x) => [runKey(x.quizKey ?? '0', x.courseId), x.status]))
        setRun((r) => (r ? { ...r, statuses: { ...r.statuses, ...finished } } : r))
      }
    } catch (err) {
      setRunError(err instanceof Error ? cleanErrorMessage(err.message) : 'Something went wrong while creating the quizzes. Check each course in Canvas before launching again.')
    } finally {
      setLaunching(false)
      setRun((r) => (r && r.jobId === jobId ? { ...r, done: true } : r))
      if (finished) {
        const made = Object.entries(finished)
          .filter(([, st]) => st.state === 'done' || ('quizUrl' in st && !!st.quizUrl))
          .flatMap(([k]) => {
            const [qk, courseId] = k.split('|')
            const q = runQuizzes.find((x) => x.key === qk)
            return q ? [`${q.title}|${q.engine}|${courseId}`] : []
          })
        setCreated((c) => [...new Set([...c, ...made])])
      }
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
        onBack={() => {
          setRun(null)
          setTimeout(() => document.getElementById(`${id}-launch`)?.focus(), 0)
        }}
      />
    )
  }

  /** Something is already happening: the controls that would start something else wait. */
  const busy = docBusy || reformatBusy !== null || launching
  const setPlan = (i: number, patch: Partial<Plan>) => setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const launchEngines = [...new Set(chosen.map((q) => plans[quizzes.indexOf(q)]?.engine))]
  const launchLabel = `Launch ${chosen.length > 1 ? plural(chosen.length, 'quiz', 'quizzes') : launchEngines[0] === 'classic' ? 'Classic Quiz' : 'New Quiz'}${courses.length ? ` in ${plural(courses.length, 'course')}` : ''}`

  return (
    <div className="space-y-3.5">
      {/* 1 · The Doc */}
      <Step n={1} id={`${id}-s1`} title="Quiz questions" color={STEP_TILE.doc} icon={<DocIcon />} tone={doc ? 'done' : 'active'}
        right={doc && (
          <span className="flex gap-2">
            <button onClick={() => void read(doc.fileId, doc.name, { tabId: doc.tabId ?? undefined, refresh: true, level: doc.level })} disabled={busy}
              className="disabled:opacity-60 disabled:cursor-not-allowed text-xs font-bold text-gray-700 border border-gray-500 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <RefreshCw className={`w-3.5 h-3.5 ${docBusy ? 'animate-spin' : ''}`} aria-hidden="true" /> Read again
            </button>
            <button onClick={chooseAnother} disabled={reformatBusy !== null || launching} className="disabled:opacity-60 disabled:cursor-not-allowed text-xs font-bold text-gray-700 border border-gray-500 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              Choose another doc
            </button>
          </span>
        )}
      >
        {doc ? (
          <div className="space-y-2.5">
            {docBusy && <p role="status" className="m-0 flex items-center gap-2 text-[12.5px] text-gray-700"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Reading the Doc…</p>}
            <p className="m-0 text-[13.5px] flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`text-[10.5px] font-black tracking-wide px-2 py-0.5 rounded-full ${TAB_BADGE[tabKind(doc)].style}`}>
                {TAB_BADGE[tabKind(doc)].label.toUpperCase()}
              </span>
              <b>{doc.name}</b>
              <span className="text-gray-600"> · {plural(quizzes.length, 'quiz', 'quizzes')} · {plural(quizzes.reduce((n, q) => n + Math.max(q.result.questions.length, q.fixPreview.questionsAfterFix), 0), 'question')}</span>
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {doc.tabs.length > 1 && (
                <label className="flex items-center gap-2 text-[13px] font-bold text-gray-800">
                  Tab
                  <select value={doc.tabId ?? ''} disabled={busy} onChange={(e) => void read(doc.fileId, doc.name, { tabId: e.target.value })}
                    className="border-2 border-gray-500 rounded-lg px-2 py-1 text-[13px] bg-white font-normal focus:outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand">
                    {doc.tabs.map((t) => <option key={t.id} value={t.id}>{'  '.repeat(t.depth)}{t.title}</option>)}
                  </select>
                </label>
              )}
              {doc.levels.length > 1 && (
                <label className="flex items-center gap-2 text-[13px] font-bold text-gray-800">
                  Each quiz starts at
                  <select value={doc.level ?? ''} disabled={busy} onChange={(e) => void read(doc.fileId, doc.name, { tabId: doc.tabId ?? undefined, level: Number(e.target.value) })}
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
                    className={`text-left rounded-2xl border-2 p-3.5 flex flex-col gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${every ? 'border-brand bg-[#eef3fc]' : 'border-gray-300 hover:border-gray-500 bg-white'}`}>
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

            {/* Why some rows are greyed out, and what to do about it. */}
            {(unreadable.length > 0 || empty.length > 0) && (
              <div id={`${id}-greyed`} className="mt-3 p-3.5 bg-amber-50 border-2 border-amber-300 rounded-xl text-[12.5px] text-gray-900">
                <p className="m-0 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
                  <span>
                    <b>Why some quizzes are greyed out.</b>{' '}
                    {unreadable.length > 0 && (
                      <>
                        The app cannot read the questions in {unreadable.length === 1 ? '1 quiz' : `${unreadable.length} quizzes`} the way they are
                        written now (for example, questions copied from Canvas without numbers or answer letters), so{' '}
                        {unreadable.length === 1 ? 'it' : 'they'} cannot be ticked yet. Choose <b>{tidyLabel}</b> in step 3.
                        It writes a <b>Reformatted questions</b> tab that the app can read, and opens it, so these quizzes can be ticked.{' '}
                      </>
                    )}
                    {empty.length > 0 && (
                      <>
                        {empty.length === 1 ? 'One quiz has' : `${empty.length} quizzes have`} no questions the app can find, even after tidying:
                        put {empty.length === 1 ? 'its' : 'their'} questions in the template format in the Doc, then choose <b>Read again</b> in step 1.{' '}
                      </>
                    )}
                    Any quiz you untick is greyed out too, and is not created.
                  </span>
                </p>
              </div>
            )}

            {/* One row per quiz */}
            <div className="mt-3 border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px] border-collapse">
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
                      <tr key={quizKeys(quizzes)[i]} className={`border-t border-gray-200 align-top ${p.include ? '' : 'opacity-60'}`}>
                        <td className="px-2.5 py-2.5">
                          <input type="checkbox" checked={p.include} disabled={n === 0} onChange={(e) => setPlan(i, { include: e.target.checked })} aria-label={`Include ${p.title}`}
                            aria-describedby={n === 0 ? `${id}-greyed` : undefined} title={n === 0 ? 'The app cannot read this quiz’s questions yet. See the note above.' : undefined} className="w-4 h-4 accent-brand" />
                        </td>
                        <td className="px-2 py-2">
                          <label className="sr-only" htmlFor={`${id}-t${i}`}>Title of quiz {i + 1}</label>
                          <input id={`${id}-t${i}`} value={p.title} onChange={(e) => setPlan(i, { title: e.target.value })}
                            className="w-full font-bold border border-gray-500 hover:border-gray-600 focus:border-brand rounded-md px-1.5 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
                          <span className="block px-1.5 text-xs text-gray-600">
                            {q.fixPreview.questionsAfterFix > n
                              ? `${plural(q.fixPreview.questionsAfterFix, 'question')} (${q.fixPreview.questionsAfterFix - n} not readable until fixed)`
                              : plural(n, 'question')}{' '}
                            · {plural(pointsOf(q.result.questions), 'point')} ·{' '}
                            <button onClick={() => setShowQuiz(showQuiz === i ? null : i)} aria-expanded={showQuiz === i} aria-controls={`${id}-qs`}
                              className="font-bold text-brand underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                              {showQuiz === i ? 'Hide questions' : 'Show questions'}
                            </button>
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          {n === 0 && q.fixPreview.questionsAfterFix === 0 ? (
                            <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-gray-100 text-gray-800">NO QUESTIONS</span>
                          ) : n === 0 ? (
                            <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">NEEDS TIDYING</span>
                          ) : toFix === 0 ? (
                            <span className="inline-flex items-center gap-1 text-[12px] font-black text-green-800"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-hidden="true" /> Ready</span>
                          ) : (
                            <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">{toFix} TO FIX</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <fieldset className="inline-flex rounded-lg border-2 border-gray-600 overflow-hidden m-0 p-0 divide-x-2 divide-gray-600">
                            <legend className="sr-only">Quiz type for {p.title}</legend>
                            {(['classic', 'new'] as const).map((e) => {
                              const ok = fits(q, e)
                              const on = p.engine === e
                              const why = ok ? null : engineIssues(q.result.questions, e).find((x) => x.severity === 'error')?.message ?? 'No questions to build.'
                              return (
                                <label key={e} title={why ?? ENGINE_NAME[e]}
                                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-bold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-brand ${on ? 'bg-green-700 text-white' : ok ? 'bg-white text-gray-900 hover:bg-green-50' : 'bg-gray-100 text-gray-700'} ${ok ? 'cursor-pointer' : 'line-through cursor-not-allowed'}`}>
                                  <input type="radio" name={`${id}-engine-${i}`} className="sr-only" checked={on} disabled={!ok} onChange={() => setPlan(i, { engine: e })}
                                    aria-describedby={why ? `${id}-why-${i}-${e}` : undefined} />
                                  <IconTile color={ENGINE_TILE[e]} size={18}><Rocket engine={e} size={11} /></IconTile>
                                  {e === 'classic' ? 'Classic' : 'New'}
                                  {on && <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" />}
                                  {why && <span id={`${id}-why-${i}-${e}`} className="sr-only">Not available: {why}</span>}
                                </label>
                              )
                            })}
                          </fieldset>
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
              <ol id={`${id}-qs`} className="mt-3 space-y-2 p-0 m-0 max-h-[480px] overflow-y-auto pr-1" tabIndex={0} aria-label={`Questions in ${plans[showQuiz]?.title}`}>
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 border border-gray-200 px-3 py-2.5"><b className="block text-[22px] leading-tight">{totals.ready}</b><small className="text-xs text-gray-700">{totals.ready === 1 ? 'question' : 'questions'} ready</small></div>
              <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2.5"><b className="block text-[22px] leading-tight text-green-900">{totals.auto}</b><small className="text-xs text-green-800">the app can fix automatically</small></div>
              <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5"><b className="block text-[22px] leading-tight text-red-900">{totals.person}</b><small className="text-xs text-red-800">{totals.person === 1 ? 'needs' : 'need'} a person to fix in the Doc</small></div>
            </div>

            {chosen.some((q) => q.fixPreview.problems > 0 || q.fixPreview.wouldChange.length > 0) && (
              <div className="mt-3 space-y-2">
                {chosen.filter((q) => q.fixPreview.problems > 0 || q.fixPreview.wouldChange.length > 0).map((q) => (
                  <details key={q.index} className="group rounded-xl border border-gray-200 px-3 py-2" open={chosen.length === 1}>
                    <summary className="cursor-pointer text-[13px] font-bold text-gray-900 flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                      <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
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

            {totals.missingPoints > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-amber-50 border border-amber-300 px-3 py-2.5 text-[13px] text-amber-900">
                <span>
                  <b className="text-gray-900">{plural(totals.missingPoints, 'question')}</b> {totals.missingPoints === 1 ? 'has' : 'have'} no points.
                </span>
                <label htmlFor={`${id}-dp`} className="font-bold text-gray-900">Points for questions with none</label>
                <input id={`${id}-dp`} type="number" min={0} max={1000} step={0.5} value={defaultPoints} onChange={(e) => setDefaultPoints(e.target.value)}
                  aria-invalid={pointsInvalid || undefined} aria-describedby={`${id}-dp-hint`}
                  className="w-20 border-2 border-gray-500 aria-[invalid=true]:border-red-700 rounded-lg px-2 py-1 text-[13px] bg-white text-gray-900 focus:outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand" />
                <span id={`${id}-dp-hint`} className={`text-xs ${pointsInvalid ? 'font-bold text-red-800' : ''}`}>
                  {pointsInvalid
                    ? 'Type a number from 0 to 1000, such as 1 or 2.5, or leave it empty.'
                    : 'Added by Fix automatically, highlighted in the new tab. Leave it empty to add points yourself in the Doc; until then Canvas gives each 1 point.'}
                </span>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <button onClick={() => void runReformat(false)} disabled={busy || !ready || pointsInvalid || (!totals.anyChange && totals.problems === 0 && !(totals.missingPoints > 0 && pointsValue !== null))}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white text-[13px] font-black disabled:bg-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
                {reformatBusy === 'rules' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Wand2 className="w-4 h-4" aria-hidden="true" />}
                {reformatBusy === 'rules' ? 'Fixing…' : tidyLabel}
              </button>
              <span className="text-xs text-gray-600">No AI. Writes a new “Reformatted questions” tab in the Doc, with changes highlighted; the original is not changed.</span>
            </div>

            <div className="mt-3 pt-2.5 border-t border-dashed border-gray-300 text-xs text-gray-700">
              <span className="font-bold text-gray-800">Last resort:</span>{' '}
              {signOff && totals.problems > 0 && hasGemini ? (
                <button onClick={() => void runReformat(true)} disabled={busy || !ready}
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

            {geminiConfirm && (
              <div role="alert" aria-labelledby={`${id}-gc`} onKeyDown={(e) => e.key === 'Escape' && setGeminiConfirm(null)} className="mt-3 rounded-xl border-2 border-purple-300 bg-white p-3">
                <p id={`${id}-gc`} className="m-0 text-[12.5px] text-gray-800">{geminiConfirm}</p>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  <button ref={(el) => el?.focus()} onClick={() => void runReformat(true, true)}
                    className="px-3.5 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-xs font-black focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
                    Replace the Revised by Gemini tab
                  </button>
                  <button onClick={() => setGeminiConfirm(null)}
                    className="px-3.5 py-2 rounded-lg border border-gray-500 bg-white text-gray-800 text-xs font-bold hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                    Keep it
                  </button>
                </div>
              </div>
            )}
            {reformatError && (
              <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12.5px] text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span role="alert"><ErrorText message={reformatError} /></span>
              </p>
            )}
          </Step>

          {reformat && <ReformatReview result={reformat} onDismiss={() => setReformat(null)} />}
          {signOff && doc.tabId && (
            <RevisionPanel key={`${doc.fileId}:${doc.tabId}:${readCount}`} fileId={doc.fileId} tabId={doc.tabId} hasGemini={hasGemini}
              onApplied={async (stamp, target) => {
                setReformat(null)
                await read(target.fileId, target.name, { tabId: target.tabId ?? undefined, refresh: true, level: doc.level })
                setPlans((ps) => ps.map((p) => ({ ...p, checked: false })))
                setNotice(`Gemini’s change was written to the Revised by Gemini tab at ${stamp}. Check the quizzes again, then tick Checked for each.`)
              }} />
          )}
        </>
      )}

      {/* 4 · Courses */}
      <MultiCoursePicker selected={courses} onChange={setCourses} site={site} onSiteChange={onSiteChange} onTokenResult={onTokenResult} />

      {/* What Launch will do, in one place, so nothing has to be remembered from steps 1 to 4. */}
      {doc && (
        <section aria-labelledby={`${id}-sum`} className="bg-white border-2 border-gray-300 rounded-2xl p-4">
          <h2 id={`${id}-sum`} className="m-0 mb-3 text-[15px] font-black text-gray-900">Ready to launch</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="m-0 mb-1.5 text-[11px] font-black tracking-wider text-gray-700">
                {chosen.length === 1 ? '1 QUIZ' : `${chosen.length} QUIZZES`}
              </h3>
              {chosen.length === 0 ? (
                <p className="m-0 text-[13px] text-gray-700">None included yet. Include a quiz in step 2.</p>
              ) : (
                <ul className="m-0 p-0 list-none space-y-1.5">
                  {chosen.map((q) => {
                    const p = plans[quizzes.indexOf(q)]
                    return (
                      <li key={q.index} className="text-[13px] text-gray-900">
                        <b className="block">{p?.title.trim() || 'Untitled quiz'}</b>
                        <span className="text-xs text-gray-700">
                          {p ? ENGINE_NAME[p.engine].replace(/zes$/, 'z') : ''} · {plural(q.result.questions.length, 'question')}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div>
              <h3 className="m-0 mb-1.5 text-[11px] font-black tracking-wider text-gray-700">
                {courses.length === 1 ? 'TO 1 COURSE' : `TO ${courses.length} COURSES`}
              </h3>
              {courses.length === 0 ? (
                <p className="m-0 text-[13px] text-gray-700">None ticked yet. Tick a course in step 4.</p>
              ) : (
                <ul className="m-0 p-0 list-none space-y-1.5">
                  {courses.map((c) => (
                    <li key={c.id} className="text-[13px] text-gray-900">
                      <b className="block">{c.name}</b>
                      <span className="text-xs text-gray-700">
                        {c.code}
                        {c.blueprint && ' · Sandbox course'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {chosen.length > 0 && courses.length > 0 && (
            <p className="m-0 mt-3 pt-3 border-t border-gray-200 text-xs text-gray-700">
              {chosen.length * courses.length === 1
                ? 'Launch creates 1 unpublished quiz.'
                : `Launch creates ${chosen.length * courses.length} unpublished quizzes: each quiz in each course.`}
            </p>
          )}
        </section>
      )}

      {dupConfirm && (
        <div role="alert" aria-labelledby={`${id}-dup-text`} onKeyDown={(e) => e.key === 'Escape' && setDupConfirm(null)}
          className="p-3.5 bg-amber-50 border-2 border-amber-300 rounded-xl">
          <p id={`${id}-dup-text`} className="text-[12.5px] text-gray-900 m-0 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" /> {dupConfirm}
          </p>
          <div className="flex flex-wrap gap-2 mt-2.5">
            <button id={`${id}-dup`} onClick={() => void launch(true)}
              className="px-3.5 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-xs font-black focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
              Make second copies
            </button>
            <button onClick={() => { setDupConfirm(null); document.getElementById(`${id}-launch`)?.focus() }}
              className="px-3.5 py-2 rounded-lg border border-gray-500 bg-white text-gray-800 text-xs font-bold hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              Cancel
            </button>
          </div>
        </div>
      )}

      <button id={`${id}-launch`} onClick={() => void launch()} aria-disabled={unique.length > 0 || busy || undefined} aria-describedby={`${id}-launch-why`}
        className="w-full flex items-center justify-center gap-2.5 rounded-xl py-3 font-black text-sm transition bg-brand hover:bg-brand-dark text-white aria-disabled:bg-gray-200 aria-disabled:text-gray-700 aria-disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
        {launching ? <Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden="true" /> : <Rocket engine={launchEngines.length === 1 ? (launchEngines[0] ?? 'new') : 'new'} size={18} color="currentColor" />}
        {launching ? 'Checking the Doc and starting…' : launchLabel}
      </button>
      <p id={`${id}-launch-why`} className="text-xs text-gray-700 text-center m-0">
        {unique.length > 0 ? `To launch: ${unique.slice(0, 4).join('; ')}${unique.length > 4 ? '; …' : ''}.` : 'Every quiz is created unpublished, one course at a time. A failure in one does not stop the others.'}
      </p>
    </div>
  )
}

function other(e: QuizEngine): QuizEngine {
  return e === 'classic' ? 'new' : 'classic'
}
