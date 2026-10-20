/*
 * gemini.js - the ONLY file that talks to the Gemini API.
 *
 * Transcription uses the Interactions API (POST /v1beta/interactions), which is what gemini-3.5-transcribe
 * expects; it does not accept generateContent's JSON mode. Field names follow the google-genai SDK
 * (2.x) and the Gemini cookbook "Get_started_transcribe" notebook. Speaker labels and timestamps come
 * back as per-word "word_info" annotations, which wordsToSegments() groups into speaker turns.
 */
(function (root) {
  'use strict';

  var BASE = 'https://generativelanguage.googleapis.com';

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

  function seconds(v) {
    if (v == null) return null;
    var n = parseFloat(String(v));
    return isFinite(n) ? n : null;
  }

  // "spk:0" / "spk_1" -> "Speaker 1", "Speaker 2", ... in order of first appearance within this piece.
  function speakerNamer() {
    var seen = {}, n = 0;
    return function (raw) {
      if (!raw) return '';
      if (!seen[raw]) seen[raw] = 'Speaker ' + ++n;
      return seen[raw];
    };
  }

  /**
   * Interaction response -> [{start, end, speaker, text}] (seconds from the start of the piece).
   * A new segment starts when the speaker changes, after a pause > 1.5 s, or after a sentence once a
   * segment is longer than 30 s.
   */
  function wordsToSegments(interaction) {
    var name = speakerNamer(), segs = [], cur = null;
    var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

    function close() {
      if (!cur) return;
      var text = cur.words.join(' ');
      if (enc && dec && cur.bytes && cur.firstIdx != null && cur.lastIdx != null && cur.lastIdx > cur.firstIdx) {
        text = dec.decode(cur.bytes.subarray(cur.firstIdx, cur.lastIdx));
      }
      segs.push({ start: cur.start, end: cur.end, speaker: cur.speaker, text: text.trim() });
      cur = null;
    }

    (interaction.steps || []).forEach(function (step) {
      (step.content || []).forEach(function (item) {
        var bytes = enc && item.text ? enc.encode(item.text) : null;
        (item.annotations || []).forEach(function (a) {
          if (a.type !== 'word_info' || !a.text) return;
          var start = seconds(a.start_offset), end = seconds(a.end_offset);
          if (start == null) return;
          var who = name(a.speaker);
          var sentenceEnd = cur && /[.!?]$/.test(cur.words[cur.words.length - 1]);
          if (cur && (who !== cur.speaker || start - cur.end > 1.5 || (cur.end - cur.start > 30 && sentenceEnd) || bytes !== cur.bytes)) close();
          if (!cur) cur = { start: start, end: end == null ? start : end, speaker: who, words: [], bytes: bytes, firstIdx: a.start_index, lastIdx: a.end_index };
          cur.words.push(a.text);
          cur.end = end == null ? cur.end : end;
          if (a.end_index != null) cur.lastIdx = a.end_index;
        });
        close();
      });
    });

    if (!segs.length) {
      var text = interaction.output_text || '';
      if (text.trim()) segs.push({ start: 0, end: 0, speaker: '', text: text.trim() });
    }
    return segs;
  }

  function interactionBody(model, file, mime, nested) {
    var opts = { diarization_mode: 'speaker', timestamp_granularities: ['word'] };
    var tc = nested ? { mode: Object.assign({ type: 'verbatim' }, opts) } : opts;
    return {
      model: model,
      input: [{ type: 'audio', uri: file.uri, mime_type: mime || file.mimeType || 'audio/mpeg' }],
      generation_config: { transcription_config: tc }
    };
  }

  function postInteraction(key, body) {
    return fetch(BASE + '/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return check(r, 'Transcription'); }).then(function (r) { return r.json(); });
  }

  // If the server answers before the work is done, poll until it finishes.
  function waitDone(key, it) {
    function poll(x, tries) {
      var st = x.status;
      if (!st || st === 'completed') return Promise.resolve(x);
      if (st !== 'in_progress' && st !== 'queued') {
        var msg = (x.errors && x.errors[0] && x.errors[0].message) || st;
        return Promise.reject(new Error('Transcription ' + st + ': ' + msg));
      }
      if (tries > 300 || !x.id) return Promise.reject(new Error('Transcription timed out'));
      return sleep(3000)
        .then(function () { return fetch(BASE + '/v1beta/interactions/' + encodeURIComponent(x.id), { headers: { 'x-goog-api-key': key } }); })
        .then(function (r) { return check(r, 'Transcription status'); })
        .then(function (r) { return r.json(); })
        .then(function (n) { return poll(n, tries + 1); });
    }
    return poll(it, 0);
  }

  // Current SDK puts diarization/timestamps under mode:{type:"verbatim"}; the cookbook puts them directly
  // in transcription_config. Try the current form first and fall back once if the server rejects it.
  function transcribe(key, model, file, mime) {
    return postInteraction(key, interactionBody(model, file, mime, true))
      .catch(function (e) {
        if (e.status !== 400) throw e;
        return postInteraction(key, interactionBody(model, file, mime, false));
      })
      .then(function (it) { return waitDone(key, it); })
      .then(wordsToSegments);
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
      .then(function (f) { return retry(function () { return transcribe(opts.key, opts.model, f, opts.blob.type); }, 3); });
  }

  // Text-only: decide which already-known speaker each unmatched label is. No audio is sent.
  function resolveSpeakers(opts) {
    var fmt = function (list) {
      return list.map(function (x) {
        return '## ' + x.label + '\n' + (x.samples.length ? x.samples.map(function (s) { return '- ' + s.text; }).join('\n') : '- (no sample lines)');
      }).join('\n\n');
    };
    var prompt =
      'Several people spoke in a long recording that was transcribed in separate parts, so speaker labels are not ' +
      'consistent between parts. Below are KNOWN speakers with sample lines, then UNMATCHED labels from a later part ' +
      'with their lines. For each unmatched label, answer with the exact known label ONLY when the text gives clear ' +
      'evidence that it is the same person: they are addressed by the same name, introduce themselves with that name, ' +
      'or explicitly continue that person\'s own statement. Similar topics, vocabulary or speaking style are NOT ' +
      'enough. In every other case answer "NEW". Wrongly merging two different people is much worse than leaving ' +
      'one person split in two, so when in doubt answer "NEW".\n\n# KNOWN\n' + fmt(opts.canonical) + '\n\n# UNMATCHED\n' + fmt(opts.unresolved);
    var schema = {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, match: { type: 'STRING' } }, required: ['label', 'match'] }
    };
    return retry(function () {
      return fetch(BASE + '/v1beta/models/' + encodeURIComponent(opts.model) + ':generateContent', {
        method: 'POST',
        headers: { 'x-goog-api-key': opts.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 }
        })
      }).then(function (r) { return check(r, 'Speaker cleanup'); })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var c = j.candidates && j.candidates[0];
          var text = c && c.content && c.content.parts && c.content.parts.map(function (p) { return p.text || ''; }).join('');
          if (!text) throw new Error('Empty response');
          var out = {};
          JSON.parse(text).forEach(function (m) { out[m.label] = m.match; });
          return out;
        });
    }, 3);
  }


  // Text-only: suggest real names for each speaker label from what people say in the conversation.
  function suggestNames(opts) {
    var enc = function (t) { return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
    var lines = opts.segments.map(function (s) { return '[' + enc(s.start) + '] ' + s.speaker + ': ' + s.text; }).join('\n');
    if (lines.length > 400000) lines = lines.slice(0, 400000);
    var prompt =
      'Below is a transcript of a conversation with speaker labels. The labels were produced automatically and ' +
      'a few lines may be attributed to the wrong speaker. For each speaker label, suggest the real name of that ' +
      'person ONLY if the conversation itself supports it: they introduce themselves, someone addresses them by name ' +
      '(a host calling a name right before that person answers is strong evidence), or others refer to them. ' +
      'Never invent names, never use famous names that are merely discussed as a topic, and return an empty list ' +
      'when there is no evidence. At most 3 suggestions per speaker, best first. "evidence" is a short quote with ' +
      'its timestamp.\n\n# TRANSCRIPT\n' + lines;
    var schema = {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          names: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, evidence: { type: 'STRING' } }, required: ['name'] } }
        },
        required: ['label', 'names']
      }
    };
    return retry(function () {
      return fetch(BASE + '/v1beta/models/' + encodeURIComponent(opts.model) + ':generateContent', {
        method: 'POST',
        headers: { 'x-goog-api-key': opts.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 }
        })
      }).then(function (r) { return check(r, 'Name suggestions'); })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var c = j.candidates && j.candidates[0];
          var text = c && c.content && c.content.parts && c.content.parts.map(function (p) { return p.text || ''; }).join('');
          if (!text) throw new Error('Empty response');
          var out = {};
          JSON.parse(text).forEach(function (m) {
            var names = (m.names || []).filter(function (n) { return n && n.name && String(n.name).trim(); })
              .map(function (n) { return { name: String(n.name).trim().slice(0, 40), evidence: n.evidence ? String(n.evidence).slice(0, 160) : '' }; });
            if (m.label) out[m.label] = names.slice(0, 3);
          });
          return out;
        });
    }, 3);
  }

  var api = { transcribePiece: transcribePiece, resolveSpeakers: resolveSpeakers, suggestNames: suggestNames, wordsToSegments: wordsToSegments };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Gemini = api;
})(typeof self !== 'undefined' ? self : this);
