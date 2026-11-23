import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { isAllowedExternalUrl, setAllowedCanvasHost } from './ipc/externalLinks'
import { readSettings, updateSettings } from './ipc/settings'
import { setCanvasToken, canvasTokenStatus, type CredentialStatus } from './ipc/credentials'
import { createQuizInCourses, listCourses, savedOrigin, verifyToken } from './ipc/canvas'
import { normalizeSite } from './ipc/courseList'
import { signIn, cancelSignIn, getStatus, clearTokens, verifySignIn } from './ipc/googleAuth'
import { withJob, cancelJob } from './ipc/jobs'
import {
  listFiles,
  getFileMetadata,
  getGoogleDocStructure,
  extractFileIdFromUrl,
  type ListFilesArgs,
} from './ipc/googleDrive'
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
 * Read a Google Doc's questions: the document's tabs, and the questions in one of them (the
 * first, or `tabId`). `refresh` fetches it again, after the developer has fixed something.
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
    return { ok: true as const, title: doc.title ?? '', tabs, tabId: tabId ?? null, lines, result: parseQuiz(lines) }
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
  }
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
