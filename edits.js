/*
 * edits.js - pure helpers for fixing speaker labels in a finished transcript.
 * Works in the browser (window.Edits) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var MAX_NAME = 40;

  function clean(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  }

  function words(text) { return (String(text).match(/[\p{L}\p{N}']+/gu) || []).length; }

  /** Speakers in order of first appearance: [{label, lines, words, first}] */
  function stats(segments) {
    var by = {}, order = [];
    segments.forEach(function (s) {
      var e = by[s.speaker];
      if (!e) { e = by[s.speaker] = { label: s.speaker, lines: 0, words: 0, first: s.start }; order.push(e); }
      e.lines++;
      e.words += words(s.text);
    });
    return order;
  }

  /** Rename every line of `from` to `to`. If `to` is another existing speaker the two are merged. */
  function rename(segments, from, to) {
    to = clean(to);
    if (!to || to === from) return segments;
    return segments.map(function (s) { return s.speaker === from ? Object.assign({}, s, { speaker: to }) : s; });
  }

  /** Move a single line to another speaker. */
  function moveLine(segments, index, to) {
    to = clean(to);
    if (!to || !segments[index] || segments[index].speaker === to) return segments;
    return segments.map(function (s, i) { return i === index ? Object.assign({}, s, { speaker: to }) : s; });
  }

  /** Replace the text of one line (whitespace tidied). Empty text is ignored; unchanged text is a no-op. */
  function editText(segments, index, text) {
    var t = String(text == null ? '' : text).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    if (!t || !segments[index] || segments[index].text === t) return segments;
    return segments.map(function (s, i) { return i === index ? Object.assign({}, s, { text: t, edited: true }) : s; });
  }

  /** A few representative lines of a speaker, so the person can recognise who it is. */
  function sampleLines(segments, label, count, maxChars) {
    return segments.filter(function (s) { return s.speaker === label && words(s.text) >= 4; })
      .slice(0, count)
      .map(function (s) { return { start: s.start, text: s.text.length > maxChars ? s.text.slice(0, maxChars - 1) + '…' : s.text }; });
  }

  var api = { clean: clean, stats: stats, rename: rename, moveLine: moveLine, editText: editText, sampleLines: sampleLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Edits = api;
})(typeof self !== 'undefined' ? self : this);
