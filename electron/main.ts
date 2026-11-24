import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { isAllowedExternalUrl, setAllowedCanvasHost } from './ipc/externalLinks'
import { readSettings, updateSettings } from './ipc/settings'
import { setCanvasToken, canvasTokenStatus, setGeminiApiKey, geminiKeyStatus, getGeminiApiKey, type CredentialStatus } from './ipc/credentials'
import { askForLines, validateGeminiKey } from './ipc/gemini'
import { checkFallback, checkRevision, fallbackPrompt, markHeadings, revisionPrompt } from './ipc/aiReformat'
import { createQuizInCourses, listCourses, savedOrigin, verifyToken } from './ipc/canvas'
import { normalizeSite } from './ipc/courseList'
import { signIn, cancelSignIn, getStatus, clearTokens, verifySignIn } from './ipc/googleAuth'
import { withJob, cancelJob } from './ipc/jobs'
import { toUserMessage } from './ipc/userMessage'
import {
  listFiles,
  getFileMetadata,
  getGoogleDocStructure,
  extractFileIdFromUrl,
  canEditFile,
  docsBatchUpdate,
  createGoogleDoc,
  describeDriveFile,
  type ListFilesArgs,
} from './ipc/googleDrive'
import { reformatDocument, problemsOf, addGuessWarnings, type DocumentFix } from './ipc/docReformat'
import { addTabRequest, clearTabRequest, fillTabRequests, withoutAppNotes, newestAppTab, stampFor, tabUrl, uniqueTabTitle, GEMINI_TAB_TITLE, type HeaderNotes } from './ipc/docsWrite'
import type { FixedLine as WrittenLine } from './ipc/reformat'
import type { FixedLine, ReformatResult as RuleResult } from './ipc/reformat'
import { docToLines, listTabs, type DocsDocument } from './ipc/docLines'
import { parseQuiz } from './ipc/quizFormat'
import type { DocLine, ProgressEvent, Question, QuizEngine } from './ipc/quizModel'
import { canBuild, type QuizSettings } from './ipc/quizPayloads'
import { checkForUpdate, checkNow, RELEASES_PAGE } from './ipc/updateCheck'
import {
  applyZoomLevel,
  getSavedZoomLevel,
  registerZoomShortcuts,
  stepZoom,
  MIN_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
} from './ipc/zoom'

const IS_MAC = process.platform === 'darwin'

/**
 * True only for a navigation back to the page this window already shows. Under file:// every
 * origin is "null", so the exact document is required there. See Canvas Rubric Creator.
 */
function isOwnPage(win: BrowserWindow, url: string): boolean {
  const current = win.webContents.getURL()
  if (!current) return false
  try {
    const target = new URL(url)
    const here = new URL(current)
    if (here.origin === 'null' || target.origin === 'null') {
      return target.protocol === here.protocol && target.pathname === here.pathname
    }
    return target.origin === here.origin
  } catch {
    return false
  }
}

/** Open a link in the person's browser, but only one on the allowlist (externalLinks.ts). */
async function openExternalSafely(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) return
  await shell.openExternal(url)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 860,
    minWidth: 860,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 13, y: 11 } }
      : { titleBarOverlay: { color: '#0033a0', symbolColor: '#ffffff', height: 36 } }),
    backgroundColor: '#f8fafc',
  })

  // Only the app's own page renders here. Everything else opens in the person's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isOwnPage(win, url)) return
    event.preventDefault()
    void openExternalSafely(url)
  })

  registerZoomShortcuts(win)
  win.webContents.on('did-finish-load', () => applyZoomLevel(win, getSavedZoomLevel()))

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function windowFor(e: { sender: Electron.WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

// ─── App info, updates, zoom, clipboard ────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:checkUpdate', () => checkForUpdate())
ipcMain.handle('app:checkUpdateNow', () => checkNow())
ipcMain.handle('app:openReleases', () => shell.openExternal(RELEASES_PAGE))

ipcMain.handle('app:getZoom', (e) => {
  const win = windowFor(e)
  return { level: win ? win.webContents.getZoomLevel() : 0, min: MIN_ZOOM_LEVEL, max: MAX_ZOOM_LEVEL }
})
ipcMain.handle('app:stepZoom', (e, delta: number) => {
  const win = windowFor(e)
  return win ? stepZoom(win, delta > 0 ? 1 : -1) : 0
})
ipcMain.handle('app:resetZoom', (e) => {
  const win = windowFor(e)
  return win ? applyZoomLevel(win, 0) : 0
})

ipcMain.handle('clipboard:writeText', (_e, text: string) => {
  if (typeof text !== 'string') return false
  clipboard.writeText(text)
  return true
})

ipcMain.handle('settings:getLastEngine', () => readSettings().lastEngine ?? null)
ipcMain.handle('settings:setLastEngine', (_e, engine: QuizEngine) => {
  if (engine === 'classic' || engine === 'new') updateSettings({ lastEngine: engine })
})

// ─── Canvas token ──────────────────────────────────────────────────────────────
//
// `set` takes the secret; the only read returns whether one is saved and its last four
// characters. There is deliberately no handler that returns the token. See credentials.ts.

ipcMain.handle('credentials:setCanvasToken', (_e, token: string | null) => {
  setCanvasToken(token)
  approvedHosts.clear()
})
ipcMain.handle('credentials:canvasTokenStatus', (): CredentialStatus => canvasTokenStatus())

/** Saved only once Gemini accepts it, so a typo is caught here rather than mid-reformat. */
ipcMain.handle('credentials:setGeminiKey', async (_e, key: string | null) => {
  if (!key || !key.trim()) {
    setGeminiApiKey(null)
    return { ok: true as const }
  }
  const check = await validateGeminiKey(key)
  if (!check.ok) return { ok: false as const, message: check.message ?? 'Gemini did not accept that key.' }
  setGeminiApiKey(key)
  return { ok: true as const }
})
ipcMain.handle('credentials:geminiKeyStatus', (): CredentialStatus => geminiKeyStatus())

// ─── Canvas site and courses ───────────────────────────────────────────────────

/** Hosts approved in the native dialog during this run. Every launch asks again for a new one. */
const approvedHosts = new Set<string>()
/**
 * The site the app fills in itself (DEFAULT_SITE in courseFilter.ts). The dialog guards against a
 * mistyped or planted address, which this is not, so it is never asked about.
 */
const BUILT_IN_HOST = 'boisestatecanvas.instructure.com'
let confirmOpen = false

/**
 * Ask, in a native dialog the window cannot click for itself, whether the Canvas token may go to
 * `host`. The saved site needs no asking; a different one always does.
 */
async function confirmCanvasHost(win: BrowserWindow | null, host: string): Promise<boolean> {
  if (confirmOpen || !win) return false
  confirmOpen = true
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', `Use ${host}`],
      defaultId: 0,
      cancelId: 0,
      title: 'Use this Canvas site?',
      message: `Send your Canvas token to ${host}?`,
      detail:
        `The app will send your Canvas access token to ${host} to list your courses and create quizzes there.\n\n` +
        'That token can read your courses and student records, so only continue if this is your ' +
        'institution’s Canvas address.',
    })
    if (response !== 1) return false
    approvedHosts.add(host)
    return true
  } finally {
    confirmOpen = false
  }
}

ipcMain.handle('canvas:getSite', () => savedOrigin())

/**
 * List the person's courses on `site`, and make it the saved site. Moving to a site other than
 * the saved one is confirmed natively first, because the saved site is where the token goes.
 */
ipcMain.handle('canvas:listCourses', async (e, args: { site: string }) => {
  const origin = normalizeSite(args?.site ?? '')
  if (!origin) {
    return { ok: false as const, message: 'That is not a Canvas site address. It should look like yourschool.instructure.com' }
  }
  const host = new URL(origin).host
  const current = savedOrigin()
  const currentHost = current ? new URL(current).host : undefined
  if (host !== currentHost && host !== BUILT_IN_HOST && !approvedHosts.has(host)) {
    if (!(await confirmCanvasHost(windowFor(e), host))) {
      return { ok: false as const, message: 'Cancelled. No courses were loaded.' }
    }
  }
  // The saved site is where the token goes, so it changes only once that site has answered.
  const result = await listCourses(origin)
  if (result.ok && origin !== current) {
    updateSettings({ canvasSite: origin })
    setAllowedCanvasHost(origin)
  }
  return result
})

ipcMain.handle('canvas:verifyToken', () => verifyToken())

/** A course as the window shows it in the results: only the id is used to reach Canvas. */
interface RunCourse {
  id: string
  name: string
  [k: string]: unknown
}

/**
 * The run in progress (or the last one), kept here so a window that reloads mid-run can show it
 * again, and so a second Launch cannot start while one is still going.
 */
let activeRun: {
  jobId: string
  quizzes: Array<{ key: string; title: string; engine: QuizEngine; count: number }>
  courses: RunCourse[]
  statuses: Record<string, ProgressEvent['status']>
  done: boolean
  error: string | null
} | null = null

ipcMain.handle('canvas:currentRun', () => activeRun)

const MAX_COURSES = 100
const MAX_QUIZZES = 50

/**
 * Create several quizzes from one Doc, each as its own quiz type, all in the same courses. Quizzes
 * go one at a time, and within each quiz one course at a time. "Stop after this course" finishes
 * the course in progress, then skips everything left, in every quiz.
 *
 * The window says which quizzes (by their place in the Doc), their titles and quiz types. The
 * questions themselves come from the Doc, read again here, never from the window; and if the Doc
 * changed since the window last showed it, nothing is created.
 */
ipcMain.handle(
  'canvas:createQuizzes',
  async (
    e,
    args: {
      fileId: string
      tabId?: string | null
      level?: number | null
      picks: Array<{ index: number; title: string; engine: QuizEngine }>
      courses: RunCourse[]
      jobId: string
    },
  ) => {
    if (activeRun && !activeRun.done) {
      return { ok: false as const, message: 'Quizzes are already being created. Wait for that run to finish, then try again.' }
    }
    const courses = (Array.isArray(args?.courses) ? args.courses : []).filter(
      (c, i, all) => c && /^\d+$/.test(String(c.id)) && all.findIndex((x) => String(x?.id) === String(c.id)) === i,
    )
    if (courses.length === 0) return { ok: false as const, message: 'Choose at least one course in step 4.' }
    if (courses.length > MAX_COURSES) return { ok: false as const, message: `Choose ${MAX_COURSES} courses or fewer at a time.` }
    const picks = Array.isArray(args?.picks) ? args.picks : []
    if (picks.length === 0) return { ok: false as const, message: 'Tick at least one quiz to build in step 2.' }
    if (picks.length > MAX_QUIZZES) return { ok: false as const, message: `Build ${MAX_QUIZZES} quizzes or fewer at a time.` }
    if (picks.some((q) => q.engine !== 'classic' && q.engine !== 'new' || !Number.isInteger(q.index))) {
      return { ok: false as const, message: 'Each quiz needs Classic Quizzes or New Quizzes. Choose one in step 2.' }
    }
    if (typeof args.jobId !== 'string' || !args.jobId) return { ok: false as const, message: 'The run could not start. Please try again.' }

    // Read the Doc again: the questions sent to Canvas are the ones in it now.
    let read: Awaited<ReturnType<typeof readQuizzes>>
    try {
      read = await readQuizzes({ fileId: args.fileId, tabId: args.tabId ?? undefined, refresh: true, level: args.level })
    } catch (err) {
      return { ok: false as const, message: toUserMessage(err, 'The Google Doc could not be read again before launching.') }
    }
    if (read.fingerprint !== shownQuizzes.get(args.fileId)) {
      return {
        ok: false as const,
        changed: true as const,
        message: 'The Google Doc changed since you last read it, so nothing was sent to Canvas. Check the quizzes below, which are the Doc as it is now, then launch again.',
      }
    }
    const list: Array<{ key: string; title: string; engine: QuizEngine; questions: Question[] }> = []
    for (const p of picks) {
      const q = read.quizzes[p.index]
      if (!q) return { ok: false as const, changed: true as const, message: 'A quiz you chose is no longer in the Doc. Check the quizzes below, then launch again.' }
      const title = String(p.title ?? '').trim().slice(0, 255)
      if (!title) return { ok: false as const, message: 'Every quiz needs a title. Type one in step 2.' }
      list.push({ key: String(p.index), title, engine: p.engine, questions: q.result.questions.filter((x) => canBuild(x, p.engine)) })
    }
    updateSettings({ lastEngine: list[list.length - 1].engine })

    const courseIds = courses.map((c) => String(c.id))
    const run = {
      jobId: args.jobId,
      quizzes: list.map((q) => ({ key: q.key, title: q.title, engine: q.engine, count: q.questions.length })),
      courses: courses.map((c) => ({ ...c, id: String(c.id), name: String(c.name ?? '') })),
      statuses: {} as Record<string, ProgressEvent['status']>,
      done: false,
      error: null as string | null,
    }
    activeRun = run
    stopRequested.delete(args.jobId)
    const send = (p: ProgressEvent) => {
      run.statuses[`${p.quizKey ?? '0'}|${p.courseId}`] = p.status
      if (!e.sender.isDestroyed()) e.sender.send('quiz:progress', { ...p, jobId: args.jobId })
    }
    const shouldStop = () => stopRequested.has(args.jobId)
    const results: ProgressEvent[] = []

    try {
      return await withJob(args.jobId, async (signal) => {
        for (const quiz of list) {
          if (shouldStop() || signal?.aborted) {
            for (const courseId of courseIds) {
              const p = { quizKey: quiz.key, courseId, status: { state: 'skipped' } as const }
              results.push(p)
              send(p)
            }
            continue
          }
          const res = await createQuizInCourses({
            courseIds,
            engine: quiz.engine,
            settings: { title: quiz.title, description: '' },
            questions: quiz.questions,
            signal,
            shouldStop,
            newId: randomUUID,
            onProgress: (p) => send({ ...p, quizKey: quiz.key }),
          })
          if (!res.ok) {
            for (const courseId of courseIds) {
              const p = { quizKey: quiz.key, courseId, status: { state: 'failed' as const, message: res.message, added: 0 } }
              results.push(p)
              send(p)
            }
          } else {
            for (const r of res.results) {
              const p = { ...r, quizKey: quiz.key }
              results.push(p)
              run.statuses[`${quiz.key}|${r.courseId}`] = r.status
            }
          }
        }
        return { ok: true as const, results }
      })
    } catch (err) {
      run.error = toUserMessage(err, 'Something went wrong while creating the quizzes.')
      return { ok: false as const, message: run.error }
    } finally {
      run.done = true
    }
  },
)

/** Runs asked to stop once the course in progress is finished. */
const stopRequested = new Set<string>()
ipcMain.handle('canvas:stopAfterCourse', (_e, jobId: string) => {
  if (typeof jobId === 'string') stopRequested.add(jobId)
})
ipcMain.handle('jobs:cancel', (_e, jobId: string) => cancelJob(jobId))

// ─── Google sign-in ────────────────────────────────────────────────────────────

ipcMain.handle('google:signIn', (_e, options?: { useAnotherAccount?: boolean }) => signIn(options))
ipcMain.handle('google:cancelSignIn', () => cancelSignIn())
ipcMain.handle('google:status', () => getStatus())
ipcMain.handle('google:verify', () => verifySignIn())
ipcMain.handle('google:signOut', () => clearTokens())

// ─── Google Drive and Docs ─────────────────────────────────────────────────────

ipcMain.handle('drive:listFiles', (_e, args: ListFilesArgs) => listFiles(args))

ipcMain.handle('drive:resolveUrl', async (_e, url: string) => {
  try {
    const fileId = extractFileIdFromUrl(url)
    const meta = await getFileMetadata(fileId)
    return { ok: true as const, fileId, name: meta.name, mimeType: meta.mimeType }
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
  }
})

/** The last document read, so switching tabs does not fetch it again. */
let lastDoc: { fileId: string; doc: DocsDocument } | null = null

/**
 * The revision each document was at right after this app last wrote to it. A later read that finds
 * a different revision means a person has edited it since: the "Manual edit detected" notice.
 */
const appWrites = new Map<string, string>()

/**
 * Read a Google Doc's questions: the document's tabs, and the questions in one of them (the
 * first, or `tabId`). `refresh` fetches it again, after someone has edited it.
 */
/** What the window was last shown of each Doc, so Launch can tell when the Doc has changed since. */
const shownQuizzes = new Map<string, string>()

/** The scoring content of a Doc's quizzes, for telling whether it changed. */
const fingerprintOf = (quizzes: Array<{ title: string | null; result: ReturnType<typeof parseQuiz> }>) =>
  JSON.stringify(quizzes.map((q) => [q.title, q.result.questions.map(({ line: _l, ...x }) => x)]))

/** Lines in one tab past which the app refuses the Doc rather than slowing to a crawl. */
const MAX_DOC_LINES = 20_000
/** Lines Gemini is sent at once: past this a request is slow, costly and less reliable. */
const MAX_GEMINI_LINES = 1500

async function readQuizzes(args: { fileId: string; tabId?: string; refresh?: boolean; level?: number | null }) {
  if (!lastDoc || lastDoc.fileId !== args.fileId || args.refresh) {
    lastDoc = { fileId: args.fileId, doc: (await getGoogleDocStructure(args.fileId)) as DocsDocument }
  }
  const { doc } = lastDoc
  const tabs = listTabs(doc)
  // With no tab asked for, open the newest tab the app wrote: the fixed questions, not the original.
  const newest = args.tabId ? null : newestAppTab(tabs, (id) => docToLines(doc, id).slice(0, 5).filter((l) => l.heading).map((l) => l.text))
  const tabId = args.tabId && tabs.some((t) => t.id === args.tabId) ? args.tabId : newest?.id ?? tabs[0]?.id
  const lines = docToLines(doc, tabId)
  if (lines.length > MAX_DOC_LINES) {
    throw new Error(`This tab is too long for the app to read (${lines.length.toLocaleString()} lines). Split the questions into smaller Docs or tabs, then try again.`)
  }
  // The Doc's quizzes, each with its questions as they are now and what the automatic fixes would do.
  const content = withoutAppNotes(lines)
  const trial = reformatDocument(content, args.level)
  const several = trial.quizzes.length > 1
  const quizzes = trial.quizzes.map((q, i) => {
    const result = parseQuiz(q.source)
    return { index: i, title: q.title, lines: q.source, result, fixPreview: previewFixes(q.title, result, q.result, several) }
  })
  addGuessWarnings(lines, quizzes)
  return { doc, tabs, tabId: tabId ?? null, openedNewest: newest?.title ?? null, trial, quizzes, fingerprint: `${tabId}|${trial.split.level}|${fingerprintOf(quizzes)}` }
}

ipcMain.handle('quiz:readDoc', async (_e, args: { fileId: string; tabId?: string; refresh?: boolean; level?: number | null }) => {
  try {
    const { doc, tabs, tabId, openedNewest, trial, quizzes, fingerprint } = await readQuizzes(args)
    shownQuizzes.set(args.fileId, fingerprint)

    let manualEditAt: string | null = null
    const written = appWrites.get(args.fileId)
    if (written && doc.revisionId && doc.revisionId !== written) {
      manualEditAt = (await describeDriveFile(args.fileId).catch(() => null))?.modifiedTime ?? new Date().toISOString()
      appWrites.set(args.fileId, doc.revisionId) // tell the person once per edit, not on every read
    }
    return {
      ok: true as const,
      title: doc.title ?? '',
      tabs,
      tabId,
      openedNewest,
      level: trial.split.level,
      levels: trial.split.levels,
      quizzes,
      manualEditAt,
    }
  } catch (e) {
    return { ok: false as const, message: toUserMessage(e, 'The Google Doc could not be read.') }
  }
})

/**
 * What the automatic fixes would do to these questions, worked out without writing anything: how
 * many of the problems they would clear, how many would still need a person, and what they would
 * change. Shown in step 3 so the developer knows before choosing "Fix automatically".
 */
function previewFixes(title: string | null, current: ReturnType<typeof parseQuiz>, trial: DocumentFix['quizzes'][number]['result'], several: boolean) {
  const errorsNow = current.issues.filter((i) => i.severity === 'error').length
  const errorsAfter = trial.parsed.issues.filter((i) => i.severity === 'error').length
  return {
    problems: errorsNow,
    autoFixable: Math.max(0, errorsNow - errorsAfter),
    needsPerson: errorsNow === 0 ? 0 : errorsAfter,
    wouldChange: trial.changes.map((c) => c.message),
    needsPersonMessages: errorsNow === 0 ? [] : problemsOf(title, trial.parsed, several),
    anyChange: trial.lines.some((l) => l.changed),
    /** Questions the app would find after the automatic fixes: can be more than it reads now. */
    questionsAfterFix: Math.max(current.questions.length, trial.parsed.questions.length),
    /** Questions after the automatic fixes that still have no points: what the default would fill. */
    missingPoints: trial.parsed.questions.filter((q) => q.points === null && q.type !== 'text_only').length,
  }
}

const SCOPE_PROBLEM = /does not have permission to edit Google Docs/

/** A tab anywhere in the Doc (child tabs too), by id or by a test on its title. */
function findTab(doc: DocsDocument, test: (t: any) => boolean): any {
  const walk = (list: any[] | undefined): any => {
    for (const t of list ?? []) {
      if (test(t)) return t
      const inner = walk(t.childTabs)
      if (inner) return inner
    }
    return null
  }
  return walk((doc as any).tabs)
}

const isGeminiTab = (t: any) => (t?.tabProperties?.title ?? '').trim().toLowerCase() === GEMINI_TAB_TITLE.toLowerCase()

const REPLACE_GEMINI_MESSAGE =
  `The Doc already has a “${GEMINI_TAB_TITLE}” tab. Replacing it writes Gemini’s new version there, with a new time stamp. Anything changed by hand in that tab will be lost; the other tabs are not touched.`

/**
 * Write Gemini's version to the "Revised by Gemini" tab: replace the one there (the caller has
 * the person's go-ahead), or add it. A Doc the person cannot edit gets a new Doc instead.
 */
async function writeGeminiTab(
  fileId: string,
  doc: DocsDocument,
  lines: WrittenLine[],
  notes: HeaderNotes,
  when: Date,
): Promise<{ target: { fileId: string; name: string; tabId: string | null; tabTitle: string; inNewDoc: boolean; why?: string }; revisionId: string | null }> {
  const docTitle = doc.title ?? 'Quiz questions'
  // Read again right before writing: Gemini may have taken a minute or two, and someone may have
  // typed into the tab meanwhile. The revision guard makes Google refuse the write if they did.
  const current = (await getGoogleDocStructure(fileId)) as DocsDocument
  const existing = findTab(current, isGeminiTab)
  if (existing) {
    const id = existing.tabProperties.tabId as string
    const content: Array<{ endIndex?: number }> = existing.documentTab?.body?.content ?? []
    const clear = clearTabRequest(id, content[content.length - 1]?.endIndex ?? 1)
    const { revisionId } = await docsBatchUpdate(fileId, [...(clear ? [clear] : []), ...fillTabRequests(id, lines, notes, when, 'gemini')], current.revisionId)
    return { target: { fileId, name: docTitle, tabId: id, tabTitle: GEMINI_TAB_TITLE, inNewDoc: false }, revisionId }
  }
  let why = 'You can only view the original Doc, not edit it, so Gemini’s version is in a new Doc in your My Drive instead.'
  if (await canEditFile(fileId)) {
    try {
      const added = await docsBatchUpdate(fileId, [addTabRequest(GEMINI_TAB_TITLE)])
      const id: string | undefined = added.replies[0]?.addDocumentTab?.tabProperties?.tabId
      if (!id) throw new Error('Google added the tab but did not say which it was.')
      const { revisionId } = await docsBatchUpdate(fileId, fillTabRequests(id, lines, notes, when, 'gemini'))
      return { target: { fileId, name: docTitle, tabId: id, tabTitle: GEMINI_TAB_TITLE, inNewDoc: false }, revisionId }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (SCOPE_PROBLEM.test(message)) throw e
      why = `Google would not add a tab to the Doc, so Gemini’s version is in a new Doc in your My Drive instead. ${message.split(' Details for support:')[0]}`
    }
  }
  const name = `${docTitle} – ${GEMINI_TAB_TITLE}`
  const created = await createGoogleDoc(name)
  const { revisionId } = await docsBatchUpdate(created.fileId, fillTabRequests(undefined, lines, notes, when, 'gemini'))
  const fresh = (await getGoogleDocStructure(created.fileId)) as DocsDocument
  return { target: { fileId: created.fileId, name, tabId: listTabs(fresh)[0]?.id ?? null, tabTitle: name, inNewDoc: true, why }, revisionId }
}

/**
 * Reformat the questions in one tab and write them to a new "Reformatted questions" tab of the
 * same Doc, with a time stamp at the top and every changed line highlighted. The original tab is
 * not touched.
 *
 * When the person cannot edit the Doc (shared view-only), or Google will not add a tab, the
 * questions go into a new Doc in their My Drive instead, and the result says so and why.
 */
ipcMain.handle('quiz:reformat', async (_e, args: { fileId: string; tabId?: string; useAi?: boolean; replaceGemini?: boolean; level?: number | null; defaultPoints?: number | null }) => {
  try {
    const doc = (await getGoogleDocStructure(args.fileId)) as DocsDocument
    // Ask before Gemini is called, not after: a Gemini tab may hold someone's hand edits.
    if (args.useAi && findTab(doc, isGeminiTab) && !args.replaceGemini) {
      return { ok: false as const, needsConfirm: true as const, message: REPLACE_GEMINI_MESSAGE }
    }
    const tabs = listTabs(doc)
    const tabId = args.tabId && tabs.some((t) => t.id === args.tabId) ? args.tabId : tabs[0]?.id
    const content = withoutAppNotes(docToLines(doc, tabId))
    const options = { defaultPoints: typeof args.defaultPoints === 'number' ? args.defaultPoints : null }
    let fix: DocumentFix = reformatDocument(content, args.level, undefined, options)

    // Gemini is a last resort: only when asked for, and only for quizzes the rules left with
    // problems. Its answer for a quiz is used only if it passes every check in aiReformat.ts.
    let ai: { used: boolean; note: string } | null = null
    const errorsIn = (q: DocumentFix['quizzes'][number]) => q.result.parsed.issues.filter((i) => i.severity === 'error').length
    const stuck = fix.quizzes.map((q, i) => [q, i] as const).filter(([q]) => errorsIn(q) > 0)
    if (args.useAi && stuck.length > 0) {
      if (!getGeminiApiKey()) {
        ai = { used: false, note: 'No Gemini API key is saved, so only the app’s own fixes were used.' }
      } else {
        const overrides = new Map<number, RuleResult>()
        const refused: string[] = []
        for (const [q, i] of stuck) {
          if (q.source.length > MAX_GEMINI_LINES) {
            refused.push(`${q.title ?? 'The quiz'}: too long to send to Gemini in one go. Fix the remaining problems by hand in the Doc.`)
            continue
          }
          try {
            const answer = await askForLines(fallbackPrompt(q.source))
            const checked = checkFallback(q.source, q.result, answer.lines)
            if (checked.ok) overrides.set(i, checked.result)
            else refused.push(`${q.title ?? 'The quiz'}: ${checked.reason}`)
          } catch (e) {
            refused.push(`${q.title ?? 'The quiz'}: Gemini was not used. ${toUserMessage(e, 'Gemini did not answer').split(' Details for support:')[0]}`)
          }
        }
        if (overrides.size > 0) fix = reformatDocument(content, args.level, overrides, options)
        ai = {
          used: overrides.size > 0,
          note:
            (overrides.size > 0
              ? `Gemini laid out ${overrides.size} quiz${overrides.size === 1 ? '' : 'zes'} the app’s rules could not, and passed the app’s checks: no new wording, and correct answers only where the faculty member marked them.`
              : 'Gemini’s work was not used.') + (refused.length ? ` ${refused.join(' ')}` : ''),
        }
      }
    }

    const several = fix.quizzes.length > 1
    const problems = fix.quizzes.flatMap((q) => problemsOf(q.title, q.result.parsed, several))
    const check = fix.changes.filter((c) => c.kind !== 'format').map((c) => c.message)
    const questionCount = fix.quizzes.reduce((n, q) => n + q.result.parsed.questions.length, 0)
    const summary = { changes: fix.changes, problems, questionCount, quizCount: fix.quizzes.length, ai }
    const r = { lines: fix.lines }

    // Gemini's version, when there is one, is compared with the app's own fixes, not the original:
    // its tab highlights only what Gemini changed.
    const geminiUsed = !!ai?.used
    if (args.useAi && !geminiUsed) return { ok: true as const, nothingChanged: true as const, ...summary }
    if (!args.useAi && !r.lines.some((l) => l.changed)) return { ok: true as const, nothingChanged: true as const, ...summary }

    const when = new Date()
    const notes = { check, needsPerson: problems, order: fix.quizzes.map((q) => q.title) }
    const docTitle = doc.title ?? 'Quiz questions'
    let target: { fileId: string; name: string; tabId: string | null; tabTitle: string; inNewDoc: boolean; why?: string } | null = null
    let revisionId: string | null = null

    let why: string | undefined
    if (geminiUsed) {
      const rulesTexts = new Set(reformatDocument(content, args.level, undefined, options).lines.map((l) => l.text.trim()))
      const lines = fix.lines.map((l) => ({ ...l, changed: !l.heading && l.text.trim() !== '' && !rulesTexts.has(l.text.trim()) }))
      const written = await writeGeminiTab(args.fileId, doc, lines, notes, when)
      target = written.target
      revisionId = written.revisionId
    } else if (await canEditFile(args.fileId)) {
      try {
        const title = uniqueTabTitle(tabs.map((t) => t.title))
        const added = await docsBatchUpdate(args.fileId, [addTabRequest(title)])
        const newTabId: string | undefined = added.replies[0]?.addDocumentTab?.tabProperties?.tabId
        if (!newTabId) throw new Error('Google added the tab but did not say which it was.')
        revisionId = (await docsBatchUpdate(args.fileId, fillTabRequests(newTabId, r.lines, notes, when))).revisionId
        target = { fileId: args.fileId, name: docTitle, tabId: newTabId, tabTitle: title, inNewDoc: false }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (SCOPE_PROBLEM.test(message)) throw e
        why = `Google would not add a tab to the Doc, so the questions are in a new Doc in your My Drive instead. ${message.split(' Details for support:')[0]}`
      }
    } else {
      why = 'You can only view the original Doc, not edit it, so the questions are in a new Doc in your My Drive instead.'
    }

    if (!target) {
      const name = `${docTitle} – Reformatted questions`
      const created = await createGoogleDoc(name)
      revisionId = (await docsBatchUpdate(created.fileId, fillTabRequests(undefined, r.lines, notes, when))).revisionId
      const fresh = (await getGoogleDocStructure(created.fileId)) as DocsDocument
      target = { fileId: created.fileId, name, tabId: listTabs(fresh)[0]?.id ?? null, tabTitle: name, inNewDoc: true, why }
    }

    if (revisionId) appWrites.set(target.fileId, revisionId)
    lastDoc = null
    return {
      ok: true as const,
      nothingChanged: false as const,
      ...summary,
      target: { ...target, url: tabUrl(target.fileId, target.tabId), sourceTabId: tabId ?? null },
      stamp: stampFor(when),
    }
  } catch (e) {
    return { ok: false as const, message: toUserMessage(e, 'The questions could not be written to the Doc. The original was not changed') }
  }
})

/** A revision Gemini proposed, held here until a person accepts or discards it. */
let pendingRevision: { id: string; fileId: string; tabId: string; lines: FixedLine[]; check: string[]; problems: string[] } | null = null

/**
 * "Request changes": ask Gemini to revise the questions in a reformatted tab, and say what the
 * revision would change. Nothing is written until `quiz:applyRevision`.
 */
ipcMain.handle('quiz:proposeRevision', async (_e, args: { fileId: string; tabId: string; instruction: string }) => {
  try {
    if (!args.instruction?.trim()) return { ok: false as const, message: 'Type the change you would like in the box first, then choose Ask Gemini for this change.' }
    const doc = (await getGoogleDocStructure(args.fileId)) as DocsDocument
    const current = withoutAppNotes(docToLines(doc, args.tabId))
    if (current.length > MAX_GEMINI_LINES) {
      return { ok: false as const, message: `This tab is too long to send to Gemini in one go (${current.length.toLocaleString()} lines). Make the change by hand in the Doc, or move some quizzes to another tab first.` }
    }
    if (args.instruction.length > 2000) return { ok: false as const, message: 'That request is too long. Describe the change in a few sentences.' }
    const answer = await askForLines(revisionPrompt(markHeadings(current), args.instruction))
    const checked = checkRevision(current, answer.lines, answer.notes)
    if (!checked.ok) return { ok: false as const, message: checked.reason }
    const problems = checked.parsed.issues
      .filter((i) => i.severity === 'error')
      .map((i) => {
        const q = i.question !== null ? checked.parsed.questions[i.question] : null
        return `${q ? `Question ${q.number ?? i.question! + 1}: ` : ''}${i.message}`
      })
    pendingRevision = {
      id: randomUUID(),
      fileId: args.fileId,
      tabId: args.tabId,
      lines: checked.lines,
      check: checked.changes.filter((c) => c.kind !== 'format').map((c) => c.message),
      problems,
    }
    return { ok: true as const, proposalId: pendingRevision.id, changes: checked.changes, notes: checked.notes, problems }
  } catch (e) {
    return { ok: false as const, message: toUserMessage(e, 'Gemini’s change could not be prepared. Nothing was written to the Doc') }
  }
})

/**
 * Write an accepted revision to the "Revised by Gemini" tab, with a new time stamp at the top. A
 * revision of the Gemini tab replaces it; a revision of any other tab goes to the Gemini tab too,
 * never over the app's own fixes or the original, and replaces an existing Gemini tab only with
 * the person's go-ahead.
 */
ipcMain.handle('quiz:applyRevision', async (_e, args: { proposalId: string; replaceGemini?: boolean }) => {
  const p = pendingRevision
  if (!p || p.id !== args.proposalId) return { ok: false as const, message: 'That proposed change is no longer available, because the Doc was read again or another change was asked for. Describe the change again and choose Ask Gemini.' }
  try {
    const doc = (await getGoogleDocStructure(p.fileId)) as DocsDocument
    const existing = findTab(doc, isGeminiTab)
    const revisingGeminiTab = existing && existing.tabProperties?.tabId === p.tabId
    if (existing && !revisingGeminiTab && !args.replaceGemini) {
      return { ok: false as const, needsConfirm: true as const, message: REPLACE_GEMINI_MESSAGE }
    }
    const when = new Date()
    const { target, revisionId } = await writeGeminiTab(p.fileId, doc, p.lines, { check: p.check, needsPerson: p.problems }, when)
    if (revisionId) appWrites.set(target.fileId, revisionId)
    pendingRevision = null
    lastDoc = null
    return { ok: true as const, stamp: stampFor(when), url: tabUrl(target.fileId, target.tabId), fileId: target.fileId, name: target.name, tabId: target.tabId }
  } catch (e) {
    return { ok: false as const, message: toUserMessage(e, 'Gemini’s change could not be written to the Doc. You can choose Use this version again') }
  }
})

ipcMain.handle('quiz:discardRevision', () => {
  pendingRevision = null
})

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  setAllowedCanvasHost(savedOrigin())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
