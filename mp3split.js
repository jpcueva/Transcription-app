/*
 * mp3split.js - measure and split MP3 files at frame boundaries, no decoding.
 * Works in the browser (window.Mp3Split) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var BITRATES = {
    // [version][layer] -> kbps by bitrate index (0 = free, 15 = bad)
    '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  };
  var SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

  // Returns frame info for the header at offset i, or null if it is not a valid header.
  function readHeader(b, i) {
    if (i + 4 > b.length) return null;
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
    var versionBits = (b[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    var layerBits = (b[i + 1] >> 1) & 3; // 3 = L1, 2 = L2, 1 = L3
    if (versionBits === 1 || layerBits === 0) return null;
    var brIdx = (b[i + 2] >> 4) & 15;
    var srIdx = (b[i + 2] >> 2) & 3;
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
    var padding = (b[i + 2] >> 1) & 1;
    var layer = 4 - layerBits;
    var v = versionBits === 3 ? 1 : 2;
    var bitrate = BITRATES[v + '-' + layer][brIdx] * 1000;
    var sampleRate = SAMPLE_RATES[versionBits][srIdx];
    var samples, size;
    if (layer === 1) {
      samples = 384;
      size = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
    } else if (layer === 2) {
      samples = 1152;
      size = Math.floor((144 * bitrate) / sampleRate) + padding;
    } else {
      samples = versionBits === 3 ? 1152 : 576;
      size = Math.floor(((versionBits === 3 ? 144 : 72) * bitrate) / sampleRate) + padding;
    }
    if (size < 4) return null;
    return { size: size, samples: samples, sampleRate: sampleRate, layer: layer, versionBits: versionBits };
  }

  function id3v2Size(b) {
    if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
      var size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
      var footer = b[5] & 0x10 ? 10 : 0;
      return 10 + size + footer;
    }
    return 0;
  }

  // A Xing/Info frame is metadata, not audio.
  function isXingFrame(b, i, h) {
    var side = h.versionBits === 3 ? (((b[i + 3] >> 6) & 3) === 3 ? 17 : 32) : ((b[i + 3] >> 6) & 3) === 3 ? 9 : 17;
    var p = i + 4 + side;
    if (p + 4 > b.length) return false;
    var tag = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    return tag === 'Xing' || tag === 'Info';
  }

  /**
   * Scan the file and index every audio frame.
   * @param {Uint8Array} bytes
   * @returns {{frames: Uint32Array, sizes: Uint16Array, count: number, sampleRate: number,
   *            samplesPerFrame: number, frameSec: number, durationSec: number, audioStart: number}}
   */
  function parse(bytes) {
    var pos = id3v2Size(bytes);
    var audioStart = -1;
    var cap = Math.max(1024, Math.floor(bytes.length / 400));
    var offsets = new Uint32Array(cap);
    var sizes = new Uint16Array(cap);
    var n = 0;
    var sampleRate = 0;
    var samples = 0;
    var totalSamples = 0;

    while (pos + 4 <= bytes.length) {
      var h = readHeader(bytes, pos);
      // Require the next header to line up too, so stray 0xFFEx bytes in tags/junk are skipped.
      if (h && pos + h.size <= bytes.length) {
        var next = pos + h.size;
        var ok = next + 4 > bytes.length || readHeader(bytes, next) !== null;
        if (ok) {
          if (!sampleRate) {
            sampleRate = h.sampleRate;
            samples = h.samples;
          }
          if (h.sampleRate === sampleRate && !(n === 0 && isXingFrame(bytes, pos, h))) {
            if (audioStart < 0) audioStart = pos;
            if (n === offsets.length) {
              var no = new Uint32Array(n * 2);
              no.set(offsets);
              offsets = no;
              var ns = new Uint16Array(n * 2);
              ns.set(sizes);
              sizes = ns;
            }
            offsets[n] = pos;
            sizes[n] = h.size;
            n++;
            totalSamples += h.samples;
          }
          pos = next;
          continue;
        }
      }
      pos++;
    }
    if (!n) throw new Error('No MP3 audio frames found');
    return {
      frames: offsets,
      sizes: sizes,
      count: n,
      sampleRate: sampleRate,
      samplesPerFrame: samples,
      frameSec: samples / sampleRate,
      durationSec: totalSamples / sampleRate,
      audioStart: audioStart
    };
  }

  /**
   * Decide how to cut a recording. Pieces are equal length so there is never a short tail.
   * n = ceil((D - overlap) / (max - overlap)); len = (D + (n - 1) * overlap) / n
   */
  function plan(durationSec, opts) {
    opts = opts || {};
    var max = opts.maxSec || 28 * 60;
    var overlap = opts.overlapSec == null ? 90 : opts.overlapSec;
    if (overlap >= max) throw new Error('overlap must be smaller than the maximum piece length');
    if (durationSec <= max) return [{ index: 0, startSec: 0, endSec: durationSec }];
    var n = Math.ceil((durationSec - overlap) / (max - overlap));
    var len = (durationSec + (n - 1) * overlap) / n;
    var pieces = [];
    for (var i = 0; i < n; i++) {
      var start = i * (len - overlap);
      pieces.push({ index: i, startSec: start, endSec: i === n - 1 ? durationSec : start + len });
    }
    return pieces;
  }

  /**
   * Byte range covering the frames for [startSec, endSec).
   * Returns the real start time (frame aligned) so timestamps can be shifted exactly.
   */
  function byteRange(info, startSec, endSec) {
    var s = Math.min(info.count - 1, Math.max(0, Math.round(startSec / info.frameSec)));
    var e = Math.min(info.count, Math.max(s + 1, Math.round(endSec / info.frameSec)));
    return {
      startByte: info.frames[s],
      endByte: info.frames[e - 1] + info.sizes[e - 1],
      actualStartSec: s * info.frameSec,
      actualEndSec: e * info.frameSec
    };
  }

  var api = { parse: parse, plan: plan, byteRange: byteRange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mp3Split = api;
})(typeof self !== 'undefined' ? self : this);
