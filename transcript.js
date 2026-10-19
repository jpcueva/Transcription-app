/*
 * transcript.js - turn per-piece Gemini output into one timeline.
 * Works in the browser (window.Transcript) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  // Accepts 83, "83.5", "1:23", "01:23.5", "0:01:23".
  function parseTime(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    var parts = v.trim().split(':');
    if (!parts.length || parts.length > 3) return null;
    var sec = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = parseFloat(parts[i]);
      if (!isFinite(n)) return null;
      sec = sec * 60 + n;
    }
    return sec;
  }

  function formatTime(sec, withMs) {
    sec = Math.max(0, sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var ss = withMs ? s.toFixed(3).padStart(6, '0') : String(Math.floor(s)).padStart(2, '0');
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + ss;
  }

  // Raw model segments -> {start, end, speaker, text} on the piece's own clock, then shifted by offsetSec.
  function normalize(raw, offsetSec) {
    var out = [];
    (raw || []).forEach(function (r) {
      var start = parseTime(r.start);
      if (start == null || !r.text) return;
      var end = parseTime(r.end);
      out.push({
        start: start + offsetSec,
        end: (end == null ? start : end) + offsetSec,
        speaker: (r.speaker && String(r.speaker).trim()) || 'Unidentified speaker',
        text: String(r.text).trim()
      });
    });
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  /**
   * pieces: [{startSec, endSec, segments}] with segments already on the global clock.
   * Each overlap is split at its midpoint: the earlier piece owns everything before it,
   * the later piece everything from it on.
   */
  function join(pieces) {
    var out = [];
    pieces.forEach(function (p, i) {
      var from = i === 0 ? -Infinity : (pieces[i].startSec + pieces[i - 1].endSec) / 2;
      var to = i === pieces.length - 1 ? Infinity : (pieces[i + 1].startSec + p.endSec) / 2;
      p.segments.forEach(function (s) {
        if (s.start >= from && s.start < to) out.push(Object.assign({ piece: i }, s));
      });
    });
    return out;
  }

  function toText(segments) {
    return segments.map(function (s) {
      return '[' + formatTime(s.start) + '] ' + s.speaker + ': ' + s.text;
    }).join('\n');
  }

  function toSrt(segments) {
    return segments.map(function (s, i) {
      var end = s.end > s.start ? s.end : s.start + 2;
      var f = function (t) { return formatTime(t, true).replace('.', ','); };
      return (i + 1) + '\n' + f(s.start) + ' --> ' + f(end) + '\n' + s.speaker + ': ' + s.text + '\n';
    }).join('\n');
  }

  var api = { parseTime: parseTime, formatTime: formatTime, normalize: normalize, join: join, toText: toText, toSrt: toSrt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Transcript = api;
})(typeof self !== 'undefined' ? self : this);
