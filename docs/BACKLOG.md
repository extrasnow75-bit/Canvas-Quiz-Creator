# Backlog

Changes agreed but not started. Each waits for the result of testing v0.1.0 in the Canvas sandbox.

## 1. Upload a Word document (no Google sign-in needed)

**Why:** some people have trouble signing in to Google in these apps. Uploading a .docx gives
them another way in. It also covers people who can't sign in: they can open a Google Doc and
choose File → Download → Microsoft Word (.docx).

**What changes:**
- Google sign-in becomes optional. Only the Canvas token is needed to start.
- Step 1 gets a third choice, **Upload a Word document**, beside the Drive picker and the link box.
- The .docx is read into the same lines the app already uses (bold, highlight, headings, numbered
  lists), so quiz splitting, the automatic fixes, Gemini, the checks and Canvas creation are unchanged.
- Fixes can't go in a new tab without Google, so **Fix automatically** saves a new Word file next to
  the original. It has the time stamp, notes and highlighted changes at the top, and the original is
  not changed. Gemini's version is a second Word file in the same way.
- Review stays the same: check the new file in Word, then upload it to build the quizzes.
- Help Center: when to use Google Docs and when to use Word.

**Decided against:** pasting a Google Doc link shared as "Anyone with the link" without signing in.
It works technically, but it means the quiz and its answer key have to be readable by anyone with
the link. Downloading a .docx does the same job without that risk.
