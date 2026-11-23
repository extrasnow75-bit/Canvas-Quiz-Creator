import React, { useCallback, useEffect, useRef, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { SetupPanel, type TokenCheck } from './components/SetupPanel'
import { QuizBuilder } from './components/QuizBuilder'
import { HelpCenter } from './components/HelpCenter'
import { UpdateBanner } from './components/UpdateBanner'
import { ZoomControl } from './components/ZoomControl'
import { cleanErrorMessage } from './components/ErrorText'
import { googleSignedIn } from './components/googleView'
import { DrivePickerProvider } from './contexts/DrivePickerContext'
import type { GoogleCheckState, GoogleStatus } from './types'

/** Read once: the platform cannot change while the app runs. */
const isMac = window.api?.app?.platform === 'darwin'

/**
 * The window, laid out as Canvas Extractor Tools is: a brand-blue title bar, a white strip with
 * the app-wide controls, Initial setup, and the work below it once setup is done.
 */
export default function App() {
  const [loading, setLoading] = useState(true)
  const [tokenHint, setTokenHint] = useState<string | null>(null)
  const [tokenCheck, setTokenCheck] = useState<TokenCheck>({ state: 'none' })
  const [site, setSite] = useState<string | null>(null)
  const [geminiHint, setGeminiHint] = useState<string | null>(null)

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({ signedIn: false })
  const [googleCheck, setGoogleCheck] = useState<GoogleCheckState>('none')
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const googleEpoch = useRef(0)

  const [setupOpenRequest, setSetupOpenRequest] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const closeHelp = useCallback(() => {
    setHelpOpen(false)
    helpButtonRef.current?.focus()
  }, [])

  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<{ version: string } | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.credentials.canvasTokenStatus().catch(() => ({ hasValue: false, hint: '' })),
      window.api.google.status().catch(() => ({ signedIn: false }) as GoogleStatus),
      window.api.canvas.getSite().catch(() => null),
    ])
      .then(([token, status, savedSite]) => {
        setTokenHint(token.hasValue ? token.hint : null)
        setSite(savedSite)
        setGoogleStatus(status)
        if (!status.signedIn) return
        // A stored sign-in may have died since the last launch; say so only once it is checked.
        setGoogleCheck('checking')
        const epoch = ++googleEpoch.current
        Promise.resolve()
          .then(() => window.api.google.verify())
          .catch(() => 'unknown' as const)
          .then((result) => {
            if (epoch === googleEpoch.current) setGoogleCheck(result)
          })
      })
      .finally(() => setLoading(false))

    window.api.credentials
      .geminiKeyStatus()
      .then((s) => setGeminiHint(s.hasValue ? s.hint : null))
      .catch(() => undefined)
    window.api.app.version().then(setAppVersion).catch(() => undefined)
    window.api.app.checkUpdate().then(setUpdate).catch(() => undefined)

    return window.api.google.onSignedOut(() => {
      googleEpoch.current++
      setGoogleCheck('expired')
      setGoogleStatus({ signedIn: false })
      setGoogleError('Your Google sign-in has expired. Open Initial setup and choose Sign in with Google.')
    })
  }, [])

  const saveToken = async (token: string) => {
    await window.api.credentials.setCanvasToken(token)
    const status = await window.api.credentials.canvasTokenStatus()
    setTokenHint(status.hasValue ? status.hint : null)
    if (!status.hasValue) return
    // Check it straight away when a site is known, so a typo shows up here rather than later.
    if (site) {
      setTokenCheck({ state: 'checking' })
      const r: { ok: boolean; name?: string; message?: string } = await window.api.canvas
        .verifyToken()
        .catch((e: unknown) => ({ ok: false, message: String(e) }))
      setTokenCheck(r.ok ? { state: 'valid', name: r.name } : { state: 'invalid', message: r.message ?? 'Canvas did not accept the token.' })
    } else {
      setTokenCheck({ state: 'none' })
    }
  }

  const removeToken = async () => {
    await window.api.credentials.setCanvasToken(null)
    setTokenHint(null)
    setTokenCheck({ state: 'none' })
  }

  const googleSignIn = async (useAnotherAccount = false) => {
    setGoogleBusy(true)
    setGoogleError(null)
    try {
      const status = await window.api.google.signIn({ useAnotherAccount })
      googleEpoch.current++
      setGoogleStatus(status)
      setGoogleCheck('valid')
    } catch (err) {
      const message = err instanceof Error ? cleanErrorMessage(err.message) : 'Google sign-in failed.'
      if (!/^Google sign-in was cancelled\.$/.test(message)) setGoogleError(message)
    } finally {
      setGoogleBusy(false)
    }
  }

  const googleSignOut = async () => {
    await window.api.google.signOut()
    googleEpoch.current++
    setGoogleStatus({ signedIn: false })
    setGoogleCheck('none')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <p className="text-gray-600 text-sm" role="status">
          Loading…
        </p>
      </div>
    )
  }

  const ready = tokenHint !== null && (googleSignedIn(googleCheck) || googleCheck === 'checking')

  return (
    <DrivePickerProvider>
      <div className="flex flex-col h-screen bg-slate-50 font-sans text-gray-900">
        <div id="app-shell" className="flex flex-col flex-1 min-h-0">
          <header
            className={`flex items-center justify-between pr-4 bg-brand text-white flex-shrink-0 ${isMac ? 'pl-20' : 'pl-4'}`}
            style={{ height: 36, WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <h1 className="text-sm font-black tracking-wide m-0">Canvas Quiz Creator</h1>
          </header>

          <nav
            aria-label="App controls"
            className="flex items-center justify-between gap-4 px-4 min-h-11 py-1.5 bg-white border-b border-gray-200 flex-shrink-0"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <span className="text-xs text-gray-600">Turn quiz questions in a Google Doc into Canvas quizzes</span>
            <div className="flex items-center gap-3 flex-shrink-0">
              <ZoomControl />
              <button
                ref={helpButtonRef}
                onClick={() => setHelpOpen(true)}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-600 border border-gray-500 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" /> Help Center &amp; More
              </button>
            </div>
          </nav>

          {update && !updateDismissed && (
            <UpdateBanner version={update.version} currentVersion={appVersion} onDismiss={() => setUpdateDismissed(true)} />
          )}

          <main className="flex-1 overflow-auto relative">
            <div className="max-w-[760px] mx-auto py-4 px-6 space-y-3.5">
              <SetupPanel
                tokenHint={tokenHint}
                tokenCheck={tokenCheck}
                onSaveToken={saveToken}
                onRemoveToken={removeToken}
                googleStatus={googleStatus}
                googleCheck={googleCheck}
                googleBusy={googleBusy}
                googleError={googleError}
                onGoogleSignIn={(another) => void googleSignIn(another)}
                onGoogleCancel={() => void window.api.google.cancelSignIn().catch(() => undefined)}
                onGoogleSignOut={() => void googleSignOut()}
                openRequest={setupOpenRequest}
                geminiHint={geminiHint}
                onSaveGeminiKey={async (key) => {
                  const r = await window.api.credentials.setGeminiKey(key)
                  if (!r.ok) return r.message
                  const s = await window.api.credentials.geminiKeyStatus()
                  setGeminiHint(s.hasValue ? s.hint : null)
                  return null
                }}
                onRemoveGeminiKey={async () => {
                  await window.api.credentials.setGeminiKey(null)
                  setGeminiHint(null)
                }}
              />

              {ready ? (
                <QuizBuilder
                  hasGemini={geminiHint !== null}
                  site={site}
                  onSiteChange={setSite}
                  onTokenResult={(r) =>
                    setTokenCheck(r.ok ? (c) => (c.state === 'valid' ? c : { state: 'valid' }) : { state: 'invalid', message: r.message })
                  }
                />
              ) : (
                <p className="text-[13px] text-gray-700 text-center py-6 m-0">
                  Finish{' '}
                  <button
                    onClick={() => setSetupOpenRequest((n) => n + 1)}
                    className="font-bold italic text-gray-900 underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    Initial setup
                  </button>{' '}
                  to start making quizzes.
                </p>
              )}
            </div>
          </main>
        </div>

        <HelpCenter isOpen={helpOpen} onClose={closeHelp} returnFocusTo={helpButtonRef} appVersion={appVersion} />
      </div>
    </DrivePickerProvider>
  )
}
