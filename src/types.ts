/**
 * Types for the window, and the typed `window.api` bridge (mirrors electron/preload.ts).
 *
 * The quiz model itself is shared with the main process: it is pure types, imported from there.
 */
import type { CourseRunStatus, DocLine, ParseResult, ProgressEvent, Question, QuizEngine } from '../electron/ipc/quizModel'
import type { TabInfo } from '../electron/ipc/docLines'

export type { CourseRunStatus, DocLine, ParseResult, Question, QuizEngine, TabInfo, ProgressEvent }

export interface CourseChoice {
  id: string
  name: string
  code: string
  role: 'teacher' | 'ta' | 'designer'
  /** The role's name in Canvas, for the badge (a custom role such as "Course Administrator" is not "Teacher"). */
  roleLabel: string
  term: string
  termStart: string | null
  ended: boolean
  blueprint: boolean
}

export interface GoogleStatus {
  signedIn: boolean
  email?: string
  name?: string
  picture?: string
}

export type GoogleCheck = 'valid' | 'expired' | 'unknown' | 'none'
export type GoogleCheckState = GoogleCheck | 'checking'

export type ManualCheckResult =
  | { state: 'update-available'; current: string; latest: string }
  | { state: 'up-to-date'; current: string }
  | { state: 'check-failed'; current: string }

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  iconLink?: string
  isFolder: boolean
}

export type ReadDocResult =
  | {
      ok: true
      title: string
      tabs: TabInfo[]
      tabId: string | null
      lines: DocLine[]
      result: ParseResult
      /** When someone last edited the Doc by hand after the app wrote to it, if they have. */
      manualEditAt: string | null
    }
  | { ok: false; message: string }

export interface ReformatChange {
  kind: 'answer' | 'grading' | 'format'
  question: number | null
  message: string
}

interface ReformatSummary {
  changes: ReformatChange[]
  /** What the reformatter could not fix, already phrased for a person. */
  problems: string[]
  questionCount: number
}

export type ReformatResult =
  | (ReformatSummary & { ok: true; nothingChanged: true })
  | (ReformatSummary & {
      ok: true
      nothingChanged: false
      target: { fileId: string; name: string; tabId: string | null; tabTitle: string; inNewDoc: boolean; why?: string; url: string }
      stamp: string
    })
  | { ok: false; message: string }

export type CreateQuizResult = { ok: true; results: ProgressEvent[] } | { ok: false; message: string }

declare global {
  interface Window {
    api: {
      app: {
        platform: string
        version(): Promise<string>
        checkUpdate(): Promise<{ version: string } | null>
        checkUpdateNow(): Promise<ManualCheckResult>
        openReleases(): Promise<void>
        getZoom(): Promise<{ level: number; min: number; max: number }>
        stepZoom(delta: number): Promise<number>
        resetZoom(): Promise<number>
        onZoomChanged(callback: (level: number) => void): () => void
        copyText(text: string): Promise<boolean>
        getLastEngine(): Promise<QuizEngine | null>
        setLastEngine(engine: QuizEngine): Promise<void>
      }
      credentials: {
        setCanvasToken(token: string | null): Promise<void>
        canvasTokenStatus(): Promise<{ hasValue: boolean; hint: string }>
      }
      canvas: {
        getSite(): Promise<string | null>
        listCourses(args: { site: string }): Promise<
          { ok: true; site: string; courses: CourseChoice[] } | { ok: false; message: string }
        >
        verifyToken(): Promise<{ ok: boolean; name?: string; message?: string }>
        createQuiz(args: {
          courseIds: string[]
          engine: QuizEngine
          settings: { title: string; description: string }
          questions: Question[]
          jobId?: string
        }): Promise<CreateQuizResult>
        stopAfterCourse(jobId: string): Promise<void>
        onProgress(callback: (p: ProgressEvent) => void): () => void
      }
      google: {
        signIn(options?: { useAnotherAccount?: boolean }): Promise<GoogleStatus>
        cancelSignIn(): Promise<boolean>
        signOut(): Promise<void>
        status(): Promise<GoogleStatus>
        verify(): Promise<GoogleCheck>
        onSignedOut(callback: () => void): () => void
      }
      drive: {
        listFiles(args: {
          scope: 'recent' | 'myDrive' | 'sharedWithMe' | 'folder' | 'search'
          folderId?: string
          query?: string
          mimeTypes?: string[]
          foldersOnly?: boolean
          pageToken?: string
          pageSize?: number
        }): Promise<{ files: DriveFile[]; nextPageToken?: string }>
        resolveUrl(
          url: string,
        ): Promise<{ ok: true; fileId: string; name: string; mimeType: string } | { ok: false; message: string }>
      }
      quiz: {
        readDoc(args: { fileId: string; tabId?: string; refresh?: boolean }): Promise<ReadDocResult>
        reformat(args: { fileId: string; tabId?: string }): Promise<ReformatResult>
      }
    }
  }
}
