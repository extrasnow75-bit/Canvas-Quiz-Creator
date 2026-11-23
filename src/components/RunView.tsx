import { AlertCircle, AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, Send, Square } from 'lucide-react'
import type { CourseChoice, CourseRunStatus, QuizEngine } from '../types'
import { ErrorText } from './ErrorText'

// ─── Progress and results ──────────────────────────────────────────────────────

export function RunView(props: {
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
