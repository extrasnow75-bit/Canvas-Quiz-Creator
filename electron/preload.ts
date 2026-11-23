/**
 * The whole of what the window can ask the main process to do.
 *
 * Every entry is one named request. None of them returns a credential: the Canvas token goes in
 * through `credentials.setCanvasToken` and only its status comes back, and the Google token never
 * leaves the main process at all. Types for the window are in src/types.ts.
 */
import { contextBridge, ipcRenderer } from 'electron'

/**
 * `ipcRenderer.invoke` with Electron's error framing removed, so a message thrown in the main
 * process reaches the screen as the sentence it was written as, not as
 * "Error invoking remote method 'drive:listFiles': Error: …".
 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((err: unknown) => {
    let message = (err instanceof Error ? err.message : String(err)).trim()
    message = message.replace(/^Error invoking remote method '[^']*':\s*/, '')
    let previous: string
    do {
      previous = message
      message = message.replace(/^(?:[A-Z][A-Za-z]*)?Error:\s*/, '')
    } while (message !== previous)
    throw new Error(message || 'Something went wrong.')
  }) as Promise<T>
}

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_e: unknown, value: T) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('api', {
  app: {
    platform: process.platform,
    version: () => invoke('app:version'),
    checkUpdate: () => invoke('app:checkUpdate'),
    checkUpdateNow: () => invoke('app:checkUpdateNow'),
    openReleases: () => invoke('app:openReleases'),
    getZoom: () => invoke('app:getZoom'),
    stepZoom: (delta: number) => invoke('app:stepZoom', delta),
    resetZoom: () => invoke('app:resetZoom'),
    onZoomChanged: (cb: (level: number) => void) => subscribe('app:zoomChanged', cb),
    copyText: (text: string) => invoke('clipboard:writeText', text),
    getLastEngine: () => invoke('settings:getLastEngine'),
    setLastEngine: (engine: string) => invoke('settings:setLastEngine', engine),
  },
  credentials: {
    setCanvasToken: (token: string | null) => invoke('credentials:setCanvasToken', token),
    canvasTokenStatus: () => invoke('credentials:canvasTokenStatus'),
    setGeminiKey: (key: string | null) => invoke('credentials:setGeminiKey', key),
    geminiKeyStatus: () => invoke('credentials:geminiKeyStatus'),
  },
  canvas: {
    getSite: () => invoke('canvas:getSite'),
    listCourses: (args: { site: string }) => invoke('canvas:listCourses', args),
    verifyToken: () => invoke('canvas:verifyToken'),
    createQuizzes: (args: unknown) => invoke('canvas:createQuizzes', args),
    stopAfterCourse: (jobId: string) => invoke('canvas:stopAfterCourse', jobId),
    currentRun: () => invoke('canvas:currentRun'),
    onProgress: (cb: (p: unknown) => void) => subscribe('quiz:progress', cb),
  },
  google: {
    signIn: (options?: { useAnotherAccount?: boolean }) => invoke('google:signIn', options),
    cancelSignIn: () => invoke('google:cancelSignIn'),
    signOut: () => invoke('google:signOut'),
    status: () => invoke('google:status'),
    verify: () => invoke('google:verify'),
    onSignedOut: (cb: () => void) => subscribe('google:signedOut', cb),
  },
  drive: {
    listFiles: (args: unknown) => invoke('drive:listFiles', args),
    resolveUrl: (url: string) => invoke('drive:resolveUrl', url),
  },
  quiz: {
    readDoc: (args: { fileId: string; tabId?: string; refresh?: boolean; level?: number | null }) => invoke('quiz:readDoc', args),
    reformat: (args: { fileId: string; tabId?: string; useAi?: boolean; replaceGemini?: boolean; level?: number | null; defaultPoints?: number | null }) => invoke('quiz:reformat', args),
    proposeRevision: (args: { fileId: string; tabId: string; instruction: string }) => invoke('quiz:proposeRevision', args),
    applyRevision: (args: { proposalId: string; replaceGemini?: boolean }) => invoke('quiz:applyRevision', args),
    discardRevision: () => invoke('quiz:discardRevision'),
  },
})
