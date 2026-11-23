import { AlertCircle, AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, Square } from 'lucide-react'
import type { CourseChoice, CourseRunStatus, QuizEngine } from '../types'
import { ErrorText } from './ErrorText'
import { ENGINE_TILE, IconTile, Rocket } from './Icons'

export interface RunQuiz {
  key: string
  title: string
  engine: QuizEngine
  count: number
}

export const runKey = (quizKey: string, courseId: string) => `${quizKey}|${courseId}`

/**
 * Creating the quizzes, and what happened: one block per course, one row per quiz in it, as in the
 * results mockup. Quizzes and courses are done one at a time; a failure in one does not stop the
 * others.
 */
export function RunView(props: {
  quizzes: RunQuiz[]
  courses: CourseChoice[]
  statuses: Record<string, CourseRunStatus>
  done: boolean
  stopping: boolean
  error: string | null
  headingRef: React.RefObject<HTMLHeadingElement | null>
  onStop(): void
  onBack(): void
}) {
  const { quizzes, courses, statuses } = props
  const cells = courses.flatMap((c) => quizzes.map((q) => ({ course: c, quiz: q, status: statuses[runKey(q.key, c.id)] ?? ({ state: 'waiting' } as CourseRunStatus) })))
  const count = (state: CourseRunStatus['state']) => cells.filter((x) => x.status.state === state).length
  const progress = cells.reduce((n, x) => {
    const s = x.status
    if (s.state === 'done' || s.state === 'failed' || s.state === 'skipped') return n + 1
    if (s.state === 'working') return n + (s.total ? s.added / s.total : 0)
    return n
  }, 0)
  const pct = Math.round((progress / Math.max(1, cells.length)) * 100)
  const active = cells.find((x) => x.status.state === 'working')
  const nQ = quizzes.length
  const nC = courses.length

  return (
    <div className="space-y-3.5">
      <section className="bg-white border border-gray-200 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <IconTile color="#0033a0" size={42}>
            <Rocket engine="new" size={22} color="#ffffff" />
          </IconTile>
          <div className="flex-1 min-w-0">
            <h2 ref={props.headingRef} tabIndex={-1} className="font-black text-[14.5px] m-0 focus:outline-none">
              {props.done ? 'Finished' : 'Launching'} {nQ} quiz{nQ === 1 ? '' : 'zes'} in {nC} course{nC === 1 ? '' : 's'}
            </h2>
            <p className="text-xs text-gray-700 m-0">Every quiz is created unpublished.</p>
          </div>
        </div>

        {!props.done && (
          <div className="flex gap-2 mt-3.5">
            <div className="flex-1 rounded-xl bg-[#4f68a4] text-white font-black text-[13px] py-2.5 px-3 flex items-center justify-center gap-2 text-center">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" aria-hidden="true" />
              {active && active.status.state === 'working'
                ? `${active.quiz.title} → ${active.course.code || active.course.name}: question ${Math.min(active.status.added + 1, active.status.total)} of ${active.status.total}`
                : 'Starting…'}
            </div>
            <button
              onClick={props.onStop}
              disabled={props.stopping}
              className="flex-shrink-0 px-4 rounded-xl border-2 border-red-700 text-red-700 bg-white font-black text-[13px] flex items-center gap-1.5 disabled:border-gray-500 disabled:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              {props.stopping ? 'Stopping after this course' : 'Stop after this course'}
            </button>
          </div>
        )}
        <div role="progressbar" aria-label="Overall progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        {/* Always mounted, and changed only when a quiz finishes, so a screen reader hears each one once. */}
        <p role="status" className="sr-only">
          {props.done
            ? `Finished. ${count('done')} created, ${count('failed')} failed${count('skipped') ? `, ${count('skipped')} skipped` : ''}.`
            : `${count('done') + count('failed') + count('skipped')} of ${cells.length} finished.${count('failed') ? ` ${count('failed')} failed.` : ''}`}
        </p>
        <p className="mt-1.5 text-[11px] text-gray-700 tabular-nums m-0">
          {count('done')} created · {count('failed')} failed · {count('waiting') + count('working')} to go{count('skipped') ? ` · ${count('skipped')} skipped` : ''}
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

      {courses.map((c) => (
        <section key={c.id} aria-labelledby={`run-course-${c.id}`} className="bg-white border-2 border-gray-200 rounded-2xl p-4 space-y-2">
          <h3 id={`run-course-${c.id}`} className="font-black text-[14px] m-0">
            {c.name} <span className="font-normal text-xs text-gray-700">{c.code}</span>
          </h3>
          {quizzes.map((q) => (
            <Row key={q.key} quiz={q} status={statuses[runKey(q.key, c.id)] ?? { state: 'waiting' }} blueprint={c.blueprint} course={c.name} />
          ))}
        </section>
      ))}

      {props.done && (
        <>
          {count('failed') > 0 && (
            <div className="flex items-start gap-2.5 p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
              <p className="text-[12.5px] text-amber-900 m-0">
                <b className="text-gray-900">Before trying a failed quiz again,</b> open its course in Canvas. If the quiz was created there with some
                of its questions, delete it first, or the course will end up with two copies.
              </p>
            </div>
          )}
          <button
            onClick={props.onBack}
            className="w-full rounded-xl py-3 font-black text-sm border-2 border-brand text-brand hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Back to the quizzes
          </button>
        </>
      )}
    </div>
  )
}

function Row({ quiz, status, blueprint, course }: { quiz: RunQuiz; status: CourseRunStatus; blueprint: boolean; course: string }) {
  const openLabel = `Open ${quiz.title} in Canvas, in ${course}`
  const name = (
    <span className="flex items-center gap-2">
      <IconTile color={ENGINE_TILE[quiz.engine]} size={22}>
        <Rocket engine={quiz.engine} size={13} />
      </IconTile>
      <b className="text-[13.5px]">{quiz.title}</b>
    </span>
  )
  switch (status.state) {
    case 'done':
      return (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-green-50 border border-green-200">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0 text-green-900">
            {name}
            <p className="m-0 text-xs text-green-800">Created with {status.added} questions.</p>
          </div>
          <a href={status.quizUrl} target="_blank" rel="noreferrer" aria-label={openLabel} className="flex-shrink-0 text-[12.5px] font-black text-brand inline-flex items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
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
              {status.quizUrl
                ? `The quiz was created with ${status.added} question${status.added === 1 ? '' : 's'} before this happened. Delete it in Canvas before launching again, or the course will have two copies.`
                : 'Nothing was created in this course.'}
            </p>
            <div className="m-0 mt-0.5 text-xs text-red-800">
              <ErrorText message={status.message} />
            </div>
          </div>
          {status.quizUrl && (
            <a href={status.quizUrl} target="_blank" rel="noreferrer" aria-label={openLabel} className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand flex-shrink-0 text-[12.5px] font-black text-brand inline-flex items-center gap-1">
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
            <p className="m-0 text-xs text-gray-700">{status.added === 0 ? 'Creating the quiz…' : `Added ${status.added} of ${status.total} questions…`}</p>
            <div className="mt-1.5 h-1 bg-[#dbe7fb] rounded-full overflow-hidden">
              <div className="h-full bg-brand" style={{ width: `${Math.round((status.added / Math.max(1, status.total)) * 100)}%` }} />
            </div>
          </div>
        </div>
      )
    case 'skipped':
      return (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-200">
          <Square className="w-5 h-5 text-gray-700 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            {name}
            <p className="m-0 text-xs text-gray-700">Skipped: stopped before this one. Nothing was created.</p>
          </div>
        </div>
      )
    default:
      return (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-200">
          <Clock className="w-5 h-5 text-gray-700 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            {name}
            <p className="m-0 text-xs text-gray-700">Waiting.{blueprint ? ' Blueprint course: associated courses get it at the next sync.' : ''}</p>
          </div>
        </div>
      )
  }
}
