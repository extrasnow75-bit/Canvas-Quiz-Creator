# Canvas Quiz Creator

A desktop app for Windows and macOS that reads quiz questions from a Google Doc written in the
Boise State eCampus quiz template format and creates the quiz in one or more Canvas courses, as
Classic Quizzes or New Quizzes.

Built for the eCampus Center as a sibling of Canvas Extractor Tools and Canvas Rubric Creator,
with the same look, the same Canvas course picker, and the same way of keeping credentials.

**Status: in development.** The app builds and its screens work. Creating quizzes has not yet
been tested against a real Canvas course.

## What it does

1. **Quiz questions.** Choose a Google Doc in the Drive picker built into step 1, or paste its
   link. A Doc can hold several quizzes: each heading above a set of questions starts a quiz and
   gives it its title (the app uses the heading level directly above the questions, and you can
   choose another). If the Doc has tabs, choose the tab.
2. **Which kind of quiz?** The Classic Quizzes and New Quizzes cards say how many of the Doc's
   quizzes, and questions, fit each. A table sets Classic or New for each quiz, lets you rename or
   leave out a quiz, and shows its questions.
3. **Check and fix the questions.** How many problems there are, how many the automatic fixes
   (no AI) can clear, and how many need a person. Gemini is offered only as the last resort.
4. **Canvas courses.** Tick one or more courses: every quiz in the Doc goes to the same courses.
   The list shows courses where you are a teacher, TA or designer, including custom roles built on
   those, such as Course Administrator.
5. **Launch.** Each quiz is created, unpublished, as its chosen type in every course, one at a
   time, with results grouped by course and an "Open in Canvas" link for each.

## Fixing badly formatted questions

**Fix automatically** in step 3 writes every quiz in the template format to a new **Reformatted
questions** tab of the same Google Doc, each under its own heading.
The original tab is not touched. The new tab starts with a time stamp and notes, and every line the
app changed is highlighted, so the faculty member can compare it with the original.

1. **Rules first, no AI.** Other numbering and letter styles, misplaced asterisks, answer keys
   ("Answer: B" or a key at the end), bold or highlighted answers, choices typed on one line,
   points written into the question, and a missing `Type: MA`.
2. **Gemini as the last resort,** only when asked, and only for quizzes the rules left with problems.
   Its version goes into a third tab, **Revised by Gemini**, with Gemini's changes highlighted in
   purple, so the original and the no-AI tab stay as they were. Its answer is used only if it adds no
   wording and invents no point values, and correct answers always come from the faculty member's
   own marks, never from Gemini. Plain-English changes requested from Gemini go to the same tab.
3. **A person reviews.** The summary lists answer and point changes first. A quiz from a
   reformatted tab cannot be launched until someone ticks **Checked** for it.
4. **Points for questions with none.** When questions have no points, step 3 says how many and
   offers a number (1 to start with). Fix automatically adds that Points line to each of them,
   highlighted. Leave the field empty to add points yourself.
5. **Changes after that:** edit the tab by hand in Google Docs and choose **Read again** (the app
   says "Manual edit detected at …"), or describe the change for Gemini and accept or discard the
   change list it produces.

If the Doc is view-only, the reformatted questions go to a new Doc in your My Drive instead.

## The question format

```
Points: 2
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
```

`Points:` and `Type:` go above each question in either order. An asterisk goes before the letter
of each correct answer. No `Type:` line means multiple choice, or true/false when the choices are
True and False. Type codes: `MA`, `E`, `F`, `MT`, `File`, `MD`, `Categorize`, `Numeric`,
`Ordering`, `Text only`. The Help Center in the app has the details.

| Type | Classic Quizzes | New Quizzes |
| --- | --- | --- |
| Multiple choice, true/false, multiple answer, essay, matching, file upload, numeric | ✅ | ✅ |
| Fill in the blank, text only | ✅ | Not built yet: left out, with a warning |
| Multiple dropdowns | ✅ | Not in New Quizzes |
| Categorization, ordering | Not in Classic Quizzes | ✅ |

## Setting it up

Under **Initial setup** in the app (the first two are required):

| | Needed for | Where to get it |
| --- | --- | --- |
| **Google sign-in** | Reading the questions | Sign in with Google in the app |
| **Canvas API token** | Listing courses and creating quizzes | Canvas → Account → Settings → **+ New Access Token** |
| **Gemini API key** (optional) | Reformatting what the rules cannot, and Request changes | [aistudio.google.com](https://aistudio.google.com/apikey) |

The Canvas token is encrypted in the operating system's keychain and is only ever sent to the
Canvas site you choose. The visible part of the app is never given it.

## Running from source

```
npm install
npm run dev
```

### One-time Google setup (for whoever builds the app)

In the Google Cloud Console project used for the eCampus desktop apps:

1. **APIs & Services → Library:** enable the **Google Drive API** and the **Google Docs API**.
   The app asks to read Drive and to edit Google Docs (for the Reformatted questions tab).
2. **Credentials → Create OAuth client ID → Desktop app.** Put the client ID in
   `electron/ipc/googleConfig.ts` (it is public and safe to commit).
3. Put the client secret in `.env.local` as `MAIN_VITE_GOOGLE_CLIENT_SECRET=...` (see
   `.env.example`). Never commit it.
4. **OAuth consent screen:** External, kept in **Testing**, with each user added as a test
   user: the same setup as Canvas Rubric Creator. Do not publish it (a restricted scope needs a
   paid security assessment to publish). What users will notice:
   - Google asks them to sign in again about once a week.
   - The first sign-in shows Google's "unverified app" warning: they choose **Advanced**, then
     **Go to Canvas Quiz Creator**.

   See the comments in `googleConfig.ts` for the reasons and the alternative.

## Releasing

`.github/workflows/release.yml` builds the Windows installer and the two Mac disk images on
GitHub and publishes them on the Releases page. Copied from Canvas Rubric Creator.

Before the first release:
1. Put the Google Desktop app client ID in `electron/ipc/googleConfig.ts`.
2. Add the client secret as the repository secret **MAIN_VITE_GOOGLE_CLIENT_SECRET**
   (Settings → Secrets and variables → Actions). The release stops if either is missing.

For each release:
1. Set `version` in `package.json` (for example `0.1.0`).
2. Rewrite `RELEASE_NOTES.md`, starting with `## What's new in v0.1.0`.
3. Merge to `main`, then push the tag: `git tag v0.1.0 && git push origin v0.1.0`.

A manual run from the Actions tab builds the installers without publishing, to test the pipeline.

## Tests

```
npm test
```

The parser tests use a copy of the eCampus "Quiz Formatting Tool Example Doc" as Google's Docs API
returns it (`electron/ipc/__fixtures__/ecampus-template.json`).
