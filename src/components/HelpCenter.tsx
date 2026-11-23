import { useState, type RefObject } from 'react'
import { ExternalLink, X } from 'lucide-react'
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

/** A drawer from the right: the format, reference documents, and the version. */
export function HelpCenter({ isOpen, onClose, returnFocusTo, appVersion }: Props) {
  const panelRef = useDialogFocus<HTMLDivElement>(isOpen, onClose)
  const [check, setCheck] = useState<ManualCheckResult | 'checking' | null>(null)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="relative w-full max-w-md h-full bg-white shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 bg-brand text-white">
          <h2 id="help-title" className="font-black text-[15px] m-0">
            Help Center &amp; More
          </h2>
          <button onClick={onClose} aria-label="Close Help Center" className="p-1 rounded hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-[13px] text-gray-700">
          <section>
            <h3 className="font-black text-sm text-gray-900 mb-1.5">How to format questions</h3>
            <p className="mb-2">
              Use the eCampus quiz template. <b className="text-gray-900">Points:</b> and <b className="text-gray-900">Type:</b> go above
              each question, the question starts with its number and a parenthesis, and an asterisk goes{' '}
              <b className="text-gray-900">before</b> the letter of each correct answer.
            </p>
            <pre className="bg-slate-50 border border-gray-200 rounded-xl p-3 text-[12px] font-mono text-gray-900 whitespace-pre-wrap select-text">
              {FORMAT_EXAMPLE}
            </pre>
          </section>

          <section>
            <h3 className="font-black text-sm text-gray-900 mb-1.5">Question types</h3>
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
            <p className="mt-2 text-xs text-gray-600">
              Automatic numbering in Google Docs is fine: the app reads the numbers Docs shows. If the Doc has tabs, choose the tab with
              the questions.
            </p>
          </section>

          <section aria-labelledby="ref-docs-h">
            <h3 id="ref-docs-h" className="font-black text-sm text-gray-900 mb-2">Reference documents</h3>
            <a
              href={REFERENCE_FOLDER_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-start justify-between gap-3 p-3 bg-slate-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-xl transition group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="min-w-0">
                <b className="block text-[13px] text-gray-900 group-hover:text-brand">Quiz reference documents (Google Drive folder)</b>
                <small className="block text-xs text-gray-600 mt-0.5">
                  The Classic and New Quizzes templates, the Quiz Questions Extraction Template, converting numbered lists, the Classic and New
                  Quizzes comparison, and how the app fixes poor formatting.
                </small>
              </span>
              <ExternalLink className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-600 group-hover:text-brand" aria-label="Opens in your browser" />
            </a>
          </section>

          <section>
            <h3 className="font-black text-sm text-gray-900 mb-1.5">Before students see it</h3>
            <p>
              Quizzes are always created unpublished. Open each one in Canvas, check it, set the due date and availability, then
              publish it.
            </p>
          </section>

          <section>
            <h3 className="font-black text-sm text-gray-900 mb-1.5">Version</h3>
            <p className="mb-2">Canvas Quiz Creator {appVersion || '—'}</p>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  setCheck('checking')
                  setCheck(await window.api.app.checkUpdateNow().catch(() => ({ state: 'check-failed', current: appVersion }) as ManualCheckResult))
                }}
                disabled={check === 'checking'}
                className="text-xs font-bold text-gray-700 border border-gray-500 rounded-lg px-3 py-1.5 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Check for updates
              </button>
              <span role="status" className="text-xs">
                {check === 'checking'
                  ? 'Checking…'
                  : check?.state === 'up-to-date'
                    ? 'You have the latest version.'
                    : check?.state === 'update-available'
                      ? `Version ${check.latest} is available.`
                      : check?.state === 'check-failed'
                        ? 'Could not check just now.'
                        : ''}
              </span>
            </div>
            {check && check !== 'checking' && check.state === 'update-available' && (
              <button onClick={() => void window.api.app.openReleases()} className="mt-2 text-xs font-black text-brand underline underline-offset-2">
                Open the download page
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
