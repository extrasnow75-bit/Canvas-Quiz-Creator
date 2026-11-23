# Canvas Quiz Creator

A desktop app for Windows and macOS that reads quiz questions from a Google Doc written in the
Boise State eCampus quiz template format and creates the quiz in one or more Canvas courses, as
Classic Quizzes or New Quizzes.

Built for the eCampus Center as a sibling of Canvas Extractor Tools and Canvas Rubric Creator,
with the same look, the same Canvas course picker, and the same way of keeping credentials.

**Status: in development.** The app builds and its screens work. Creating quizzes has not yet
been tested against a real Canvas course.

## What it does

1. **Quiz questions.** Choose a Google Doc from Drive or paste its link. If the Doc has tabs,
   choose the tab with the questions.
2. **The quiz.** Title, optional instructions for students, Classic or New Quizzes.
3. **Check the questions.** Every question as the app understood it, with the correct answers
   ticked and any problems marked on the question they belong to.
4. **Canvas courses.** Tick one or more courses. The list shows courses where you are a teacher,
   TA or designer, including custom roles built on those, such as Course Administrator.
5. **Create.** The same unpublished quiz is created in each course, one course at a time, with a
   per-course result and an "Open in Canvas" link.

## Fixing badly formatted questions

The **Fix quiz formatting** card, or **Try to fix the formatting** when Create finds problems, writes
the questions in the template format to a new **Reformatted questions** tab of the same Google Doc.
The original tab is not touched. The new tab starts with a time stamp and notes, and every line the
app changed is highlighted, so the faculty member can compare it with the original.

1. **Rules first, no AI.** Other numbering and letter styles, misplaced asterisks, answer keys
   ("Answer: B" or a key at the end), bold or highlighted answers, choices typed on one line,
   points written into the question, and a missing `Type: MA`.
2. **Gemini if needed,** when a Gemini key is saved and problems remain. Its answer is used only if
   it adds no wording and invents no point values, and correct answers always come from the faculty
   member's own marks, never from Gemini.
3. **A person reviews.** The summary lists answer and point changes first. A quiz built from a
   reformatted tab cannot be created until someone ticks **Ready for Canvas**.
4. **Changes after that:** edit the tab by hand in Google Docs and choose **Read again** (the app
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
4. Keep the OAuth consent screen in **Testing** with the users listed as test users. See the
   comments in `googleConfig.ts` for why.

## Tests

```
npm test
```

The parser tests use a copy of the eCampus "Quiz Formatting Tool Example Doc" as Google's Docs API
returns it (`electron/ipc/__fixtures__/ecampus-template.json`).
