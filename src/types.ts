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

export interface DocQuiz {
  index: number
  /** The heading above the quiz, or null for a Doc that is one quiz with no heading. */
  title: string | null
  lines: DocLine[]
  result: ParseResult
  /** A trial run of the automatic fixes, nothing written: what step 3 can promise. */
  fixPreview: FixPreview
}

export type ReadDocResult =
  | {
      ok: true
      title: string
      tabs: TabInfo[]
      tabId: string | null
      /** The heading level quizzes were split at, or null for a one-quiz Doc. */
      level: number | null
      /** Heading levels with questions under them, to offer as a choice. */
      levels: number[]
      quizzes: DocQuiz[]
      /** When someone last edited the Doc by hand after the app wrote to it, if they have. */
      manualEditAt: string | null
    }
  | { ok: false; message: string }

export interface FixPreview {
  /** Formatting problems now (errors that block Create). */
  problems: number
  /** How many of those the automatic fixes would clear. */
  autoFixable: number
  /** How many would be left for a person (or, last of all, Gemini). */
  needsPerson: number
  /** What the automatic fixes would change. */
  wouldChange: string[]
  needsPersonMessages: string[]
  /** The automatic fixes would change at least one line. */
  anyChange: boolean
  /** Questions the app would find after the automatic fixes: can be more than it reads now. */
  questionsAfterFix: number
}

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
  quizCount: number
  /** Whether Gemini was asked, and what came of it. Null when it was not needed or no key is saved. */
  ai: { used: boolean; note: string } | null
}

export type ProposeRevisionResult =
  | { ok: true; proposalId: string; changes: ReformatChange[]; notes: string; problems: string[] }
  | { ok: false; message: string }

export type ReformatResult =
  | (ReformatSummary & { ok: true; nothingChanged: true })
  | (ReformatSummary & {
      ok: true
      nothingChanged: false
      target: { fileId: string; name: string; tabId: string | null; tabTitle: string; inNewDoc: boolean; why?: string; url: string; sourceTabId: string | null }
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
        setGeminiKey(key: string | null): Promise<{ ok: true } | { ok: false; message: string }>
        geminiKeyStatus(): Promise<{ hasValue: boolean; hint: string }>
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
        createQuizzes(args: {
          courseIds: string[]
          quizzes: Array<{ key: string; title: string; description?: string; engine: QuizEngine; questions: Question[] }>
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
        readDoc(args: { fileId: string; tabId?: string; refresh?: boolean; level?: number | null }): Promise<ReadDocResult>
        reformat(args: { fileId: string; tabId?: string; useAi?: boolean; replaceTabId?: string; level?: number | null }): Promise<ReformatResult>
        proposeRevision(args: { fileId: string; tabId: string; instruction: string }): Promise<ProposeRevisionResult>
        applyRevision(args: { proposalId: string }): Promise<{ ok: true; stamp: string; url: string } | { ok: false; message: string }>
        discardRevision(): Promise<void>
      }
    }
  }
}
