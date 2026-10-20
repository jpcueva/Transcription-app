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

  /**
   * Split one line at a character position of `text` (the line's current, possibly edited text). Both halves keep
   * the speaker; the split time is estimated from the share of characters before the cut. Returns the same array
   * when either half would be empty.
   */
  function splitLine(segments, index, text, pos) {
    var s = segments[index];
    if (!s) return segments;
    var tidy = function (t) { return t.replace(/\s+/g, ' ').trim(); };
    var a = tidy(String(text).slice(0, pos)), b = tidy(String(text).slice(pos));
    if (!a || !b) return segments;
    var end = s.end > s.start ? s.end : s.start;
    var cut = s.start + (end - s.start) * (a.length / (a.length + b.length));
    var first = Object.assign({}, s, { text: a, end: cut, edited: true });
    var second = Object.assign({}, s, { text: b, start: cut, end: end, edited: true });
    delete first.ok; delete second.ok;
    return segments.slice(0, index).concat([first, second], segments.slice(index + 1));
  }

  /** Mark a line as reviewed so quality flags no longer show for it. */
  function markOk(segments, index) {
    if (!segments[index] || segments[index].ok) return segments;
    return segments.map(function (s, i) { return i === index ? Object.assign({}, s, { ok: true }) : s; });
  }

  /**
   * Apply the best suggested name to every still-numbered speaker ("Speaker 4"). Names the user already gave and
   * "Unidentified speaker" are left alone. Two speakers given the same name are merged, as with a manual rename.
   * @param suggestions {label: [{name}]} best first
   * @returns {{segments, applied: [{from, to}]}}
   */
  function applyNames(segments, suggestions) {
    var applied = [], out = segments;
    stats(segments).forEach(function (sp) {
      if (!/^Speaker \d+$/.test(sp.label)) return;
      var best = (suggestions && suggestions[sp.label] || [])[0];
      var name = best && clean(best.name);
      if (!name || name === sp.label) return;
      out = rename(out, sp.label, name);
      applied.push({ from: sp.label, to: name });
    });
    return { segments: out, applied: applied };
  }

  /** Remove one line. */
  function removeLine(segments, index) {
    if (!segments[index]) return segments;
    return segments.filter(function (s, i) { return i !== index; });
  }

  /** A few representative lines of a speaker, so the person can recognise who it is. */
  function sampleLines(segments, label, count, maxChars) {
    return segments.filter(function (s) { return s.speaker === label && words(s.text) >= 4; })
      .slice(0, count)
      .map(function (s) { return { start: s.start, text: s.text.length > maxChars ? s.text.slice(0, maxChars - 1) + '…' : s.text }; });
  }

  var api = { clean: clean, stats: stats, rename: rename, moveLine: moveLine, editText: editText, splitLine: splitLine, markOk: markOk, applyNames: applyNames, removeLine: removeLine, sampleLines: sampleLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Edits = api;
})(typeof self !== 'undefined' ? self : this);
