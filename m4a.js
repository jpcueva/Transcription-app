/*
 * m4a.js - read an M4A/MP4 audio file's frame index and cut it into ADTS .aac pieces, no decoding.
 * Works in the browser (window.M4a) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var FREQ_INDEX = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

  function u32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
  function u16(b, i) { return (b[i] << 8) | b[i + 1]; }
  function type4(b, i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); }

  // Child boxes in [start, end): {type, body, end} where body is the first byte after the box header.
  function boxes(b, start, end) {
    var out = [], p = start;
    while (p + 8 <= end) {
      var size = u32(b, p), hdr = 8;
      if (size === 1) { size = u32(b, p + 8) * 4294967296 + u32(b, p + 12); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      out.push({ type: type4(b, p + 4), body: p + hdr, end: p + size });
      p += size;
    }
    return out;
  }

  function child(b, parent, type) {
    var list = boxes(b, parent.body, parent.end);
    for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i];
    return null;
  }

  // MPEG-4 descriptors use a 1-byte tag and a 1-4 byte length (7 bits each, high bit = more).
  function descriptor(b, p, end) {
    if (p >= end) return null;
    var tag = b[p++], len = 0, n = 0, c;
    do { c = b[p++]; len = (len << 7) | (c & 0x7f); n++; } while (c & 0x80 && n < 4 && p < end);
    return { tag: tag, body: p, end: Math.min(end, p + len) };
  }

  // esds -> AudioSpecificConfig
  function readEsds(b, esds) {
    var p = esds.body + 4; // version + flags
    var es = descriptor(b, p, esds.end);
    if (!es || es.tag !== 0x03) throw new Error('Unsupported audio description (no ES descriptor)');
    p = es.body + 2; // ES_ID
    var flags = b[p++];
    if (flags & 0x80) p += 2;
    if (flags & 0x40) p += 1 + b[p];
    if (flags & 0x20) p += 2;
    var dc = descriptor(b, p, es.end);
    if (!dc || dc.tag !== 0x04) throw new Error('Unsupported audio description (no decoder config)');
    if (b[dc.body] !== 0x40) throw new Error('This M4A does not contain AAC audio');
    var asc = descriptor(b, dc.body + 13, dc.end);
    if (!asc || asc.tag !== 0x05) throw new Error('Unsupported audio description (no AudioSpecificConfig)');
    var bits = (b[asc.body] << 8) | b[asc.body + 1];
    var aot = bits >> 11, freq = (bits >> 7) & 15, chan = (bits >> 3) & 15;
    if (aot < 1 || aot > 4) throw new Error('Unsupported AAC profile (' + aot + '); only AAC-LC voice recordings are supported');
    if (freq >= FREQ_INDEX.length) throw new Error('Unsupported sample rate in this M4A');
    if (chan < 1 || chan > 7) throw new Error('Unsupported channel layout in this M4A');
    return { profile: aot - 1, freqIndex: freq, sampleRate: FREQ_INDEX[freq], channels: chan };
  }

  /**
   * @param {Uint8Array} b whole file
   * @returns {{offsets: Float64Array, sizes: Uint32Array, count: number, sampleRate: number, channels: number,
   *            profile: number, freqIndex: number, frameSec: number, durationSec: number}}
   */
  function parse(b) {
    var top = boxes(b, 0, b.length);
    if (!top.length || top[0].type !== 'ftyp') throw new Error('Not an M4A/MP4 file');
    var moov = top.filter(function (x) { return x.type === 'moov'; })[0];
    if (!moov) throw new Error('This recording has no index (moov). It may be unfinished or damaged.');

    var stbl = null, mdhd = null;
    boxes(b, moov.body, moov.end).forEach(function (trak) {
      if (stbl || trak.type !== 'trak') return;
      var mdia = child(b, trak, 'mdia');
      var hdlr = mdia && child(b, mdia, 'hdlr');
      if (!hdlr || type4(b, hdlr.body + 8) !== 'soun') return;
      var minf = child(b, mdia, 'minf');
      stbl = minf && child(b, minf, 'stbl');
      mdhd = child(b, mdia, 'mdhd');
    });
    if (!stbl || !mdhd) throw new Error('No audio track found in this file');

    var timescale = u32(b, mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));

    // Sample description
    var stsd = child(b, stbl, 'stsd');
    if (!stsd) throw new Error('Missing sample description');
    var entry = boxes(b, stsd.body + 8, stsd.end)[0];
    if (!entry) throw new Error('Missing sample description');
    if (entry.type === 'alac') throw new Error('This recording is lossless (ALAC). In Settings > Voice Memos set Audio Quality to Compressed.');
    if (entry.type !== 'mp4a') throw new Error('Unsupported audio format "' + entry.type + '"; expected AAC (mp4a)');
    var qtVersion = u16(b, entry.body + 8);
    var extra = qtVersion === 1 ? 16 : qtVersion === 2 ? 36 : 0;
    var esdsWrap = boxes(b, entry.body + 28 + extra, entry.end).filter(function (x) { return x.type === 'esds'; })[0];
    if (!esdsWrap) throw new Error('Missing AAC configuration (esds)');
    var cfg = readEsds(b, esdsWrap);

    // Frame sizes
    var stsz = child(b, stbl, 'stsz');
    if (!stsz) throw new Error('Missing sample sizes');
    var fixed = u32(b, stsz.body + 4), count = u32(b, stsz.body + 8);
    if (!count) throw new Error('This recording contains no audio');
    var sizes = new Uint32Array(count);
    for (var i = 0; i < count; i++) sizes[i] = fixed || u32(b, stsz.body + 12 + i * 4);

    // Chunk offsets
    var co = child(b, stbl, 'stco'), wide = false;
    if (!co) { co = child(b, stbl, 'co64'); wide = true; }
    var stsc = child(b, stbl, 'stsc');
    if (!co || !stsc) throw new Error('Missing chunk table');
    var chunks = u32(b, co.body + 4);
    var runs = u32(b, stsc.body + 4), first = [], per = [];
    for (i = 0; i < runs; i++) { first.push(u32(b, stsc.body + 8 + i * 12)); per.push(u32(b, stsc.body + 12 + i * 12)); }

    var offsets = new Float64Array(count), s = 0, run = 0;
    for (var c = 1; c <= chunks && s < count; c++) {
      while (run + 1 < runs && first[run + 1] <= c) run++;
      var off = wide ? u32(b, co.body + 8 + (c - 1) * 8) * 4294967296 + u32(b, co.body + 12 + (c - 1) * 8)
                     : u32(b, co.body + 8 + (c - 1) * 4);
      for (var k = 0; k < per[run] && s < count; k++) {
        offsets[s] = off;
        off += sizes[s];
        s++;
      }
    }
    if (s < count) throw new Error('Frame index is inconsistent; the file may be damaged');
    if (offsets[count - 1] + sizes[count - 1] > b.length) throw new Error('This recording looks cut off (frames missing from the file)');

    // Duration
    var stts = child(b, stbl, 'stts');
    if (!stts) throw new Error('Missing timing table');
    var n = u32(b, stts.body + 4), ticks = 0;
    for (i = 0; i < n; i++) ticks += u32(b, stts.body + 8 + i * 8) * u32(b, stts.body + 12 + i * 8);
    var durationSec = ticks / timescale;
    if (!(durationSec > 0)) throw new Error('Could not read the duration of this recording');

    return {
      offsets: offsets, sizes: sizes, count: count, sampleRate: cfg.sampleRate, channels: cfg.channels,
      profile: cfg.profile, freqIndex: cfg.freqIndex, frameSec: durationSec / count, durationSec: durationSec
    };
  }

  /** Frames for [startSec, endSec) as an ADTS stream. Returns the frame-aligned times actually used. */
  function cut(b, info, startSec, endSec) {
    var s = Math.min(info.count - 1, Math.max(0, Math.round(startSec / info.frameSec)));
    var e = Math.min(info.count, Math.max(s + 1, Math.round(endSec / info.frameSec)));
    var total = 0, i;
    for (i = s; i < e; i++) total += info.sizes[i] + 7;
    var out = new Uint8Array(total), p = 0;
    for (i = s; i < e; i++) {
      var len = info.sizes[i] + 7;
      if (len > 8191) throw new Error('AAC frame too large for ADTS');
      out[p] = 0xff;
      out[p + 1] = 0xf1;
      out[p + 2] = (info.profile << 6) | (info.freqIndex << 2) | ((info.channels >> 2) & 1);
      out[p + 3] = ((info.channels & 3) << 6) | ((len >> 11) & 3);
      out[p + 4] = (len >> 3) & 0xff;
      out[p + 5] = ((len & 7) << 5) | 0x1f;
      out[p + 6] = 0xfc;
      out.set(b.subarray(info.offsets[i], info.offsets[i] + info.sizes[i]), p + 7);
      p += len;
    }
    return { data: out, actualStartSec: s * info.frameSec, actualEndSec: e * info.frameSec };
  }

  var api = { parse: parse, cut: cut };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.M4a = api;
})(typeof self !== 'undefined' ? self : this);
