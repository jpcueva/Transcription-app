# Changelog

Every release bumps the version shown in the app (see "Releasing" in `AGENTS.md`). Each entry records what
changed **and why**, so the reasoning survives a hand-off to another person or AI. Newest first.

## v13 — 2026-10-20
- **Flagged lines are left out of the AI matcher's context.** *Why:* in the real run of v12, Karthik's "last spoke"
  time came from Gemini's hallucinated repeat at 37:25, not from "I need to drop off for another meeting" at 31:37,
  so the AI still matched an IT answer at 52:55 to him. Lines flagged by `quality.js` (impossibly fast speech,
  repeated text) no longer count as anyone's last lines or name cues.
- **Known speakers now carry their own name cues** (the line said just before their first turns), and the prompt
  says that a known and an unmatched speaker called on by the same name are the same person. *Why:* Anusha got two
  numbers — "I see Anusha, you have a hand up" (piece 1) and "Anusha, I don't want to put you on the spot"
  (piece 2) — because only the unmatched side's cue was shown.
- Confirmed on the real run of v12: Juan now gets his own number (cue "Juan, good question").

## v12 — 2026-10-20
- **Better context for AI speaker matching between pieces** (matching stays broad: names, roles, topics, style).
  For each unmatched speaker the AI now also sees *the line said just before each of their first turns* and when
  they first speak; for each known speaker, *when they last spoke and their last lines*. The prompt tells it that
  someone called on by a new name ("Juan, good question") is a new person, and that a speaker who said they were
  leaving (or has been silent for long) needs strong evidence to match.
  *Why:* in a real 58-min meeting the AI only saw a few sample lines per speaker, so it matched Juan (piece 3) to
  Evelyn because of a similar topic, and an IT answer at 52:55 to Karthik — who had said "I need to drop off" at
  31:37 — because of the IT topic. Both clues were in the transcript but not in the prompt.
- Not fixable by this change (Gemini's own diarization inside one piece): Justin given Mai's label (28:00), a
  Bjorne line labelled Karthik (34:24), and two people in one line (14:41). Use Move line / Split for those.

## v11 — 2026-10-20
- **Review flags (⚠).** Lines that are probably model mistakes are marked "Check: …": *very fast speech*
  (> 6 words/s on lines of 12+ words) and *repeats earlier text* (≥ 60 % of the line's 5-word phrases already
  appeared; lines of 20+ words only). **Mark OK** in the edit box clears a flag for good.
  *Why:* a real 58-min meeting contained a ~150-word passage at 37:25, attributed to someone who had already left,
  that repeated text from 20:27–21:52 and was "spoken" in ~12 s — a Gemini hallucination. Short stock phrases
  ("thank you very much for your time") repeat legitimately, hence the 20-word minimum for repeats.
- **Split line.** In the edit box, tap where the second part starts and press **Split here**. Both parts keep
  the speaker (change either via its speaker chip); the split time is estimated from the character position.
  Undo is offered. *Why:* Gemini sometimes puts a question and the answer from a different person in one line.
- **AI speaker matching is broad again** (names, roles, who they reply to, topics, vocabulary, speaking style),
  falling back to a new number only when genuinely unsure. *Why:* the user prefers fewer manual merges on long
  meetings over the stricter "names only" rule tried in v10; v10's numbering of unmatched speakers is kept.
- **A failed piece no longer stops the others.** Remaining pieces are still transcribed and saved; the error is
  shown at the end and Transcribe resumes only the failed piece. *Why:* how much was saved depended on timing.
- **Fix:** hidden elements (the "Saved progress" bar, labels in the speaker sheet) could stay visible because a
  CSS `display` rule overrode the `hidden` attribute. A global `[hidden] { display:none !important }` fixes it.
- Browser tests moved into the repo (`test/browser/`) with a shared Gemini mock; added `CHANGELOG.md`, `AGENTS.md`.

## v10 — 2026-10-20
- **No more "Unidentified speaker" for unmatched people.** A speaker who cannot be matched between pieces gets
  the next free number ("Speaker 6"). "Unidentified speaker" remains only for lines Gemini returned without a
  speaker. *Why:* in a real meeting three different people (who only spoke mid-piece, never in an overlap) were
  collapsed into one "Unidentified speaker". A split person is fixed with one "Same person as…" tap; a wrong merge
  has to be undone line by line — so doubts must become new numbers, never shared labels.
- **Removed the overall 8-speaker cap.** *Why:* Gemini's limit of 8 applies per request (per piece); a meeting
  can have many more people (that one had 10+).
- AI matching was made strict (explicit name evidence only) — reverted in v11 at the user's request.

## v9 — 2026-10-20
- **Delete line** (in the edit box) with a 10-second **Undo** bar instead of a confirmation dialog. Any other
  change hides the bar, so the saved copy always equals what is on screen.

## v8 — 2026-10-20
- **Edit line text in place** (Edit → Save/Cancel); edited lines are tagged "edited"; empty text cannot be saved.
- Speaker limit fixed at 8 and the setting removed (superseded in v10).

## v7 — 2026-10-19
- **Speaker sheet** (tap a speaker chip): rename everywhere, merge into another speaker ("Same person as…"),
  move only this line, with sample lines to recognise the person.
- **Name suggestions** from one text-only call (`suggestNames`) that looks for names actually said (introductions,
  being addressed). Tapping a suggestion fills the name field rather than renaming, so the evidence can be checked.
- **Saved progress** (`progress.js`): each finished piece and the edited transcript are stored in localStorage,
  keyed by file name/size/mtime + piece settings + model; 5 most recent files kept. Re-selecting the same file
  restores the transcript or resumes only missing pieces. *Why:* iOS Safari reloads background tabs.
- Default "max speakers" raised from 4 to 8. *Why:* since v5 the value was no longer sent to Gemini; it only hid
  voices after the fact.

## v6 — 2026-10-19
- Version label in title and footer; the page fetches `version.json` (uncached) on open/focus and shows a Reload
  banner when a newer version is deployed. Scripts are loaded with `?v=N` so Safari cannot mix versions.

## v5 — 2026-10-19
- **Switched transcription to the Interactions API** (`POST /v1beta/interactions`) with `transcription_config`
  (diarization + word timestamps); per-word `word_info` annotations are grouped into speaker turns.
  *Why:* the first real run failed with `400 "JSON mode is not enabled for this model"` — gemini-3.5-transcribe
  does not support `generateContent` JSON mode. The request/response shapes were taken from the google-genai
  Python SDK 2.x source and Google's "Get_started_transcribe" cookbook notebook (ai.google.dev was unreachable).

## v4 — 2026-10-19
- File picker accepts any audio (`audio/*`, `.qta`, …) and QuickTime-style files; version stamp in the title.
  *Why:* Voice Memos files were greyed out in the iOS picker.

## v3 — 2026-10-19 (no in-app label yet)
- **M4A / Voice Memos support:** reads the MP4 sample tables and re-wraps AAC frames as ADTS (`audio/aac`) pieces,
  without decoding. *Why:* Voice Memos record M4A; decoding hours of audio in Safari would use gigabytes of memory.
  Lossless (ALAC) recordings are rejected with a hint to switch Voice Memos to "Compressed".

## v2 — 2026-10-19 (no in-app label yet)
- **Speaker matching across pieces:** labels in each later piece are mapped by counting words both pieces
  transcribed in the overlap (≥ 5 shared words and a 2× lead over the runner-up); leftovers go to an optional
  text-only AI resolver.

## v1 — 2026-10-19 (no in-app label yet)
- Static page for iPhone Safari (GitHub Pages). MP3 parsed from frame headers and split at frame boundaries into
  equal pieces of ≤ 28 min with 90 s overlap: `n = ceil((D − o) / (28 min − o))`, `len = (D + (n − 1)·o) / n`
  (64 min → 3 × 22:20). *Why:* Gemini allows speaker labels only on ≤ 30 min of audio per request; equal pieces
  avoid a short tail, the overlap lets pieces be joined (each overlap is cut at its midpoint) and speakers matched.
- API key stored only in the browser (localStorage); no server. A key-holding server function was discussed and
  deliberately postponed (single user; restrict the key to the Pages domain and set a budget instead).
