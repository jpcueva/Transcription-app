/*
 * audiofile.js - one interface over the MP3 and M4A splitters.
 *   open(bytes) -> {kind, mime, ext, durationSec, cut(startSec, endSec) -> {data, actualStartSec, actualEndSec}}
 * The format is detected from the file contents, not the extension.
 */
(function (root) {
  'use strict';
  var mp3 = typeof require === 'function' && typeof module !== 'undefined' ? require('./mp3split.js') : root.Mp3Split;
  var m4a = typeof require === 'function' && typeof module !== 'undefined' ? require('./m4a.js') : root.M4a;

  function open(bytes) {
    if (bytes.length > 12 && /^(ftyp|moov|mdat|wide|free|skip)$/.test(String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]))) {
      var a = m4a.parse(bytes);
      return {
        kind: 'aac', mime: 'audio/aac', ext: 'aac', durationSec: a.durationSec,
        cut: function (s, e) { return m4a.cut(bytes, a, s, e); }
      };
    }
    var m = mp3.parse(bytes);
    return {
      kind: 'mp3', mime: 'audio/mpeg', ext: 'mp3', durationSec: m.durationSec,
      cut: function (s, e) {
        var r = mp3.byteRange(m, s, e);
        return { data: bytes.subarray(r.startByte, r.endByte), actualStartSec: r.actualStartSec, actualEndSec: r.actualEndSec };
      }
    };
  }

  var api = { open: open, plan: mp3.plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AudioFile = api;
})(typeof self !== 'undefined' ? self : this);
