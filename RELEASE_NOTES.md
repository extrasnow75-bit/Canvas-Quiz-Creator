## What's new in v0.2.0

Fixes and changes from the first round of testing.

- **Finds every quiz in a Doc.** Quizzes numbered with Canvas question-bank ids (like `4960008.`) were taken for notes, so only the template quizzes were listed. They are now found, and the automatic fix puts them in the template format. A `####` answer space becomes an essay question, and the `=== End of Quiz ===` line no longer causes a warning.
- **Safer answers from formatting.** With no asterisk, a bold, highlighted or underlined choice is marked correct only when it is the only choice that stands out, and the question shows a warning until a person checks it. Several highlighted choices are listed for a person instead ("b) and c) are highlighted. Put * before the correct answer(s)."). Green and purple highlights, and a highlight over the question itself, are ignored.
- **Opens the fixed version.** A Doc the app has already fixed opens on its newest Reformatted questions or Revised by Gemini tab, not the original, and step 1 says which tab it opened.
- **Google Drive picker:** opening a folder from search results now shows the folder.
- **Canvas:** no warning about sending your token to Boise State's own Canvas site.
- **Clearer screens:** the chosen quiz type (Classic or New) is solid green with a check mark; "Choose another doc"; "Sandbox course (also known as a Master course or a Blueprint course)" instead of "Blueprint".
- **App icon:** the rocket on Boise State blue.

How the app treats each kind of formatting, with before-and-after examples, is in the quiz reference documents linked from the Help Center.
