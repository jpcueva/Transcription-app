# Transcription app

Static web page for iPhone Safari: pick an MP3, it is split on the phone into overlapping pieces
(max 28 min, 90 s overlap by default), each piece is transcribed with Gemini (speaker labels + timestamps),
and the pieces are joined into one timeline. Export as TXT or SRT.

## Files
- `index.html` – the UI (no build step)
- `mp3split.js` – reads MP3 frame headers, plans equal-length overlapping pieces, returns byte ranges (no decoding)
- `transcript.js` – timestamp shifting, joining pieces at overlap midpoints, TXT/SRT export
- `gemini.js` – the only file that calls the Gemini API (**unverified against the gemini-3.5-transcribe docs**, see header comment)

## Run
Serve the folder over HTTPS (needed for the iPhone clipboard / home-screen install), e.g. GitHub Pages, or locally
`npx http-server .`. The API key is stored in the browser's localStorage on the device only.

## Test
`node --test test/*.test.js`

## Not yet built
Cross-piece speaker matching (labels currently show `Speaker N (part K)`), speaker renaming,
resume after interruption, optional key-holding server function.
