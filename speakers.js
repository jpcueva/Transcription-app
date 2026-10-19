/*
 * speakers.js - give speakers consistent labels across independently transcribed pieces.
 *
 * Each piece comes back with its own labels ("Speaker 1" in piece 2 may be "Speaker 2" in piece 1).
 * Consecutive pieces share an overlap, so both transcribe the same words there. For every label in
 * the later piece we count which already-resolved label said the same words in the overlap.
 * Labels with no clear winner go to an optional text-only resolver, and otherwise become
 * "Unidentified speaker". Works in the browser (window.Speakers) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var UNID = 'Unidentified speaker';
  var MIN_VOTE = 5;       // matched words needed before we trust a mapping
  var DOMINANCE = 2;      // winner must have at least this many times the runner-up's votes
  var WINDOW_SLACK = 5;   // seconds of timestamp slack around the overlap
  var MAX_START_GAP = 20; // seconds: segments further apart than this are not the same utterance

  function isUnid(label) { return !label || /^\s*(unidentified|unknown)/i.test(label); }

  function tokens(text) {
    var m = String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
    var set = {}, n = 0;
    m.forEach(function (w) { if (!set[w]) { set[w] = 1; n++; } });
    return { set: set, n: n };
  }

  function shared(a, b) {
    var c = 0;
    for (var w in a.set) if (b.set[w]) c++;
    return c;
  }

  function inWindow(seg, from, to) { return seg.start >= from - WINDOW_SLACK && seg.start <= to + WINDOW_SLACK; }

  // votes[curLabel][prevLabel] = number of shared words
  function tally(prevSegs, curSegs, from, to) {
    var prev = prevSegs.filter(function (s) { return !isUnid(s.speaker) && inWindow(s, from, to); })
      .map(function (s) { return { s: s, t: tokens(s.text) }; });
    var votes = {};
    curSegs.forEach(function (b) {
      if (isUnid(b.speaker) || !inWindow(b, from, to)) return;
      var tb = tokens(b.text);
      if (tb.n < 3) return;
      prev.forEach(function (p) {
        if (Math.abs(p.s.start - b.start) > MAX_START_GAP || p.t.n < 3) return;
        var inter = shared(p.t, tb);
        if (inter >= 3 && inter / Math.min(p.t.n, tb.n) >= 0.6) {
          var row = votes[b.speaker] || (votes[b.speaker] = {});
          row[p.s.speaker] = (row[p.s.speaker] || 0) + inter;
        }
      });
    });
    return votes;
  }

  function decide(labels, votes) {
    var mapping = {}, unresolved = [];
    labels.forEach(function (label) {
      var row = votes[label] || {};
      var ranked = Object.keys(row).sort(function (a, b) { return row[b] - row[a]; });
      var best = ranked[0], second = ranked[1];
      if (best && row[best] >= MIN_VOTE && (!second || row[best] >= DOMINANCE * row[second])) mapping[label] = best;
      else unresolved.push(label);
    });
    return { mapping: mapping, unresolved: unresolved };
  }

  function samplesFor(segs, label, count) {
    return segs.filter(function (s) { return s.speaker === label && tokens(s.text).n >= 6; })
      .sort(function (a, b) { return b.text.length - a.text.length; })
      .slice(0, count)
      .sort(function (a, b) { return a.start - b.start; })
      .map(function (s) { return { start: s.start, text: s.text.slice(0, 200) }; });
  }

  function nextLabel(known) {
    for (var n = 1; ; n++) if (known.indexOf('Speaker ' + n) < 0) return 'Speaker ' + n;
  }

  /**
   * @param pieces [{startSec, endSec, segments:[{start,end,speaker,text}]}] on the global clock
   * @param opts   {resolver?: async ({canonical:[{label,samples}], unresolved:[{label,samples}]}) => {label: match}}
   *               match is a canonical label, "NEW" (a person not heard before) or anything else = unknown
   * @returns {Promise<{pieces, warnings}>} pieces with `speaker` canonicalised and `rawSpeaker` kept
   */
  function resolve(pieces, opts) {
    opts = opts || {};
    var out = [], registry = {}, warnings = [];

    function finish(i, mapping) {
      var segs = pieces[i].segments.map(function (s) {
        var m = isUnid(s.speaker) ? UNID : mapping[s.speaker] || UNID;
        return Object.assign({}, s, { speaker: m, rawSpeaker: s.speaker });
      });
      out.push({ startSec: pieces[i].startSec, endSec: pieces[i].endSec, segments: segs });
      Object.keys(registry).concat(segs.map(function (s) { return s.speaker; })).forEach(function (l) {
        if (isUnid(l)) return;
        var fresh = samplesFor(segs, l, 3);
        if (fresh.length || !registry[l]) registry[l] = fresh;
      });
    }

    function step(i) {
      if (i >= pieces.length) return Promise.resolve({ pieces: out, warnings: warnings });
      var segs = pieces[i].segments;
      var labels = [];
      segs.forEach(function (s) { if (!isUnid(s.speaker) && labels.indexOf(s.speaker) < 0) labels.push(s.speaker); });

      if (i === 0) {
        var id = {};
        labels.forEach(function (l) { id[l] = l; });
        finish(0, id);
        return step(1);
      }

      var from = pieces[i].startSec, to = pieces[i - 1].endSec;
      var d = decide(labels, tally(out[i - 1].segments, segs, from, to));
      if (!d.unresolved.length || !opts.resolver) {
        finish(i, d.mapping);
        return step(i + 1);
      }
      var request = {
        canonical: Object.keys(registry).map(function (l) { return { label: l, samples: registry[l] }; }),
        unresolved: d.unresolved.map(function (l) { return { label: l, samples: samplesFor(segs, l, 4) }; })
      };
      return Promise.resolve().then(function () { return opts.resolver(request); }).then(function (answer) {
        var known = Object.keys(registry);
        Object.keys(d.mapping).forEach(function (k) { if (known.indexOf(d.mapping[k]) < 0) known.push(d.mapping[k]); });
        d.unresolved.forEach(function (l) {
          var a = answer && answer[l];
          if (a === 'NEW') { var nl = nextLabel(known); known.push(nl); d.mapping[l] = nl; }
          else if (a && Object.keys(registry).indexOf(a) >= 0) d.mapping[l] = a;
        });
      }).catch(function (e) {
        warnings.push('Speaker cleanup for part ' + (i + 1) + ' failed: ' + e.message);
      }).then(function () {
        finish(i, d.mapping);
        return step(i + 1);
      });
    }

    return step(0);
  }

  /** If more than maxSpeakers distinct speakers remain, the quietest ones become "Unidentified speaker". */
  function capSpeakers(segments, maxSpeakers) {
    var words = {};
    segments.forEach(function (s) { if (!isUnid(s.speaker)) words[s.speaker] = (words[s.speaker] || 0) + tokens(s.text).n; });
    var keep = Object.keys(words).sort(function (a, b) { return words[b] - words[a]; }).slice(0, maxSpeakers);
    return segments.map(function (s) {
      return isUnid(s.speaker) || keep.indexOf(s.speaker) >= 0 ? s : Object.assign({}, s, { speaker: UNID });
    });
  }

  var api = { UNID: UNID, resolve: resolve, capSpeakers: capSpeakers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Speakers = api;
})(typeof self !== 'undefined' ? self : this);
