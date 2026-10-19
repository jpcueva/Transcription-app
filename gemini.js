/*
 * gemini.js - the ONLY file that talks to the Gemini API.
 *
 * UNVERIFIED: written without access to the gemini-3.5-transcribe docs page. The Files API upload and
 * generateContent shapes below follow the standard Gemini API. If the transcribe model wants different
 * fields (a dedicated diarization / timestamp config, another endpoint, a different response shape),
 * change transcribePiece() only; the rest of the app just needs [{start, end, speaker, text}] back.
 */
(function (root) {
  'use strict';

  var BASE = 'https://generativelanguage.googleapis.com';

  var PROMPT =
    'Transcribe this audio verbatim, in the language spoken. Label who is speaking in every segment ' +
    'using consistent labels ("Speaker 1", "Speaker 2", ...). Use at most {max} distinct speakers; ' +
    'use "Unidentified speaker" for any voice beyond that or whenever you cannot tell. ' +
    'Give each segment start and end timestamps as MM:SS or HH:MM:SS from the start of this audio. ' +
    'Return only JSON: an array of {"start","end","speaker","text"}.';

  var SCHEMA = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        start: { type: 'STRING' },
        end: { type: 'STRING' },
        speaker: { type: 'STRING' },
        text: { type: 'STRING' }
      },
      required: ['start', 'speaker', 'text']
    }
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function check(res, what) {
    if (res.ok) return res;
    return res.text().then(function (t) {
      var e = new Error(what + ' failed (' + res.status + '): ' + t.slice(0, 300));
      e.status = res.status;
      throw e;
    });
  }

  // Multipart upload keeps this to one request and avoids reading custom response headers (CORS).
  function uploadFile(key, blob, displayName) {
    var boundary = 'b' + Math.random().toString(36).slice(2);
    var meta = JSON.stringify({ file: { display_name: displayName } });
    var body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n',
      '--' + boundary + '\r\nContent-Type: ' + (blob.type || 'audio/mpeg') + '\r\n\r\n',
      blob,
      '\r\n--' + boundary + '--'
    ]);
    return fetch(BASE + '/upload/v1beta/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: body
    }).then(function (r) { return check(r, 'Upload'); })
      .then(function (r) { return r.json(); })
      .then(function (j) { return j.file; });
  }

  function waitActive(key, file) {
    function poll(f, tries) {
      if (f.state === 'ACTIVE' || !f.state) return Promise.resolve(f);
      if (f.state === 'FAILED') return Promise.reject(new Error('File processing failed'));
      if (tries > 90) return Promise.reject(new Error('File processing timed out'));
      return sleep(2000)
        .then(function () { return fetch(BASE + '/v1beta/' + f.name, { headers: { 'x-goog-api-key': key } }); })
        .then(function (r) { return check(r, 'File status'); })
        .then(function (r) { return r.json(); })
        .then(function (n) { return poll(n, tries + 1); });
    }
    return poll(file, 0);
  }

  function generate(key, model, file, maxSpeakers) {
    var body = {
      contents: [{
        parts: [
          { text: PROMPT.replace('{max}', String(maxSpeakers)) },
          { fileData: { mimeType: file.mimeType || 'audio/mpeg', fileUri: file.uri } }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 }
    };
    return fetch(BASE + '/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return check(r, 'Transcription'); })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var c = j.candidates && j.candidates[0];
        var text = c && c.content && c.content.parts && c.content.parts.map(function (p) { return p.text || ''; }).join('');
        if (!text) throw new Error('Empty response' + (c && c.finishReason ? ' (' + c.finishReason + ')' : ''));
        var data = JSON.parse(text);
        return Array.isArray(data) ? data : data.segments || [];
      });
  }

  // Retry transient failures (rate limit / server errors / bad JSON) with backoff.
  function retry(fn, tries) {
    var attempt = 0;
    function run() {
      return fn().catch(function (e) {
        var transient = !e.status || e.status === 429 || e.status >= 500;
        if (!transient || ++attempt >= tries) throw e;
        return sleep(1500 * Math.pow(2, attempt)).then(run);
      });
    }
    return run();
  }

  /** @returns Promise<[{start, end, speaker, text}]> with times relative to the start of `blob`. */
  function transcribePiece(opts) {
    return retry(function () { return uploadFile(opts.key, opts.blob, opts.name); }, 3)
      .then(function (f) { return waitActive(opts.key, f); })
      .then(function (f) { return retry(function () { return generate(opts.key, opts.model, f, opts.maxSpeakers); }, 3); });
  }

  root.Gemini = { transcribePiece: transcribePiece };
})(typeof self !== 'undefined' ? self : this);
