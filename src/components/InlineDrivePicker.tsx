import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, ChevronRight, Folder, Loader2 } from 'lucide-react'
import type { DriveFile } from '../types'

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
type Scope = 'recent' | 'myDrive' | 'sharedWithMe'

const SCOPES: Array<[Scope, string]> = [
  ['recent', 'Recent'],
  ['myDrive', 'My Drive'],
  ['sharedWithMe', 'Shared with me'],
]

function modified(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days < 1 && new Date().getDate() === d.getDate()) return 'Modified today'
  if (days < 2) return 'Modified yesterday'
  return `Modified ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}`
}

/**
 * The Google Drive picker, built into step 1 rather than opened as a dialog: the developer's first
 * job is choosing the Doc, so the list is simply there. Google Docs only, with folders to open in
 * My Drive and Shared with me. Same requests as the Drive browser (no credential in this window).
 */
export function InlineDrivePicker({ onPick, busy }: { onPick(file: { fileId: string; name: string }): void; busy: boolean }) {
  const [scope, setScope] = useState<Scope>('recent')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  const [files, setFiles] = useState<DriveFile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const id = useId()
  const folder = folders[folders.length - 1]

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.drive.listFiles({
        scope: search ? 'search' : folder ? 'folder' : scope,
        folderId: folder?.id,
        query: search || undefined,
        mimeTypes: [GOOGLE_DOC_MIME],
        pageSize: 50,
      })
      if (mine === seq.current) setFiles(res.files)
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : 'Could not load your Drive files.')
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [scope, search, folder])

  useEffect(() => {
    void load()
  }, [load])

  // Search as the person types, a moment after they stop.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div className="border-2 border-gray-200 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 px-2.5 py-2 bg-slate-50 border-b border-gray-200" role="toolbar" aria-label="Where to look">
        {SCOPES.map(([s, label]) => {
          const on = !search && !folder && scope === s
          return (
            <button
              key={s}
              onClick={() => {
                setScope(s)
                setFolders([])
                setQuery('')
                setSearch('')
              }}
              aria-pressed={on}
              className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${on ? 'bg-brand text-white' : 'text-gray-700 hover:bg-white'}`}
            >
              {label}
            </button>
          )
        })}
        <label htmlFor={`${id}-q`} className="sr-only">
          Search your Google Docs
        </label>
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Google Docs"
          spellCheck={false}
          className="ml-auto w-60 max-w-full border-2 border-gray-500 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand"
        />
      </div>

      {folders.length > 0 && !search && (
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 px-3 py-1.5 text-xs text-gray-700 border-b border-gray-100">
          <button onClick={() => setFolders([])} className="font-bold text-brand underline underline-offset-2">
            {SCOPES.find(([s]) => s === scope)?.[1]}
          </button>
          {folders.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3" aria-hidden="true" />
              {i === folders.length - 1 ? (
                <b className="text-gray-900">{f.name}</b>
              ) : (
                <button onClick={() => setFolders(folders.slice(0, i + 1))} className="font-bold text-brand underline underline-offset-2">
                  {f.name}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="max-h-[260px] overflow-y-auto" role="region" aria-label="Google Docs" aria-busy={loading}>
        {loading && (
          <p role="status" className="p-3.5 text-[13px] text-gray-700 flex items-center gap-2 m-0">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading your Google Docs…
          </p>
        )}
        {error && !loading && (
          <p className="p-3.5 flex items-start gap-2 text-[13px] text-red-800 m-0">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-700" aria-hidden="true" />
            <span role="alert">{error}</span>
          </p>
        )}
        {!loading && files && files.length === 0 && (
          <p className="p-3.5 text-[13px] text-gray-700 m-0">{search ? `No Google Docs match “${search}”.` : 'No Google Docs here.'}</p>
        )}
        {!loading &&
          files?.map((f) =>
            f.isFolder ? (
              <button
                key={f.id}
                onClick={() => setFolders([...folders, { id: f.id, name: f.name }])}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 border-b border-gray-100 text-left hover:bg-blue-50 focus:outline-none focus-visible:bg-blue-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <Folder className="w-[18px] h-[18px] text-gray-600 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-[13.5px] font-bold text-gray-900 truncate">{f.name}</span>
                <ChevronRight className="w-4 h-4 text-gray-600" aria-hidden="true" />
              </button>
            ) : (
              <button
                key={f.id}
                disabled={busy}
                onClick={() => onPick({ fileId: f.id, name: f.name })}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 border-b border-gray-100 text-left hover:bg-blue-50 focus:outline-none focus-visible:bg-blue-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-60"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="flex-shrink-0">
                  <rect x="4" y="2" width="16" height="20" rx="2" fill="#4285F4" />
                  <path d="M8 9h8M8 13h8M8 17h5" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span className="flex-1 min-w-0">
                  <b className="block text-[13.5px] text-gray-900 truncate">{f.name}</b>
                  <small className="text-xs text-gray-600">{modified(f.modifiedTime)}</small>
                </span>
                <span className="text-xs font-black text-brand">Open</span>
              </button>
            ),
          )}
      </div>
    </div>
  )
}
