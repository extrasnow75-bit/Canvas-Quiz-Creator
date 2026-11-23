/**
 * Canvas API calls, made from the main process.
 *
 * The token never travels through the window. Handlers here load it from the keychain at the
 * moment a request is built, and attach it only to the Canvas site saved in settings — every
 * course a quiz is created in must be on that site, and is named by its numeric id alone, so no
 * text from a document or the window can change where the token is sent.
 *
 * Structure carried over from Canvas Rubric Creator; quiz creation is new.
 */
import { ASK_SUPPORT, supportDetails } from './userMessage'
import { getCanvasToken } from './credentials'
import { fetchWithRetry, RequestTimeoutError } from './httpRetry'
import { readSettings } from './settings'
import { chooseCourses, nextPageUrl, type CourseChoice, type RawCourse } from './courseList'
import type { CourseRunStatus, ProgressEvent, Question, QuizEngine } from './quizModel'
import {
  canBuild,
  classicQuestionBody,
  classicQuizBody,
  newQuizBody,
  newQuizItemBody,
  type QuizSettings,
} from './quizPayloads'

const NO_TOKEN_MESSAGE = 'No Canvas token is saved. Add one in Initial setup first.'
const NO_SITE_MESSAGE = 'No Canvas site is saved yet. Choose your courses in Initial setup first.'
const EXPIRED_TOKEN_MESSAGE =
  'Canvas rejected your token. It may have expired or been deleted. Make a new one in Canvas under ' +
  'Account → Settings → New Access Token, then save it in Initial setup.'

/** The saved Canvas site's origin, or null. Every token-bearing request goes here and nowhere else. */
export function savedOrigin(): string | null {
  const site = readSettings().canvasSite
  if (!site) return null
  try {
    const url = new URL(site)
    return url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/** Canvas prefixes some JSON responses with `while(1);` as an anti-hijacking measure. */
function stripJsonGuard(text: string): string {
  return text.replace(/^while\(1\);/, '')
}

async function readJson<T>(response: Response): Promise<T> {
  return JSON.parse(stripJsonGuard(await response.text())) as T
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(stripJsonGuard(text)) as {
      errors?: Array<{ message?: string }> | Record<string, unknown>
      message?: string
    }
    if (Array.isArray(body.errors)) return body.errors[0]?.message ?? body.message ?? response.statusText
    if (body.errors && typeof body.errors === 'object') return JSON.stringify(body.errors).slice(0, 300)
    return body.message ?? response.statusText
  } catch {
    return text.slice(0, 300) || response.statusText
  }
}

function unreachableMessage(e: unknown): string {
  if (e instanceof RequestTimeoutError) return 'Canvas did not answer in time. Check your internet connection, wait a minute, then try again.'
  return `The app could not reach Canvas. Check your internet connection and the Canvas site address in step 4, then try again.${supportDetails(e instanceof Error ? e.message : String(e))}`
}

/** A course id is digits and nothing else; anything else never reaches a URL. */
function assertCourseId(id: string): string {
  if (!/^\d{1,20}$/.test(id)) throw new Error('That is not a Canvas course id.')
  return id
}

// ─── Setup checks ──────────────────────────────────────────────────────────────

/** Check that the saved token works on the saved site, and say whose it is. */
export async function verifyToken(): Promise<{ ok: boolean; name?: string; message?: string }> {
  const origin = savedOrigin()
  if (!origin) return { ok: false, message: NO_SITE_MESSAGE }
  const token = getCanvasToken()
  if (!token) return { ok: false, message: NO_TOKEN_MESSAGE }
  try {
    const response = await fetchWithRetry(`${origin}/api/v1/users/self/profile`, { headers: authHeaders(token) }, { idempotent: true })
    if (response.status === 401) return { ok: false, message: EXPIRED_TOKEN_MESSAGE }
    if (!response.ok) return { ok: false, message: `Canvas could not check your token just now. Wait a minute, then try again. ${ASK_SUPPORT}${supportDetails(`Canvas ${response.status}`)}` }
    const profile = await readJson<{ name?: string }>(response)
    return { ok: true, name: profile.name }
  } catch (e) {
    return { ok: false, message: unreachableMessage(e) }
  }
}

const COURSE_QUERY = 'include[]=term&state[]=available&state[]=unpublished'
const MAX_COURSE_PAGES = 50

class CourseListError extends Error {}

async function fetchCoursePages(origin: string, query: string, token: string): Promise<RawCourse[]> {
  const all: RawCourse[] = []
  let url: string | null = `${origin}/api/v1/courses?${query}&per_page=100`
  for (let page = 0; url && page < MAX_COURSE_PAGES; page++) {
    const response: Response = await fetchWithRetry(url, { headers: authHeaders(token) }, { idempotent: true })
    if (response.status === 401) throw new CourseListError(EXPIRED_TOKEN_MESSAGE)
    if (!response.ok) throw new CourseListError(courseListMessage(response.status, await readError(response)))
    const data: unknown = await readJson(response)
    if (Array.isArray(data)) all.push(...(data as RawCourse[]))
    url = nextPageUrl(response.headers.get('link'), origin)
  }
  return all
}

/**
 * The courses the token's owner teaches, assists in or designs on `origin`, including custom
 * roles built on those (Course Administrator): see courseList.ts. The caller has checked `origin`.
 */
export async function listCourses(
  origin: string,
): Promise<{ ok: true; site: string; courses: CourseChoice[] } | { ok: false; message: string }> {
  const token = getCanvasToken()
  if (!token) return { ok: false, message: NO_TOKEN_MESSAGE }
  try {
    const current = await fetchCoursePages(origin, COURSE_QUERY, token)
    let past: RawCourse[] = []
    try {
      past = await fetchCoursePages(origin, `${COURSE_QUERY}&state[]=completed&enrollment_state=completed`, token)
    } catch {
      // The current list is still useful if the past one fails.
    }
    return { ok: true, site: origin, courses: chooseCourses([...current, ...past]) }
  } catch (e) {
    if (e instanceof CourseListError) return { ok: false, message: e.message }
    return { ok: false, message: unreachableMessage(e) }
  }
}

// ─── Creating a quiz ───────────────────────────────────────────────────────────

function courseListMessage(status: number, detail: string): string {
  const tail = supportDetails(`Canvas ${status}. ${detail}`)
  if (status === 403) return `Canvas would not list your courses with this token. Make a new token in Canvas under Account → Settings → New Access Token, then save it in Initial setup.${tail}`
  if (status === 404) return `Canvas could not find that site's course list. Check the Canvas site address, for example yourschool.instructure.com, then try again.${tail}`
  if (status === 429) return 'Canvas is busy and asked the app to slow down. Wait a minute, then choose Try again.'
  if (status >= 500) return `Canvas is having a problem right now. Wait a few minutes, then try again.${tail}`
  return `Canvas could not list your courses. Please try again. ${ASK_SUPPORT}${tail}`
}

/** A failed create, by what it means and what to do next, for the results list. */
export function failureMessage(status: number, detail: string, engine: QuizEngine): string {
  const tail = supportDetails(`Canvas ${status}. ${detail}`)
  if (status === 401) return EXPIRED_TOKEN_MESSAGE
  if (status === 403)
    return `Canvas did not let you create quizzes in this course. Check that you are a teacher, designer or course administrator there, or remove the course in step 4.${tail}`
  if (status === 404) {
    return engine === 'new'
      ? `Canvas could not find New Quizzes in this course. New Quizzes may not be turned on there: go back, choose Classic for this quiz in step 2, and launch again.${tail}`
      : `Canvas could not find this course. It may have been deleted. Remove it in step 4, then launch again.${tail}`
  }
  if (status === 429) return 'Canvas is busy and asked the app to slow down. Wait a minute, then launch again for this course.'
  if (status === 400 || status === 422) return `Canvas would not accept this quiz as written. Check the question in the Doc, then launch again for this course. ${ASK_SUPPORT}${tail}`
  if (status >= 500) return `Canvas is having a problem right now. Wait a few minutes, then launch again for this course.${tail}`
  return `Canvas could not create the quiz. Please try again. ${ASK_SUPPORT}${tail}`
}

/** One course: create the quiz, then add each question in order, reporting as it goes. */
async function createInCourse(args: {
  origin: string
  token: string
  courseId: string
  engine: QuizEngine
  settings: QuizSettings
  questions: Question[]
  signal?: AbortSignal
  report: (status: CourseRunStatus) => void
  newId: () => string
}): Promise<CourseRunStatus> {
  const { origin, token, engine, questions, report } = args
  const courseId = assertCourseId(args.courseId)
  const base = engine === 'classic' ? `${origin}/api/v1/courses/${courseId}/quizzes` : `${origin}/api/quiz/v1/courses/${courseId}/quizzes`
  const post = (url: string, body: unknown) =>
    // Creating is not safe to repeat: only a 429 ("not processed, wait") is retried.
    fetchWithRetry(url, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }, { idempotent: false, signal: args.signal })

  report({ state: 'working', added: 0, total: questions.length })

  let quizUrl: string | undefined
  let added = 0
  try {
    const created = await post(base, engine === 'classic' ? classicQuizBody(args.settings) : newQuizBody(args.settings))
    if (!created.ok) return { state: 'failed', message: failureMessage(created.status, await readError(created), engine), added: 0 }
    const quiz = await readJson<{ id?: number | string; assignment_id?: number | string }>(created)
    const quizId = String(quiz.id ?? quiz.assignment_id ?? '')
    if (!/^\d+$/.test(quizId)) return { state: 'failed', message: `Canvas created the quiz but did not send back its id, so no questions were added. Find the empty quiz in Canvas, delete it, then launch again. ${ASK_SUPPORT}`, added: 0 }
    quizUrl =
      engine === 'classic'
        ? `${origin}/courses/${courseId}/quizzes/${quizId}`
        : `${origin}/courses/${courseId}/assignments/${quizId}`

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const url = engine === 'classic' ? `${base}/${quizId}/questions` : `${base}/${quizId}/items`
      const body = engine === 'classic' ? classicQuestionBody(q, i) : newQuizItemBody(q, i, args.newId)
      const response = await post(url, body)
      if (!response.ok) {
        return {
          state: 'failed',
          message: `Question ${q.number ?? i + 1}: ${failureMessage(response.status, await readError(response), engine)}`,
          added,
          quizUrl,
        }
      }
      added++
      report({ state: 'working', added, total: questions.length })
    }

    // Classic Quizzes total their points when the quiz is saved, not when a question is added,
    // so save it once at the end (still unpublished) or it shows 0 points until someone edits it.
    if (engine === 'classic') {
      await fetchWithRetry(
        `${base}/${quizId}`,
        { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ quiz: { published: false, notify_of_update: false } }) },
        { idempotent: true, signal: args.signal },
      ).catch(() => undefined)
    }

    return { state: 'done', added, quizUrl }
  } catch (e) {
    if (args.signal?.aborted) return { state: 'failed', message: 'Stopped.', added, quizUrl }
    const message =
      e instanceof RequestTimeoutError
        ? 'Canvas did not answer in time. The last question may or may not have been added, so check the quiz in Canvas before trying again.'
        : unreachableMessage(e)
    return { state: 'failed', message, added, quizUrl }
  }
}

/**
 * Create the same quiz in each course, one course at a time.
 *
 * A failure in one course does not stop the others. `shouldStop` lets the course in progress
 * finish, then marks the remaining courses skipped; the signal cancels immediately. Questions the app cannot build in this engine
 * are left out; the preview has already said so.
 */
export async function createQuizInCourses(args: {
  courseIds: string[]
  engine: QuizEngine
  settings: QuizSettings
  questions: Question[]
  signal?: AbortSignal
  /** Checked between courses: true finishes the course in progress, then skips the rest. */
  shouldStop?: () => boolean
  onProgress: (e: ProgressEvent) => void
  newId: () => string
}): Promise<{ ok: true; results: ProgressEvent[] } | { ok: false; message: string }> {
  const origin = savedOrigin()
  if (!origin) return { ok: false, message: NO_SITE_MESSAGE }
  const token = getCanvasToken()
  if (!token) return { ok: false, message: NO_TOKEN_MESSAGE }
  const title = args.settings.title.trim()
  if (!title) return { ok: false, message: 'Give the quiz a title first.' }

  const questions = args.questions.filter((q) => canBuild(q, args.engine))
  if (questions.length === 0) return { ok: false, message: 'There are no questions the app can build for this quiz type.' }

  const results: ProgressEvent[] = []
  for (const courseId of args.courseIds) {
    if (args.signal?.aborted || args.shouldStop?.()) {
      const e = { courseId, status: { state: 'skipped' } as CourseRunStatus }
      results.push(e)
      args.onProgress(e)
      continue
    }
    const status = await createInCourse({
      origin,
      token,
      courseId,
      engine: args.engine,
      settings: { ...args.settings, title },
      questions,
      signal: args.signal,
      newId: args.newId,
      report: (s) => args.onProgress({ courseId, status: s }),
    })
    const e = { courseId, status }
    results.push(e)
    args.onProgress(e)
  }
  return { ok: true, results }
}
