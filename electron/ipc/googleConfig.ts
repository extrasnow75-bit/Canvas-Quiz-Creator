/**
 * Google OAuth configuration for the Canvas Quiz Creator desktop app.
 *
 * The Docs API must be enabled as well as the Drive API: questions are read with documents.get,
 * which the drive.readonly scope below already authorises.
 *
 * Setting this up (one-time, in the Google Cloud Console):
 *   1. APIs & Services → enable the **Google Drive API**.
 *   2. OAuth consent screen → External → add your users as **Test users**. Keep it in Testing;
 *      see the note on scopes below for why publishing is not a casual step.
 *   3. Credentials → Create OAuth client ID → Application type: **Desktop app**.
 *      A "Web application" client will not work: this app signs in through the system browser
 *      with a loopback redirect (RFC 8252), which web clients do not permit.
 *   4. Paste the client ID below, and put the secret in `.env.local` (see below).
 *
 * The client ID is a PUBLIC identifier and is safe to commit.
 */
export const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ?? '1085000809714-0g2p5a9ught003j9ssg9tn1p587cske3.apps.googleusercontent.com'

/**
 * Google requires a client_secret on the token exchange even for "Desktop app" clients using
 * PKCE. Google's own documentation notes it is not a true secret in this context — it ships
 * inside the installed app — but it must be sent.
 *
 * It is deliberately NOT hardcoded: this repository is public, and GitHub secret scanning
 * auto-reports Google client secrets, after which Google revokes them and every installed copy
 * stops being able to sign in. Provide it locally instead, via either:
 *   - a `.env.local` file in the project root:  MAIN_VITE_GOOGLE_CLIENT_SECRET=GOCSPX-...
 *   - or a GOOGLE_CLIENT_SECRET environment variable
 *
 * For release builds it is injected at build time from the CI secret of the same name.
 */
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env

export const GOOGLE_CLIENT_SECRET: string =
  viteEnv?.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? ''

export function isGoogleSecretConfigured(): boolean {
  return GOOGLE_CLIENT_SECRET.length > 0
}

/**
 * Scopes.
 *
 * `drive.file` alone would be the least-privilege choice — it grants access only to files this
 * app itself creates — and it is what the sibling Canvas Extractor Tools app uses. It is not
 * enough here: the questions are in Google Docs that faculty members wrote, which the in-app
 * Drive picker has to list and read, and `drive.file` cannot see a file the app did not create.
 *
 * `drive.readonly` is one of Google's **restricted** scopes, and `documents` is **sensitive**. The
 * app is set up as Canvas Rubric Creator is, which has the same need to read and change people's
 * own Docs:
 *   - The consent screen is **External** and stays in **Testing**, with each user added as a test
 *     user. That needs no Google review.
 *   - Google ends sign-ins from apps in Testing after **7 days**, so people sign in again about
 *     once a week. getAccessToken() clears the dead sign-in and tells the window, which asks the
 *     person to sign in again rather than looking signed in while every Doc fails.
 *   - Google shows an "unverified app" warning on the first sign-in (Advanced → Go to Canvas Quiz
 *     Creator). The Help Center says so.
 *   - Do not **publish** the consent screen: with a restricted scope that requires an annual
 *     third-party security assessment, which is expensive.
 *   - The alternative, if the university will host it: an **Internal** consent screen in a Cloud
 *     project owned by its Google Workspace has no review, no test-user list and no 7-day limit,
 *     for university accounts only.
 *
 * Google lets people untick any of these on its consent screen and still completes the sign-in,
 * so googleAuth.ts checks what was actually granted: see REQUIRED_SCOPES.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  // Adding a "Reformatted questions" tab to the faculty member's Doc. A sensitive scope, not a
  // restricted one: it adds no review burden beyond what drive.readonly already brings.
  'https://www.googleapis.com/auth/documents',
  'openid',
  'email',
  'profile',
].join(' ')

/** The scopes the app cannot work without: a sign-in that lacks one is refused at once. */
export const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents',
]

export function isGoogleConfigured(): boolean {
  return !GOOGLE_CLIENT_ID.startsWith('REPLACE_WITH')
}
