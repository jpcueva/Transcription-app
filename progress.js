/*
 * progress.js - keep per-piece results and the edited transcript so an interrupted run can resume.
 * Storage is injected (localStorage in the page, a Map-like object in tests); every call is failure-safe.
 */
(function (root) {
  'use strict';

  var INDEX = 'tx:index', KEEP = 5;

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /** Results depend on the file and on everything that changes how it is cut or transcribed. */
  function fingerprint(file, s) {
    return 'tx:' + hash([file.name, file.size, file.lastModified, s.maxSec, s.overlapSec, s.model].join('|'));
  }

  function read(st, fp) {
    try {
      var raw = st.getItem(fp);
      var d = raw ? JSON.parse(raw) : null;
      return d && typeof d === 'object' ? { pieces: d.pieces || {}, final: d.final || null, t: d.t || 0 } : { pieces: {}, final: null, t: 0 };
    } catch (e) { return { pieces: {}, final: null, t: 0 }; }
  }

  function touchIndex(st, fp) {
    var list = [];
    try { list = JSON.parse(st.getItem(INDEX) || '[]'); } catch (e) {}
    list = list.filter(function (x) { return x !== fp; });
    list.push(fp);
    while (list.length > KEEP) { try { st.removeItem(list.shift()); } catch (e) {} }
    try { st.setItem(INDEX, JSON.stringify(list)); } catch (e) {}
  }

  function write(st, fp, data) {
    data.t = Date.now();
    var json = JSON.stringify(data);
    try { st.setItem(fp, json); touchIndex(st, fp); return true; }
    catch (e) {
      // Storage full: drop everything else we saved and try once more.
      try {
        JSON.parse(st.getItem(INDEX) || '[]').forEach(function (x) { if (x !== fp) st.removeItem(x); });
        st.setItem(fp, json); touchIndex(st, fp); return true;
      } catch (e2) { return false; }
    }
  }

  function load(st, fp) { return read(st, fp); }
  function savePiece(st, fp, index, result) { var d = read(st, fp); d.pieces[index] = result; return write(st, fp, d); }
  function saveFinal(st, fp, segments) { var d = read(st, fp); d.final = segments; return write(st, fp, d); }
  function clear(st, fp) {
    try { st.removeItem(fp); } catch (e) {}
    try { st.setItem(INDEX, JSON.stringify(JSON.parse(st.getItem(INDEX) || '[]').filter(function (x) { return x !== fp; }))); } catch (e) {}
  }

  var api = { fingerprint: fingerprint, load: load, savePiece: savePiece, saveFinal: saveFinal, clear: clear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Progress = api;
})(typeof self !== 'undefined' ? self : this);
