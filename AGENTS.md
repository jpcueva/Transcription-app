# Notes for AI assistants and new maintainers

Read this, then `CHANGELOG.md` (history **and the reasons** behind each decision), then `README.md`.

## What this is
A static web page (no build step, no server) used on an iPhone via GitHub Pages
(`https://jpcueva.github.io/Transcription-app/`). The user picks an MP3 or M4A (Voice Memos); the page splits it
on the phone, sends each piece to Gemini `gemini-3.5-transcribe` for a transcript with timestamps and speaker
labels, joins the pieces, matches speakers across pieces, and lets the user fix speakers and text.

## Architecture (plain browser scripts, each also loadable in Node for tests)
| File | Role |
|---|---|
| `index.html` | All UI and wiring. Holds `APP_VERSION`. |
| `mp3split.js` / `m4a.js` / `audiofile.js` | Measure and cut audio without decoding (MP3 frames; MP4 sample tables → ADTS AAC). `plan()` computes the pieces. |
| `gemini.js` | **Only** file that calls Google: Files API upload, Interactions API transcription, text-only `generateContent` for speaker matching (`resolveSpeakers`) and name suggestions (`suggestNames`). |
| `transcript.js` | Timestamp shifting, joining pieces at overlap midpoints, TXT/SRT export. |
| `speakers.js` | Cross-piece speaker matching (overlap word votes → AI resolver → new number). |
| `edits.js` | Pure edit operations: rename/merge, move line, edit text, split, mark OK, delete. |
| `quality.js` | Review flags (impossibly fast speech, repeated text). |
| `progress.js` | Saved pieces + edited transcript in localStorage (resume after reload). |

## Gemini API facts (verified by a real run unless noted)
- Transcription: `POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`,
  body `{model, input:[{type:"audio", uri, mime_type}], generation_config:{transcription_config:{mode:{type:"verbatim",
  diarization_mode:"speaker", timestamp_granularities:["word"]}}}}`. If that nested form is rejected with 400 the
  code retries once with `diarization_mode`/`timestamp_granularities` directly in `transcription_config`.
- Response: `steps[].content[].annotations[]` with `{type:"word_info", text, start_offset:"0.4s", end_offset, speaker:"spk:0"}`.
- `generateContent` JSON mode is **not** supported by the transcribe model (400). It is used only for the text
  model (default `gemini-flash-latest`, user-editable) — that model name has not been independently verified.
- Limits: ≤ 30 min audio per request with diarization/timestamps (hence 28-min pieces); ≤ 8 speakers per request.
- Audio uploaded via `POST /upload/v1beta/files?uploadType=multipart` (single request, no CORS-exposed headers needed).

## Product decisions to respect (see CHANGELOG for why)
- Never collapse different people into one label. Unmatched speakers get a new number; "Unidentified speaker" only
  when Gemini returned no speaker.
- AI speaker matching uses names, roles, topics and style (user preference: less manual work), "NEW" when unsure.
  It also gets the line spoken just before each unmatched speaker's turns and each known speaker's last lines/time.
- Errors from Gemini's diarization *within* one piece cannot be fixed by matching; the user fixes them with Move line / Split.
- No overall speaker cap. Destructive actions use Undo, not confirm dialogs (except replacing a saved transcript).
- API key stays on the device; a key-holding server function was intentionally postponed.

## Releasing (the app shows its version and offers Reload when outdated)
Bump together: `APP_VERSION`/`APP_DATE` in `index.html`, `version.json`, every `<script src="…?v=N">`, and add a
`## vN` entry at the top of `CHANGELOG.md`. `test/version.test.js` fails if any of these disagree.

## Testing
- Unit tests: `node --test test/*.test.js` (no dependencies).
- Browser tests (Playwright + Chromium, Gemini fully mocked):
  `node test/browser/basic.js && node test/browser/editing.js`
  (set `PLAYWRIGHT_MODULE` / `CHROMIUM_PATH` if Playwright is not installed normally).
- The mock cannot catch real-API surprises: after changing `gemini.js`, ask the user for a real run.

## Development branch
Work happens on `claude/iphone-audio-transcription-gemini-0ck4ht`, which GitHub Pages serves.
