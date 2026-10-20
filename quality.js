/*
 * quality.js - flag transcript lines that are probably model mistakes, so the person can review them.
 *   - "fast": more words than anyone can say in that time (typical speech is 2-4 words/s), which is what a
 *     hallucinated or repeated passage squeezed into a short gap looks like.
 *   - "repeat": the line mostly repeats text that already appeared earlier in the transcript.
 * Lines marked reviewed (segment.ok === true) are never flagged. Works in the browser (window.Quality) and Node.
 */
(function (root) {
  'use strict';

  var MAX_WPS = 6;        // words per second above which a line is flagged
  var MIN_WORDS = 12;     // short lines ("Yes.", names) have unreliable timing; ignore them
  var SHINGLE = 5;        // words per n-gram for repeat detection
  var REPEAT_SHARE = 0.6; // share of a line's n-grams seen earlier that counts as a repeat
  var REPEAT_MIN_WORDS = 20; // short lines reuse stock phrases ("thank you very much for your time")

  function words(text) { return String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) || []; }

  function shingles(w) {
    var out = [];
    for (var i = 0; i + SHINGLE <= w.length; i++) out.push(w.slice(i, i + SHINGLE).join(' '));
    return out;
  }

  /** @returns {Object<number, {reasons: string[], wps?: number}>} flags by segment index */
  function flags(segments) {
    var out = {}, seen = {};
    segments.forEach(function (s, i) {
      var w = words(s.text), reasons = [], info = {};
      if (!s.ok && w.length >= MIN_WORDS) {
        var next = segments[i + 1];
        var span = s.end > s.start ? s.end - s.start : next && next.start > s.start ? next.start - s.start : 0;
        if (span > 0 && w.length / span > MAX_WPS) { reasons.push('fast'); info.wps = Math.round(w.length / span); }
      }
      var sh = shingles(w);
      if (!s.ok && w.length >= REPEAT_MIN_WORDS) {
        var hit = sh.filter(function (x) { return seen[x]; }).length;
        if (hit / sh.length >= REPEAT_SHARE) reasons.push('repeat');
      }
      sh.forEach(function (x) { seen[x] = 1; });
      if (reasons.length) { info.reasons = reasons; out[i] = info; }
    });
    return out;
  }

  function describe(f) {
    return f.reasons.map(function (r) {
      return r === 'fast' ? 'very fast speech (' + f.wps + ' words/s)' : 'repeats earlier text';
    }).join(' · ');
  }

  var api = { flags: flags, describe: describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Quality = api;
})(typeof self !== 'undefined' ? self : this);
