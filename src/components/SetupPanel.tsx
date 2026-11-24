import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Eye, EyeOff, KeyRound, Loader2, LogOut, SlidersHorizontal, AlertCircle, Sparkles } from 'lucide-react'
import type { GoogleCheckState, GoogleStatus } from '../types'
import { googleLine, googleSignedIn } from './googleView'
import { ErrorText } from './ErrorText'

export type TokenCheck =
  | { state: 'none' }
  | { state: 'checking' }
  | { state: 'valid'; name?: string }
  | { state: 'invalid'; message: string }

interface Props {
  tokenHint: string | null
  tokenCheck: TokenCheck
  onSaveToken(token: string): Promise<void>
  onRemoveToken(): Promise<void>
  googleStatus: GoogleStatus
  googleCheck: GoogleCheckState
  googleBusy: boolean
  googleError: string | null
  onGoogleSignIn(useAnotherAccount?: boolean): void
  onGoogleCancel(): void
  onGoogleSignOut(): void
  /** Incremented to ask the panel to open and take focus. */
  openRequest: number
  /** Last four characters of the saved Gemini key, or null. Optional: the app works without it. */
  geminiHint: string | null
  /** Resolves with an error sentence when Gemini refuses the key, or null when it was saved. */
  onSaveGeminiKey(key: string): Promise<string | null>
  onRemoveGeminiKey(): Promise<void>
  /** Quizzes are being created: signing out or removing the token now would cut the run off. */
  runBusy?: boolean
}

const RUN_BUSY_NOTE = 'Quizzes are being created. Wait until the run finishes, then try again.'

/** Shown under a button that cannot be used while a run is going. */
function BusyNote({ id }: { id: string }) {
  return (
    <p id={id} className="mt-1.5 mb-0 text-xs text-gray-700">
      {RUN_BUSY_NOTE}
    </p>
  )
}

/**
 * Initial setup: the Google sign-in and the Canvas token, in the Canvas Extractor Tools layout.
 *
 * Google is required here, unlike the extractor: the questions come from a Google Doc. The panel
 * opens itself until both are set up, and collapses to its header once they are.
 */
export function SetupPanel(p: Props) {
  const tokenPresent = p.tokenHint !== null
  const googleOk = googleSignedIn(p.googleCheck)
  const complete = tokenPresent && googleOk
  const [isOpen, setIsOpen] = useState(!complete)
  const [tokenInput, setTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const headerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  // Open again whenever something goes missing, e.g. the Google sign-in expires.
  useEffect(() => {
    if (!complete) setIsOpen(true)
  }, [complete])

  useEffect(() => {
    if (p.openRequest > 0) {
      setIsOpen(true)
      headerRef.current?.focus()
    }
  }, [p.openRequest])

  const g = googleLine(p.googleCheck, p.googleStatus.email ?? p.googleStatus.name)
  const tokenBad = p.tokenCheck.state === 'invalid'

  const statusText = complete ? 'Ready' : 'Setup needed'
  const dot = (ok: boolean, warn = false) =>
    `w-2 h-2 rounded-full ${ok ? 'bg-green-400' : warn ? 'bg-amber-300' : 'bg-white/50'}`

  const save = async () => {
    if (!tokenInput.trim()) return
    setSaving(true)
    try {
      await p.onSaveToken(tokenInput)
      setTokenInput('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm">
      <h2 className="m-0">
        <button
          ref={headerRef}
          onClick={() => setIsOpen((o) => !o)}
          aria-expanded={isOpen}
          aria-controls={`${id}-body`}
          className="w-full bg-brand hover:bg-brand-dark text-white px-4 py-3.5 flex items-center gap-3 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
        >
          <SlidersHorizontal className="w-[18px] h-[18px] flex-shrink-0" aria-hidden="true" />
          <span className="font-black text-[15px]">Initial setup</span>
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className={dot(googleOk, p.googleCheck === 'expired')} aria-hidden="true" />
              <span className="text-[11px] font-bold">Google</span>
              <span className="sr-only">{googleOk ? 'signed in' : 'not signed in'}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={dot(tokenPresent && !tokenBad, tokenBad)} aria-hidden="true" />
              <span className="text-[11px] font-bold">Canvas</span>
              <span className="sr-only">{tokenPresent ? 'token saved' : 'no token'}</span>
            </span>
            <span className="text-[11px] font-bold">{statusText}</span>
            <ChevronDown className={`w-[18px] h-[18px] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </span>
        </button>
      </h2>

      <div id={`${id}-body`} hidden={!isOpen} className="bg-white border border-gray-200 border-t-0 rounded-b-2xl p-3.5 space-y-3">
        {/* Google */}
        <section
          aria-labelledby={`${id}-google`}
          className={`rounded-2xl border-2 p-4 ${
            p.googleCheck === 'valid'
              ? 'border-green-200 shadow-[0_0_0_3px_rgba(240,253,244,1)]'
              : p.googleCheck === 'expired'
                ? 'border-amber-300'
                : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
            </svg>
            <span id={`${id}-google`} className="font-black text-[15px]">
              Google sign-in <span className="text-red-700" aria-hidden="true">*</span>
              <span className="sr-only">(required)</span>
            </span>
          </div>
          <p className={`text-[13px] mb-2.5 ${p.googleCheck === 'valid' ? 'text-green-800' : p.googleCheck === 'expired' ? 'text-amber-900' : 'text-gray-600'}`}>
            {g.text}
          </p>

          {p.googleBusy ? (
            <div className="flex items-center justify-between gap-3">
              <p role="status" className="flex items-center gap-2 text-[13px] text-gray-700">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Finish signing in in your browser…
              </p>
              <button
                onClick={p.onGoogleCancel}
                className="py-1.5 px-3 rounded-lg border border-gray-500 bg-white text-[12.5px] font-bold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Cancel
              </button>
            </div>
          ) : googleOk ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center font-black text-xs flex-shrink-0" aria-hidden="true">
                {(p.googleStatus.name ?? p.googleStatus.email ?? '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm truncate">{p.googleStatus.name ?? p.googleStatus.email}</p>
                {p.googleStatus.email && <p className="text-xs text-gray-600 truncate">{p.googleStatus.email}</p>}
              </div>
              <button
                onClick={() => !p.runBusy && p.onGoogleSignOut()}
                aria-disabled={p.runBusy || undefined}
                aria-describedby={p.runBusy ? 'setup-busy-google' : undefined}
                className="aria-disabled:opacity-60 aria-disabled:cursor-not-allowed text-xs font-bold text-gray-700 border border-gray-500 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => p.onGoogleSignIn(false)}
              className="w-full flex items-center justify-center gap-2 border-2 border-brand text-brand rounded-xl py-2.5 font-black text-sm hover:bg-blue-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Sign in with Google
            </button>
          )}
          {googleOk && !p.googleBusy && p.runBusy && <BusyNote id="setup-busy-google" />}
          {p.googleError && (
            <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12.5px] text-red-800">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span role="alert">
                <ErrorText message={p.googleError} />
              </span>
            </p>
          )}
        </section>

        {/* Canvas token */}
        <section
          aria-labelledby={`${id}-canvas`}
          className={`rounded-2xl border-2 p-4 ${
            tokenBad
              ? 'border-amber-300 shadow-[0_0_0_3px_rgba(255,251,235,1)]'
              : tokenPresent
                ? 'border-green-200 shadow-[0_0_0_3px_rgba(240,253,244,1)]'
                : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <KeyRound className="w-4 h-4 text-red-600 flex-shrink-0" aria-hidden="true" />
            <span id={`${id}-canvas`} className="font-black text-[15px]">
              Canvas API token <span className="text-red-700" aria-hidden="true">*</span>
              <span className="sr-only">(required)</span>
            </span>
          </div>

          {tokenPresent ? (
            <>
              <p className="text-[13px] mb-1 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${tokenBad ? 'bg-amber-600' : 'bg-green-600'}`} aria-hidden="true" />
                <span className={`font-bold ${tokenBad ? 'text-amber-900' : 'text-green-800'}`}>
                  {p.tokenCheck.state === 'checking'
                    ? 'Checking your token…'
                    : p.tokenCheck.state === 'valid'
                      ? `Token works${p.tokenCheck.name ? ` for ${p.tokenCheck.name}` : ''}.`
                      : tokenBad
                        ? 'Canvas did not accept this token.'
                        : 'Token saved. It is checked when you load your courses.'}
                </span>
              </p>
              {p.tokenCheck.state === 'invalid' && (
                <p className="text-xs text-amber-900 mb-2">
                  <ErrorText message={p.tokenCheck.message} />
                </p>
              )}
              <p className="text-xs font-mono text-gray-600 mb-3 break-all">
                <span className="sr-only">Saved token, partially hidden: </span>
                {'•'.repeat(12)}
                {p.tokenHint}
              </p>
              <button
                onClick={() => !p.runBusy && void p.onRemoveToken()}
                aria-disabled={p.runBusy || undefined}
                aria-describedby={p.runBusy ? 'setup-busy-token' : undefined}
                className="aria-disabled:opacity-60 aria-disabled:cursor-not-allowed w-full text-sm font-bold text-gray-700 border border-gray-500 rounded-lg py-2 hover:bg-gray-50 transition flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" /> Remove token
              </button>
              {p.runBusy && <BusyNote id="setup-busy-token" />}
            </>
          ) : (
            <>
              <p className="text-[13px] text-gray-600 mb-2.5">
                In Canvas, go to <span className="font-bold text-gray-800">Account → Settings → New Access Token</span>, give it
                a purpose like “Quiz Creator” and an expiry date, then paste it here. It is kept in your computer’s keychain and
                only ever sent to your Canvas site.
              </p>
              <div className="relative mb-2.5">
                <label htmlFor={`${id}-token`} className="sr-only">
                  Canvas API token
                </label>
                <input
                  id={`${id}-token`}
                  type={showToken ? 'text' : 'password'}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void save()}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your token"
                  className="w-full border-2 border-gray-500 rounded-xl px-3.5 py-2.5 pr-10 text-sm font-mono focus:outline-none focus:border-brand focus:ring-2 focus:ring-blue-200 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  aria-label={showToken ? 'Hide token' : 'Show token'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {showToken ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                </button>
              </div>
              <button
                onClick={() => void save()}
                disabled={!tokenInput.trim() || saving}
                className="w-full rounded-xl py-2.5 font-black text-sm transition bg-brand hover:bg-brand-dark text-white disabled:bg-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                {saving ? 'Saving…' : 'Save token'}
              </button>
            </>
          )}
        </section>

        <GeminiCard hint={p.geminiHint} onSave={p.onSaveGeminiKey} onRemove={p.onRemoveGeminiKey} />
      </div>
    </div>
  )
}

/** Optional: lets the reformatter use Gemini for what its rules cannot fix, and enables Request changes. */
function GeminiCard({ hint, onSave, onRemove }: { hint: string | null; onSave(key: string): Promise<string | null>; onRemove(): Promise<void> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const save = async () => {
    if (!value.trim()) return
    setBusy(true)
    setError(null)
    try {
      const problem = await onSave(value)
      if (problem) setError(problem)
      else setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={`${id}-h`} className={`rounded-2xl border-2 p-4 ${hint ? 'border-green-200 shadow-[0_0_0_3px_rgba(240,253,244,1)]' : 'border-gray-200'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-[#6b4fa3] flex-shrink-0" aria-hidden="true" />
        <span id={`${id}-h`} className="font-black text-[15px]">
          Gemini API key <span className="font-normal text-[13px] text-gray-600">(optional)</span>
        </span>
      </div>
      <p className="text-[13px] text-gray-600 mb-2.5">
        Lets the app ask Gemini to lay out questions its own rules cannot fix, and to make changes you describe in plain English. Gemini
        never decides which answer is correct, and a person checks everything before it goes to Canvas. Get a key at{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-bold text-brand underline underline-offset-2">
          aistudio.google.com
        </a>
        .
      </p>
      {hint ? (
        <>
          <p className="text-xs font-mono text-gray-600 mb-3 break-all">
            <span className="sr-only">Saved key, partially hidden: </span>
            {'•'.repeat(12)}
            {hint}
          </p>
          <button
            onClick={() => void onRemove()}
            className="w-full text-sm font-bold text-gray-700 border border-gray-500 rounded-lg py-2 hover:bg-gray-50 transition flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" /> Remove key
          </button>
        </>
      ) : (
        <div className="flex gap-2">
          <label htmlFor={`${id}-key`} className="sr-only">
            Gemini API key
          </label>
          <input
            id={`${id}-key`}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your Gemini API key"
            className="flex-1 min-w-0 border-2 border-gray-500 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-brand focus:ring-2 focus:ring-blue-200 transition"
          />
          <button
            onClick={() => void save()}
            disabled={!value.trim() || busy}
            className="flex-shrink-0 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-black text-sm disabled:bg-gray-200 disabled:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {busy ? 'Checking…' : 'Save key'}
          </button>
        </div>
      )}
      {error && (
        <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12.5px] text-red-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span role="alert">
            <ErrorText message={error} />
          </span>
        </p>
      )}
    </section>
  )
}
