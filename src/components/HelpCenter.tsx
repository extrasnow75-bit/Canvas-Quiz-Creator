import { useState, type ReactNode, type RefObject } from 'react'
import { ChevronRight, ExternalLink, RefreshCw, X } from 'lucide-react'
import type { ManualCheckResult } from '../types'
import { useDialogFocus } from '../hooks/useDialogFocus'

interface Props {
  isOpen: boolean
  onClose(): void
  returnFocusTo: RefObject<HTMLButtonElement | null>
  appVersion: string
}

const FORMAT_EXAMPLE = `Points: 2
1) What is the capital of France?
a) London
*b) Paris
c) Rome

Points: 3
Type: MA
2) Which are primary colors?
*a) Red
b) Green
*c) Blue

Points: 4
Type: MT
3) Match each country to its capital.
a) Japan = Tokyo
b) Kenya = Nairobi`

const TYPES: Array<[string, string]> = [
  ['(no Type line)', 'Multiple choice, or true/false when the choices are True and False'],
  ['MA', 'Multiple answer'],
  ['E', 'Essay / short answer'],
  ['F', 'Fill in the blank: each answer line is an accepted answer (Classic)'],
  ['MT', 'Matching: a) Answer = Match. "= Match" alone adds a wrong match'],
  ['File', 'File upload. Optional: Limit File number:, Restrict File Types:, Show on-screen calculator'],
  ['MD', 'Multiple dropdowns: [Variable] in the question, then a [Variable] line and its options, correct first (Classic)'],
  ['Categorize', 'Categorization: "Name: description" lines with answers under each, then Additional Distractors (New)'],
  ['Numeric', 'Numeric: fill in one Requirement block from the template'],
  ['Ordering', 'Ordering: items listed in the correct order (New)'],
  ['Text only', 'Text to display: … (Classic)'],
]

/**
 * The eCampus reference documents live in one shared Drive folder, so documents can be added or
 * swapped without a new version of the app. drive.google.com is on the link allowlist.
 */
const REFERENCE_FOLDER_URL = 'https://drive.google.com/drive/folders/1_FpLDLQJFXBKk3Rf1HXsM9l3bXMy40rF?usp=sharing'

/**
 * The eCampus KB article for this app. Not written yet: while this is null the card says
 * "coming soon" instead of linking anywhere, because a link that 404s is worse than none.
 * When it is published, put its URL here (its host, boisestateecampus.atlassian.net, is already
 * on the allowlist in electron/ipc/externalLinks.ts).
 */
const KB_ARTICLE_URL: string | null = null

const SECTION_H = 'm-0 mb-3 text-xs font-black text-gray-600 uppercase tracking-[0.2em]'
const LINK = 'text-blue-700 underline underline-offset-2 hover:text-blue-900'

/** A section that opens and closes with a caret. Closed to start, so the panel can be scanned. */
function Dropdown({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <details className="group bg-gray-50 border border-gray-200 rounded-2xl">
      <summary className="flex items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 py-3 rounded-2xl hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <ChevronRight className="w-4 h-4 flex-shrink-0 text-gray-700 transition-transform group-open:rotate-90" aria-hidden="true" />
        <span className="text-sm font-black text-gray-900">{title}</span>
        {note && <span className="ml-auto text-[10.5px] font-black uppercase tracking-wider text-gray-600">{note}</span>}
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-3 text-sm text-gray-700">{children}</div>
    </details>
  )
}

function LinkCard({ href, title, detail }: { href: string; title: string; detail?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-2xl transition group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <span className="min-w-0">
        <b className="block text-sm text-blue-900">{title}</b>
        {detail && <small className="block text-xs text-gray-700 mt-0.5">{detail}</small>}
      </span>
      <ExternalLink className="w-4 h-4 flex-shrink-0 text-blue-700" aria-hidden="true" />
      <span className="sr-only">(opens in your browser)</span>
    </a>
  )
}

/** A drawer from the right: updates, setup, reference material, the format, and the AI model. */
export function HelpCenter({ isOpen, onClose, appVersion }: Props) {
  const panelRef = useDialogFocus<HTMLDivElement>(isOpen, onClose)
  const [check, setCheck] = useState<ManualCheckResult | 'checking' | null>(null)

  if (!isOpen) return null

  const runCheck = async () => {
    if (check === 'checking') return
    setCheck('checking')
    setCheck(await window.api.app.checkUpdateNow().catch(() => ({ state: 'check-failed', current: appVersion }) as ManualCheckResult))
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="relative w-full sm:w-[420px] h-full bg-white shadow-2xl flex flex-col"
      >
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 id="help-title" className="m-0 text-xl font-black text-gray-900 tracking-tight uppercase">
              Help Center
            </h2>
            <p className="m-0 text-[10px] font-black text-blue-700 uppercase tracking-widest">IDS Toolkit</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Help Center"
            className="p-2 rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="w-6 h-6" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Updates first, so "am I on the current version?" is answered without reading past anything. */}
          <section aria-labelledby="help-updates">
            <h3 id="help-updates" className={SECTION_H}>Version &amp; updates</h3>
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3 text-sm text-gray-700">
              <p className="m-0">
                You are running <b className="text-gray-900">version {appVersion || '—'}</b>. The app checks for a newer version each time it
                starts and shows a bar across the top of the window if there is one. Updates are never installed automatically.
              </p>
              <div className="flex flex-wrap items-start gap-2">
                <button
                  onClick={() => void runCheck()}
                  aria-disabled={check === 'checking' || undefined}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                    check === 'checking' ? 'bg-gray-200 text-gray-700 cursor-wait' : 'bg-brand text-white hover:bg-brand-dark'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${check === 'checking' ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {check === 'checking' ? 'Checking…' : 'Check for updates'}
                </button>
                <button
                  onClick={() => void window.api.app.openReleases()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-400 bg-white px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  View all versions on GitHub
                  <span className="sr-only">(opens in your browser)</span>
                </button>
              </div>
              <div role="status" aria-live="polite">
                {check !== null && check !== 'checking' && check.state === 'up-to-date' && (
                  <p className="m-0 font-bold text-green-800">You’re up to date: v{check.current} is the latest version.</p>
                )}
                {check !== null && check !== 'checking' && check.state === 'update-available' && (
                  <p className="m-0 font-bold text-blue-900">
                    Version {check.latest} is available. Use <b>View all versions on GitHub</b> to download it.
                  </p>
                )}
                {check !== null && check !== 'checking' && check.state === 'check-failed' && (
                  <p className="m-0 font-bold text-amber-800">
                    Couldn’t reach GitHub, so this could not be checked. Try again, or open the versions page.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section aria-labelledby="help-setup">
            <h3 id="help-setup" className={SECTION_H}>Setup</h3>
            <div className="space-y-2.5">
              <Dropdown title="Google sign-in">
                <p className="m-0 p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900">
                  <b>Google sign-in is open to a limited list of users.</b> To be added to the list, email{' '}
                  <b className="select-text">gregsnow@boisestate.edu</b>.
                </p>
                <ul className="list-disc pl-5 space-y-1.5 m-0">
                  <li>
                    <b className="text-gray-900">Google shows a warning the first time you sign in.</b> Choose <b>Advanced</b>, then{' '}
                    <b>Go to Canvas Quiz Creator</b>. The app has not been through Google’s public review, which internal use does not need.
                  </li>
                  <li>
                    <b className="text-gray-900">On the Google screen that asks what to allow, tick every box.</b> The app needs to read your
                    Google Drive and edit Google Docs. If a box is left unticked, it asks you to sign in again.
                  </li>
                  <li>
                    <b className="text-gray-900">Google asks you to sign in again about once a week.</b> That is expected: Google ends sign-ins
                    weekly for apps still in testing. Open Initial setup and choose Sign in with Google.
                  </li>
                </ul>
              </Dropdown>

              <Dropdown title="Canvas setup">
                <p className="m-0 font-black text-gray-900">How to generate a Canvas access token</p>
                <ol className="list-decimal pl-5 space-y-1 m-0">
                  <li>Log into Canvas.</li>
                  <li>
                    Go to <b>Account → Settings</b>.
                  </li>
                  <li>
                    Scroll to <b>Approved Integrations</b>.
                  </li>
                  <li>
                    Click <b>+ New Access Token</b>.
                  </li>
                  <li>
                    Give it a name and click <b>Generate Token</b>.
                  </li>
                  <li>Copy the token and paste it into the app.</li>
                </ol>
                <p className="m-0 text-xs text-gray-600">
                  Source:{' '}
                  <a
                    href="https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account"
                    target="_blank"
                    rel="noreferrer"
                    className={LINK}
                  >
                    How do I manage API access tokens in my user account?
                  </a>
                </p>
              </Dropdown>

              <Dropdown title="AI setup" note="Optional">
                <p className="m-0">
                  Only needed for the Gemini features: laying out questions the app’s rules could not fix, and changes you describe in plain
                  English. Everything else works without a key.
                </p>
                <p className="m-0 font-black text-gray-900">How to get a Gemini API key</p>
                <ol className="list-decimal pl-5 space-y-1 m-0">
                  <li>
                    Go to{' '}
                    <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className={LINK}>
                      Google AI Studio
                    </a>
                    .
                  </li>
                  <li>Sign in with your Google or SSO account, such as your Boise State University email.</li>
                  <li>
                    Create the key:
                    <ol className="list-[lower-alpha] pl-5 space-y-1 mt-1">
                      <li>
                        Click <b>Get API key</b> on the left.
                      </li>
                      <li>
                        Click the <b>Create API key</b> button.
                      </li>
                    </ol>
                  </li>
                  <li>A string of letters and numbers appears. Copy it immediately.</li>
                  <li>Go back to the app and paste it into Initial setup.</li>
                </ol>
                <p className="m-0 text-xs text-gray-600">
                  Source:{' '}
                  <a
                    href="https://docs.google.com/document/d/1Ce1gOTozOD3TGd8ntPz3oEWJjU-Y07K2akuIJHXnzHk/edit?tab=t.0#heading=h.xaazhwt982j4"
                    target="_blank"
                    rel="noreferrer"
                    className={LINK}
                  >
                    What a Gemini API Key Is, and How and Why to Get One
                  </a>
                </p>
              </Dropdown>
            </div>
          </section>

          <section aria-labelledby="help-resources">
            <h3 id="help-resources" className={SECTION_H}>Resources &amp; training</h3>
            <div className="space-y-2.5">
              {KB_ARTICLE_URL ? (
                <LinkCard href={KB_ARTICLE_URL} title="Canvas Quiz Creator — KB Article" />
              ) : (
                <div className="p-4 bg-gray-50 border border-dashed border-gray-300 rounded-2xl">
                  <p className="m-0 text-sm font-bold text-gray-700">Canvas Quiz Creator — KB Article (coming soon)</p>
                  <p className="m-0 mt-1 text-xs text-gray-600">The setup and troubleshooting guide is being written. It will appear here once it is published.</p>
                </div>
              )}
              <LinkCard
                href={REFERENCE_FOLDER_URL}
                title="Quiz reference documents (Google Drive folder)"
                detail="The Classic and New Quizzes templates, the Quiz Questions Extraction Template, converting numbered lists, the Classic and New Quizzes comparison, and how the app fixes poor formatting."
              />
            </div>
          </section>

          <section aria-labelledby="help-format">
            <h3 id="help-format" className={SECTION_H}>Question types &amp; formatting</h3>
            <div className="space-y-2.5">
              <Dropdown title="How to format questions">
                <p className="m-0">
                  Use the eCampus quiz template. <b className="text-gray-900">Points:</b> and <b className="text-gray-900">Type:</b> go above each
                  question, the question starts with its number and a parenthesis, and an asterisk goes <b className="text-gray-900">before</b> the
                  letter of each correct answer.
                </p>
                <pre className="m-0 bg-white border border-gray-200 rounded-xl p-3 text-[12px] font-mono text-gray-900 whitespace-pre-wrap select-text">
                  {FORMAT_EXAMPLE}
                </pre>
                <p className="m-0 text-xs text-gray-600">
                  Automatic numbering in Google Docs is fine: the app reads the numbers Docs shows. A Doc the app has already fixed opens on
                  its newest fixed tab.
                </p>
              </Dropdown>

              <Dropdown title="Question types">
                <table className="w-full text-[12.5px] border-collapse">
                  <tbody>
                    {TYPES.map(([code, meaning]) => (
                      <tr key={code} className="border-t border-gray-200 align-top">
                        <th scope="row" className="text-left font-black text-gray-900 py-1.5 pr-3 whitespace-nowrap">
                          {code}
                        </th>
                        <td className="py-1.5">{meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Dropdown>
            </div>
          </section>

          <section aria-labelledby="help-ai" className="pt-4 border-t border-gray-100">
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-700">
              <h3 id="help-ai" className="m-0 mb-2 text-sm font-black text-gray-900">AI model used</h3>
              <p className="m-0">
                <b className="text-gray-900">gemini-3.8-flash</b>, only when you ask for it: laying out questions the app’s rules could not fix,
                and changes you describe in plain English. Its work goes into a separate <b className="text-gray-900">Revised by Gemini</b> tab.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
