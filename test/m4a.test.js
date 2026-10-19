const assert = require('node:assert/strict');
const { test } = require('node:test');
const M4a = require('../m4a.js');
const AudioFile = require('../audiofile.js');
const { plan } = require('../mp3split.js');
const { makeM4a, frameSize } = require('./helpers/m4a-builder.js');

// Walk an ADTS stream, returning [{len, first payload byte}] and checking the header fields.
function walkAdts(d, { sampleRate = 44100 } = {}) {
  const idx = { 48000: 3, 44100: 4, 32000: 5, 16000: 8 }[sampleRate];
  const out = [];
  for (let p = 0; p < d.length;) {
    assert.equal(d[p], 0xff); assert.equal(d[p + 1], 0xf1);
    assert.equal(d[p + 2] >> 6, 1); // AAC-LC
    assert.equal((d[p + 2] >> 2) & 15, idx);
    const chan = ((d[p + 2] & 1) << 2) | (d[p + 3] >> 6);
    assert.equal(chan, 2);
    const len = ((d[p + 3] & 3) << 11) | (d[p + 4] << 3) | (d[p + 5] >> 5);
    out.push({ len: len - 7, v: d[p + 7] });
    p += len;
  }
  return out;
}

test('parse: duration, rate and frame table of a 64 min file', () => {
  const info = M4a.parse(makeM4a(64 * 60));
  assert.ok(Math.abs(info.durationSec - 3840) < 0.03, `got ${info.durationSec}`);
  assert.equal(info.sampleRate, 44100);
  assert.equal(info.channels, 2);
  assert.equal(info.sizes[0], frameSize(0));
  assert.equal(info.sizes[1234], frameSize(1234));
});

test('parse: 48 kHz and 64-bit chunk offsets', () => {
  const info = M4a.parse(makeM4a(120, { sampleRate: 48000, co64: true, perChunk: 7 }));
  assert.equal(info.sampleRate, 48000);
  assert.ok(Math.abs(info.durationSec - 120) < 0.03);
});

test('cut: ADTS frames carry the right bytes from the right place', () => {
  const bytes = makeM4a(600);
  const info = M4a.parse(bytes);
  const r = M4a.cut(bytes, info, 100, 200);
  const frames = walkAdts(r.data);
  const first = Math.round(r.actualStartSec / info.frameSec);
  assert.equal(frames.length, Math.round((r.actualEndSec - r.actualStartSec) / info.frameSec));
  frames.forEach((f, k) => { assert.equal(f.len, frameSize(first + k)); assert.equal(f.v, (first + k) & 255); });
  assert.ok(Math.abs(r.actualStartSec - 100) < 0.03 && Math.abs(r.actualEndSec - 200) < 0.03);
});

test('AudioFile: 64 min M4A plans into 3 pieces that overlap by 90 s', () => {
  const bytes = makeM4a(64 * 60);
  const f = AudioFile.open(bytes);
  assert.equal(f.kind, 'aac');
  assert.equal(f.mime, 'audio/aac');
  const pieces = plan(f.durationSec);
  assert.equal(pieces.length, 3);
  const cuts = pieces.map((p) => f.cut(p.startSec, p.endSec));
  cuts.forEach((c) => {
    assert.ok(c.actualEndSec - c.actualStartSec <= 28 * 60);
    walkAdts(c.data);
  });
  for (let i = 1; i < cuts.length; i++) assert.ok(Math.abs(cuts[i - 1].actualEndSec - cuts[i].actualStartSec - 90) < 0.1);
  assert.ok(Math.abs(cuts.at(-1).actualEndSec - f.durationSec) < 0.03);
});

test('AudioFile: still opens MP3s', () => {
  const frame = Buffer.alloc(417); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90;
  const mp3 = new Uint8Array(Buffer.concat(Array.from({ length: 4000 }, () => frame)));
  const f = AudioFile.open(mp3);
  assert.equal(f.kind, 'mp3');
  assert.ok(f.durationSec > 100);
  assert.ok(f.cut(0, 50).data.length > 0);
});

test('friendly errors', () => {
  assert.throws(() => M4a.parse(makeM4a(60, { codec: 'alac' })), /lossless/i);
  assert.throws(() => M4a.parse(makeM4a(60, { noMoov: true })), /no index/i);
  assert.throws(() => M4a.parse(new Uint8Array(100)), /Not an M4A/);
  const cutOff = makeM4a(60); // drop the tail so the frame table points past the end of the file
  assert.throws(() => M4a.parse(cutOff.subarray(0, 30000)), /index|cut off|damaged/i);
});
