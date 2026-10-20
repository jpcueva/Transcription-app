# Transcription app

Static web page for iPhone Safari: pick an MP3 or an M4A (Voice Memos), it is split on the phone into overlapping pieces
(max 28 min, 90 s overlap by default), each piece is transcribed with Gemini (speaker labels + timestamps),
and the pieces are joined into one timeline. Export as TXT or SRT.

## Files
- `index.html` – the UI (no build step)
- `m4a.js` – reads an M4A's frame index and cuts it into ADTS `.aac` pieces (AAC-LC only; lossless/ALAC recordings are rejected with a hint)
- `audiofile.js` – detects MP3 vs M4A from the file contents and gives the page one `open()/cut()` interface
- `mp3split.js` – reads MP3 frame headers, plans equal-length overlapping pieces, returns byte ranges (no decoding)
- `transcript.js` – timestamp shifting, joining pieces at overlap midpoints, TXT/SRT export
- `speakers.js` – makes speaker labels consistent across pieces (overlap word matching, optional AI resolver, new numbers for anyone unmatched)
- `edits.js` – rename / merge speakers, move single lines, edit / split / delete lines, mark reviewed (pure functions)
- `quality.js` – flags lines that look like model mistakes (impossibly fast speech, repeated text)
- `progress.js` – saves finished pieces and the edited transcript in the browser so an interrupted run can resume
- `gemini.js` – the only file that calls the Gemini API. Transcription uses the Interactions API (`POST /v1beta/interactions`) with
  `transcription_config` for speaker diarization + word timestamps (field names from the google-genai SDK and the Gemini cookbook);
  the per-word `word_info` annotations are grouped into speaker turns. Speaker cleanup uses `generateContent` on a text model.

## Run
Serve the folder over HTTPS (needed for the iPhone clipboard / home-screen install), e.g. GitHub Pages, or locally
`npx http-server .`. The API key is stored in the browser's localStorage on the device only.

## Versioning
The page shows its version in the title and footer and checks `version.json` (uncached) each time it opens;
if the server has a newer version it shows a Reload banner. When releasing, bump `APP_VERSION`/`APP_DATE` in
`index.html`, `version.json`, and every `<script src="...?v=N">` together — `test/version.test.js` enforces this.

## Test
- Unit tests: `node --test test/*.test.js`
- Browser tests (Playwright + Chromium, Gemini mocked): `node test/browser/basic.js && node test/browser/editing.js`

See `AGENTS.md` for a hand-off summary and `CHANGELOG.md` for the history and reasoning behind each change.

## How speakers are matched
1. Each piece is transcribed on its own, so its labels are local.
2. For every label in piece N, the words it said in the overlap with piece N-1 are compared with the words
   already-resolved speakers said there. A label is mapped only with ≥5 matched words and a clear winner (2× the runner-up).
3. Labels left over (e.g. someone silent in the overlap) are sent, as text only, to a cheaper model together with sample
   lines of the known speakers. It may only link them to a known speaker on clear evidence (e.g. addressed by the same
   name); otherwise it answers `NEW`. Can be switched off on the page.
4. Anything still unmatched gets the next free number ("Speaker 6"). Splitting one person in two is fixed with a single
   "Same person as…" merge, whereas wrongly merging two people is hard to undo, so doubts always become new numbers.
   "Unidentified speaker" is only used for lines where Gemini returned no speaker. There is no overall speaker cap
   (Gemini's limit of 8 applies per piece, not per meeting).

## Editing and saved progress
- Tap **Edit** on any line to correct its text in place (saved with the transcript, marked "edited", included in exports),
  **Split here** at the caret (e.g. a question and someone else's answer in one line), or **Delete line**
  (an Undo bar appears for 10 seconds).
- Lines that look like model mistakes are marked **⚠ Check**: impossibly fast speech (> 6 words/s) or text that
  repeats an earlier passage. **Mark OK** in the edit box clears the flag.
- Tap a speaker's name on any line to: rename that speaker everywhere, merge them into another speaker, or move just that one line.
  Name suggestions come from a single text-only call that looks for names actually said in the conversation (introductions,
  being addressed by name); it runs the first time you open the sheet and is cached.
- Each finished piece is saved on the device as soon as it returns. If Safari reloads or an error stops the run, select the same
  file again and press Transcribe: only the missing pieces are redone. The edited transcript is restored the same way.
  Saved data is keyed by file name, size, modified time, piece settings and model; the 5 most recent files are kept.

## Not yet built
Optional key-holding server function.
