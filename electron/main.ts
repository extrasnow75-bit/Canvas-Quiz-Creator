import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { isAllowedExternalUrl, setAllowedCanvasHost } from './ipc/externalLinks'
import { readSettings, updateSettings } from './ipc/settings'
import { setCanvasToken, canvasTokenStatus, setGeminiApiKey, geminiKeyStatus, getGeminiApiKey, type CredentialStatus } from './ipc/credentials'
import { askForLines, validateGeminiKey } from './ipc/gemini'
import { checkFallback, checkRevision, fallbackPrompt, revisionPrompt } from './ipc/aiReformat'
import { createQuizInCourses, listCourses, savedOrigin, verifyToken } from './ipc/canvas'
import { normalizeSite } from './ipc/courseList'
import { signIn, cancelSignIn, getStatus, clearTokens, verifySignIn } from './ipc/googleAuth'
import { withJob, cancelJob } from './ipc/jobs'
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
import { reformatQuiz } from './ipc/reformat'
import { addTabRequest, clearTabRequest, fillTabRequests, isAppHeaderLine, stampFor, tabUrl, uniqueTabTitle } from './ipc/docsWrite'
import type { FixedLine, ReformatResult as RuleResult } from './ipc/reformat'
import { docToLines, listTabs, type DocsDocument } from './ipc/docLines'
import { parseQuiz } from './ipc/quizFormat'
import type { Question, QuizEngine } from './ipc/quizModel'
import type { QuizSettings } from './ipc/quizPayloads'
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
  if (host !== currentHost && !approvedHosts.has(host)) {
    if (!(await confirmCanvasHost(windowFor(e), host))) {
      return { ok: false as const, message: 'Cancelled. No courses were loaded.' }
    }
  }
  if (origin !== current) {
    updateSettings({ canvasSite: origin })
    setAllowedCanvasHost(origin)
  }
  return listCourses(origin)
})

ipcMain.handle('canvas:verifyToken', () => verifyToken())

/**
 * Create the quiz in each chosen course. Progress goes back on 'quiz:progress' as each question
 * lands, so the window can show it; `jobId` lets the window stop the run between requests.
 */
ipcMain.handle(
  'canvas:createQuiz',
  (
    e,
    args: { courseIds: string[]; engine: QuizEngine; settings: QuizSettings; questions: Question[]; jobId?: string },
  ) => {
    if (!Array.isArray(args?.courseIds) || args.courseIds.length === 0) {
      return { ok: false as const, message: 'Choose at least one course.' }
    }
    if (args.engine !== 'classic' && args.engine !== 'new') {
      return { ok: false as const, message: 'Choose Classic Quizzes or New Quizzes.' }
    }
    updateSettings({ lastEngine: args.engine })
    if (args.jobId) stopRequested.delete(args.jobId)
    return withJob(args.jobId, (signal) =>
      createQuizInCourses({
        courseIds: args.courseIds.map(String),
        engine: args.engine,
        settings: { title: String(args.settings?.title ?? ''), description: String(args.settings?.description ?? '') },
        questions: args.questions,
        signal,
        shouldStop: () => !!args.jobId && stopRequested.has(args.jobId),
        newId: randomUUID,
        onProgress: (p) => {
          if (!e.sender.isDestroyed()) e.sender.send('quiz:progress', p)
        },
      }),
    )
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
ipcMain.handle('quiz:readDoc', async (_e, args: { fileId: string; tabId?: string; refresh?: boolean }) => {
  try {
    if (!lastDoc || lastDoc.fileId !== args.fileId || args.refresh) {
      lastDoc = { fileId: args.fileId, doc: (await getGoogleDocStructure(args.fileId)) as DocsDocument }
    }
    const { doc } = lastDoc
    const tabs = listTabs(doc)
    const tabId = args.tabId && tabs.some((t) => t.id === args.tabId) ? args.tabId : tabs[0]?.id
    const lines = docToLines(doc, tabId)

    let manualEditAt: string | null = null
    const written = appWrites.get(args.fileId)
    if (written && doc.revisionId && doc.revisionId !== written) {
      manualEditAt = (await describeDriveFile(args.fileId).catch(() => null))?.modifiedTime ?? new Date().toISOString()
      appWrites.set(args.fileId, doc.revisionId) // tell the person once per edit, not on every read
    }

    return { ok: true as const, title: doc.title ?? '', tabs, tabId: tabId ?? null, lines, result: parseQuiz(lines), manualEditAt }
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
  }
})

const SCOPE_PROBLEM = /does not have permission to edit Google Docs/

/**
 * Reformat the questions in one tab and write them to a new "Reformatted questions" tab of the
 * same Doc, with a time stamp at the top and every changed line highlighted. The original tab is
 * not touched.
 *
 * When the person cannot edit the Doc (shared view-only), or Google will not add a tab, the
 * questions go into a new Doc in their My Drive instead, and the result says so and why.
 */
ipcMain.handle('quiz:reformat', async (_e, args: { fileId: string; tabId?: string }) => {
  try {
    const doc = (await getGoogleDocStructure(args.fileId)) as DocsDocument
    const tabs = listTabs(doc)
    const tabId = args.tabId && tabs.some((t) => t.id === args.tabId) ? args.tabId : tabs[0]?.id
    const source = docToLines(doc, tabId).filter((l) => !isAppHeaderLine(l.text, l.heading))
    let r: RuleResult = reformatQuiz(source)

    // Problems the rules could not fix go to Gemini, when a key is saved. Its answer only replaces
    // the rules' answer if it passes every check in aiReformat.ts.
    let ai: { used: boolean; note: string } | null = null
    const ruleErrors = r.parsed.issues.filter((i) => i.severity === 'error').length
    if (ruleErrors > 0 && getGeminiApiKey()) {
      try {
        const answer = await askForLines(fallbackPrompt(source))
        const checked = checkFallback(source, r, answer.lines)
        if (checked.ok) {
          r = checked.result
          ai = { used: true, note: 'Gemini laid out what the app’s rules could not. Its work passed the app’s checks: no new wording, and correct answers only where the faculty member marked them.' }
        } else {
          ai = { used: false, note: checked.reason }
        }
      } catch (e) {
        ai = { used: false, note: `Gemini was not used: ${e instanceof Error ? e.message : String(e)}` }
      }
    }

    const problems = r.parsed.issues
      .filter((i) => i.severity === 'error')
      .map((i) => {
        const q = i.question !== null ? r.parsed.questions[i.question] : null
        return `${q ? `Question ${q.number ?? i.question! + 1}: ` : ''}${i.message}`
      })
    const check = r.changes.filter((c) => c.kind !== 'format').map((c) => c.message)
    const summary = { changes: r.changes, problems, questionCount: r.parsed.questions.length, ai }

    if (!r.lines.some((l) => l.changed)) return { ok: true as const, nothingChanged: true as const, ...summary }

    const when = new Date()
    const notes = { check, needsPerson: problems }
    const docTitle = doc.title ?? 'Quiz questions'
    let target: { fileId: string; name: string; tabId: string | null; tabTitle: string; inNewDoc: boolean; why?: string } | null = null
    let revisionId: string | null = null

    let why: string | undefined
    if (await canEditFile(args.fileId)) {
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
        why = `Google would not add a tab to the Doc (${message}), so the questions are in a new Doc instead.`
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
    return { ok: true as const, nothingChanged: false as const, ...summary, target: { ...target, url: tabUrl(target.fileId, target.tabId) }, stamp: stampFor(when) }
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
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
    if (!args.instruction?.trim()) return { ok: false as const, message: 'Say what you would like changed.' }
    const doc = (await getGoogleDocStructure(args.fileId)) as DocsDocument
    const current = docToLines(doc, args.tabId).filter((l) => !isAppHeaderLine(l.text, l.heading))
    const answer = await askForLines(revisionPrompt(current.map((l) => l.text), args.instruction))
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
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
  }
})

/** Write an accepted revision over the reformatted tab, with a new time stamp at the top. */
ipcMain.handle('quiz:applyRevision', async (_e, args: { proposalId: string }) => {
  const p = pendingRevision
  if (!p || p.id !== args.proposalId) return { ok: false as const, message: 'That revision is no longer available. Ask for it again.' }
  try {
    const doc = (await getGoogleDocStructure(p.fileId)) as DocsDocument & { tabs?: Array<any> }
    const find = (tabs: any[] | undefined): any => {
      for (const t of tabs ?? []) {
        if (t.tabProperties?.tabId === p.tabId) return t
        const inner = find(t.childTabs)
        if (inner) return inner
      }
      return null
    }
    const tab = find(doc.tabs)
    const content: Array<{ endIndex?: number }> = tab?.documentTab?.body?.content ?? []
    const end = content[content.length - 1]?.endIndex ?? 1
    const when = new Date()
    const clear = clearTabRequest(p.tabId, end)
    const requests = [...(clear ? [clear] : []), ...fillTabRequests(p.tabId, p.lines, { check: p.check, needsPerson: p.problems }, when)]
    const { revisionId } = await docsBatchUpdate(p.fileId, requests)
    if (revisionId) appWrites.set(p.fileId, revisionId)
    pendingRevision = null
    lastDoc = null
    return { ok: true as const, stamp: stampFor(when), url: tabUrl(p.fileId, p.tabId) }
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
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
