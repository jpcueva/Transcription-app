/*
 * speakers.js - give speakers consistent labels across independently transcribed pieces.
 *
 * Each piece comes back with its own labels ("Speaker 1" in piece 2 may be "Speaker 2" in piece 1).
 * Consecutive pieces share an overlap, so both transcribe the same words there. For every label in
 * the later piece we count which already-resolved label said the same words in the overlap.
 * Labels with no clear winner go to an optional text-only resolver; anything still unmatched gets the
 * next free number ("Speaker 6"). Splitting one person in two is fixed with one merge, while wrongly merging
 * two people is hard to undo, so every doubt resolves to a new number. "Unidentified speaker" is only used
 * when the model returned no speaker at all. Works in the browser (window.Speakers) and in Node (module.exports).
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

  // Last few lines of a speaker across everything resolved so far (shows e.g. "I need to drop off").
  function lastLines(segs, label, count) {
    return segs.filter(function (s) { return s.speaker === label; }).slice(-count)
      .map(function (s) { return { start: s.start, text: s.text.slice(0, 200) }; });
  }

  // The line said just before each of a speaker's first turns: hosts call people by name ("Juan, good question").
  function cuesFor(segs, label, mapping, count) {
    var out = [];
    for (var i = 1; i < segs.length && out.length < count; i++) {
      var s = segs[i], prev = segs[i - 1];
      if (s.speaker !== label || prev.speaker === label) continue;
      var who = isUnid(prev.speaker) ? 'unknown' : mapping[prev.speaker] || 'another unmatched speaker';
      out.push({ start: prev.start, speaker: who, text: prev.text.slice(-200) });
    }
    return out;
  }

  function nextLabel(known) {
    for (var n = 1; ; n++) if (known.indexOf('Speaker ' + n) < 0) return 'Speaker ' + n;
  }

  /**
   * @param pieces [{startSec, endSec, segments:[{start,end,speaker,text}]}] on the global clock
   * @param opts   {resolver?: async ({canonical:[{label,samples}], unresolved:[{label,samples}]}) => {label: match}}
   *               match is a canonical label; anything else ("NEW", "UNKNOWN") means a new numbered speaker
   * @returns {Promise<{pieces, warnings}>} pieces with `speaker` canonicalised and `rawSpeaker` kept
   */
  function resolve(pieces, opts) {
    opts = opts || {};
    var out = [], registry = {}, warnings = [];

    function finish(i, mapping) {
      var segs = pieces[i].segments.map(function (s) {
        var m = isUnid(s.speaker) ? UNID : mapping[s.speaker];
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

      // Every label still without a mapping becomes a new, unique number.
      function numberRest() {
        var known = Object.keys(registry);
        Object.keys(d.mapping).forEach(function (k) { if (known.indexOf(d.mapping[k]) < 0) known.push(d.mapping[k]); });
        labels.forEach(function (l) {
          if (d.mapping[l]) return;
          var nl = nextLabel(known); known.push(nl); d.mapping[l] = nl;
        });
      }

      if (!d.unresolved.length || !opts.resolver) {
        numberRest();
        finish(i, d.mapping);
        return step(i + 1);
      }
      var done = [];
      out.forEach(function (p) { done = done.concat(p.segments); });
      var request = {
        canonical: Object.keys(registry).map(function (l) {
          var last = lastLines(done, l, 2);
          return { label: l, samples: registry[l], lastLines: last, lastSeen: last.length ? last[last.length - 1].start : null };
        }),
        unresolved: d.unresolved.map(function (l) {
          var first = segs.filter(function (x) { return x.speaker === l; })[0];
          return { label: l, samples: samplesFor(segs, l, 4), firstSeen: first ? first.start : null, cues: cuesFor(segs, l, d.mapping, 4) };
        })
      };
      return Promise.resolve().then(function () { return opts.resolver(request); }).then(function (answer) {
        d.unresolved.forEach(function (l) {
          var a = answer && answer[l];
          if (a && Object.keys(registry).indexOf(a) >= 0) d.mapping[l] = a; // anything else ("NEW", "UNKNOWN", junk) -> new number
        });
      }).catch(function (e) {
        warnings.push('Speaker cleanup for part ' + (i + 1) + ' failed: ' + e.message);
      }).then(function () {
        numberRest();
        finish(i, d.mapping);
        return step(i + 1);
      });
    }

    return step(0);
  }

  var api = { UNID: UNID, resolve: resolve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Speakers = api;
})(typeof self !== 'undefined' ? self : this);
