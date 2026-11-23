import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react'
import { CoursesIcon, IconTile, STEP_TILE } from './Icons'
import type { CourseChoice } from '../types'
import { countCourses, DEFAULT_SITE, NO_TERM_GROUP, siteHost, visibleGroups } from './courseFilter'
import { ErrorText } from './ErrorText'

const ROLE_STYLE = {
  teacher: 'bg-indigo-100 text-indigo-900',
  ta: 'bg-amber-100 text-amber-900',
  designer: 'bg-green-100 text-green-900',
} as const
const ROLE_LABEL = { teacher: 'Teacher', ta: 'TA', designer: 'Designer' } as const

interface Props {
  /** The chosen courses, in the order they were ticked. */
  selected: CourseChoice[]
  onChange(selected: CourseChoice[]): void
  /** The saved Canvas site, or null on first use. */
  site: string | null
  onSiteChange(site: string): void
  /** Called when Canvas answers for the token, so Initial setup can show whether it works. */
  onTokenResult(result: { ok: true } | { ok: false; message: string }): void
}

/**
 * Choose one or more Canvas courses for the quiz.
 *
 * The list is the one Canvas Extractor Tools and Canvas Rubric Creator show — teacher, TA and
 * designer courses, custom roles such as Course Administrator included, masters first, then the
 * newest term — with a tick box per course and a "Select all" per term, as in the design mockup.
 */
export function MultiCoursePicker({ selected, onChange, site, onSiteChange, onTokenResult }: Props) {
  const [courses, setCourses] = useState<CourseChoice[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showEnded, setShowEnded] = useState(false)
  const [editingSite, setEditingSite] = useState(false)
  const [siteInput, setSiteInput] = useState('')
  const latest = useRef(0)
  const id = useId()
  const current = site ?? DEFAULT_SITE

  const load = async (target: string) => {
    const mine = ++latest.current
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.canvas.listCourses({ site: target })
      if (mine !== latest.current) return
      if (res.ok) {
        setCourses(res.courses)
        if (res.site !== site) {
          onSiteChange(res.site)
          onChange([]) // courses on another site cannot be mixed with these
        }
        onTokenResult({ ok: true })
      } else {
        setError(res.message)
        if (/token/i.test(res.message)) onTokenResult({ ok: false, message: res.message })
      }
    } catch (err) {
      if (mine === latest.current) setError(err instanceof Error ? err.message : 'Could not load your courses.')
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }

  useEffect(() => {
    void load(current)
    // Loaded once on opening; "Refresh" and "Change" load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isPicked = (c: CourseChoice) => selected.some((s) => s.id === c.id)
  const setPicked = (list: CourseChoice[], on: boolean) => {
    const ids = new Set(list.map((c) => c.id))
    const rest = selected.filter((s) => !ids.has(s.id))
    onChange(on ? [...rest, ...list] : rest)
  }

  const visible = courses ? courses.filter((c) => showEnded || !c.ended || isPicked(c)) : []
  const groups = visibleGroups(visible, query)
  const shown = countCourses(groups)
  const hasBlueprint = selected.some((c) => c.blueprint)
  const n = selected.length

  return (
    <section aria-labelledby={`${id}-h`} className={`rounded-2xl border-2 bg-white p-4 ${n > 0 ? 'border-green-200 shadow-[0_0_0_3px_rgba(240,253,244,1)]' : 'border-gray-200'}`}>
      <div className="flex items-center gap-3 mb-1.5">
        <IconTile color={STEP_TILE.courses}>
          <CoursesIcon />
        </IconTile>
        <div>
          <p className="m-0 text-[11px] font-black tracking-wider text-gray-700">STEP 4</p>
          <h2 id={`${id}-h`} className="font-black text-[15px] m-0">
            Canvas courses
          </h2>
        </div>
        <span className="ml-auto text-xs text-gray-600 flex items-center gap-1.5">
          {editingSite ? null : (
            <>
              {siteHost(current)} ·
              <button
                onClick={() => {
                  setSiteInput(siteHost(current))
                  setEditingSite(true)
                }}
                className="font-black text-brand underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Change site
              </button>
              ·
              <button
                onClick={() => void load(current)}
                className="font-black text-brand underline underline-offset-2 rounded inline-flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <RefreshCw className="w-3 h-3" aria-hidden="true" /> Refresh
              </button>
            </>
          )}
        </span>
      </div>
      <p className="text-[13px] text-gray-600 mb-3">
        Tick every course that should get these quizzes. Each quiz is created, unpublished, in every course you tick.
      </p>

      {editingSite && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-gray-700">
          <label htmlFor={`${id}-site`}>Canvas site</label>
          <input
            id={`${id}-site`}
            autoFocus
            value={siteInput}
            onChange={(e) => setSiteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setEditingSite(false)
                void load(siteInput)
              } else if (e.key === 'Escape') setEditingSite(false)
            }}
            placeholder="yourschool.instructure.com"
            spellCheck={false}
            className="flex-1 min-w-[12rem] border-2 border-gray-500 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand"
          />
          <button
            onClick={() => {
              setEditingSite(false)
              void load(siteInput)
            }}
            className="font-black text-brand underline underline-offset-2"
          >
            Load courses
          </button>
          <button onClick={() => setEditingSite(false)} className="font-bold text-gray-700 underline underline-offset-2">
            Cancel
          </button>
        </div>
      )}

      {/* What is ticked, as removable chips. */}
      <div className="flex flex-wrap items-center gap-1.5 min-h-10 px-2.5 py-2 rounded-xl bg-slate-50 border border-gray-200 mb-2.5">
        <span role="status" className="text-[12.5px] font-black text-gray-900 mr-1">
          {n === 0 ? 'No courses selected' : n === 1 ? '1 course selected:' : `${n} courses selected:`}
        </span>
        {selected.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-[#dbe7fb] text-[#0a2a6b] text-xs font-bold">
            {c.code || c.name}
            <button
              onClick={() => setPicked([c], false)}
              aria-label={`Remove ${c.name}`}
              className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {n > 0 && (
          <button onClick={() => onChange([])} className="ml-auto text-xs font-bold text-gray-700 underline underline-offset-2 px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            Clear all
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-2.5">
        <label htmlFor={`${id}-q`} className="sr-only">
          Search your courses
        </label>
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by course name or code"
          spellCheck={false}
          className="flex-1 min-w-0 border-2 border-gray-500 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-blue-200 transition"
        />
        <label className="flex items-center gap-1.5 text-[12.5px] text-gray-800 whitespace-nowrap px-1 cursor-pointer">
          <input type="checkbox" checked={showEnded} onChange={() => setShowEnded((s) => !s)} className="w-3.5 h-3.5 accent-brand" />
          Show ended courses
        </label>
      </div>

      <div className="border border-gray-200 rounded-xl max-h-[340px] overflow-y-auto" role="region" aria-label="Your courses" tabIndex={0}>
        {loading && (
          <p role="status" className="p-3.5 text-[13px] text-gray-700 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading your courses…
          </p>
        )}
        {error && !loading && (
          <div className="p-3.5 flex items-start gap-2 text-[13px] text-red-800">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-700" aria-hidden="true" />
            <p role="alert" className="min-w-0">
              <ErrorText message={error} />
            </p>
          </div>
        )}
        {courses && !loading && shown === 0 && (
          <p className="p-3.5 text-[13px] text-gray-700">
            {courses.length === 0
              ? 'No courses were found where you are a teacher, TA, designer or course administrator on this site.'
              : query
                ? `No courses match “${query}”.`
                : 'Every course here has ended. Tick “Show ended courses” to see them.'}
          </p>
        )}
        {!loading &&
          groups.map((g, gi) => {
            const allOn = g.courses.every(isPicked)
            return (
              <div key={`${g.term}-${g.ended}`} role="group" aria-labelledby={`${id}-g${gi}`}>
                <div className="sticky top-0 z-10 bg-[#dbe7fb] px-3 py-1.5 flex items-center gap-2">
                  <span id={`${id}-g${gi}`} className="text-[12px] font-black uppercase tracking-wider text-[#0a2a6b]">
                    {g.term}
                  </span>
                  <span className="text-[12px] text-[#0a2a6b]">
                    {g.term === NO_TERM_GROUP ? 'master and template courses' : g.ended ? 'ended' : ''}
                  </span>
                  <button
                    onClick={() => setPicked(g.courses, !allOn)}
                    className="ml-auto text-[12px] font-black text-brand rounded px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {allOn ? `Clear these (${g.courses.length})` : `Select all (${g.courses.length})`}
                  </button>
                </div>
                {g.courses.map((c) => {
                  const on = isPicked(c)
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-3 py-2 border-t border-gray-100 cursor-pointer ${on ? 'bg-[#eef3fc] shadow-[inset_0_0_0_2px_#0033a0]' : 'hover:bg-blue-50'}`}
                    >
                      <input type="checkbox" checked={on} onChange={() => setPicked([c], !on)} className="w-4 h-4 flex-shrink-0 accent-brand" />
                      <span className="flex-1 min-w-0">
                        <b className="block text-[13.5px] text-gray-900">{c.name}</b>
                        {c.code && <small className="text-xs text-gray-600">{c.code}</small>}
                      </span>
                      {c.blueprint && <span className="text-[10.5px] font-black rounded-full px-2 py-0.5 bg-purple-100 text-purple-900">BLUEPRINT</span>}
                      {c.ended && <span className="text-[10.5px] font-black rounded-full px-2 py-0.5 bg-gray-100 text-gray-700">ENDED</span>}
                      <span className={`text-[10.5px] font-black rounded-full px-2 py-0.5 flex-shrink-0 ${ROLE_STYLE[c.role]}`}>
                        {c.roleLabel || ROLE_LABEL[c.role]}
                      </span>
                    </label>
                  )
                })}
              </div>
            )
          })}
      </div>

      {hasBlueprint && (
        <div className="mt-2.5 flex items-start gap-2.5 p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
          <p className="text-[12.5px] text-amber-900 m-0">
            <b className="text-gray-900">A Blueprint course is ticked.</b> Its associated courses get the quiz at the next Blueprint
            sync. Tick those courses here as well and they would end up with two copies.
          </p>
        </div>
      )}
    </section>
  )
}
