const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parse, plan, byteRange } = require('../mp3split.js');

// MPEG1 Layer III, 128 kbps, 44.1 kHz. Frame = 417 bytes (+1 when the padding bit is set).
function makeMp3(seconds, { id3 = true, xing = true } = {}) {
  const frameSec = 1152 / 44100;
  const n = Math.round(seconds / frameSec);
  const parts = [];
  if (id3) {
    const tag = Buffer.alloc(10 + 300);
    tag.write('ID3');
    tag[3] = 3;
    tag[8] = 2; tag[9] = 0x2c; // syncsafe 300
    tag[20] = 0xff; tag[21] = 0xfb; // stray fake sync inside the tag
    parts.push(tag);
  }
  const frames = [];
  let acc = 0;
  for (let i = 0; i < n + (xing ? 1 : 0); i++) {
    acc += 144 * 128000 / 44100 - 417;
    const pad = acc >= 1 ? 1 : 0;
    if (pad) acc -= 1;
    const f = Buffer.alloc(417 + pad);
    f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90 | (pad << 1); f[3] = 0x00;
    if (xing && i === 0) f.write('Xing', 4 + 32);
    frames.push(f);
  }
  return new Uint8Array(Buffer.concat(parts.concat(frames)));
}

test('plan: 64 min -> 3 equal pieces with 90 s overlap', () => {
  const p = plan(64 * 60);
  assert.equal(p.length, 3);
  const len = p[0].endSec - p[0].startSec;
  assert.ok(Math.abs(len - 1340) < 0.01); // 22 min 20 s
  assert.ok(Math.abs(p[1].startSec - 1250) < 0.01); // 20:50
  assert.ok(Math.abs(p[2].startSec - 2500) < 0.01); // 41:40
  assert.equal(p[2].endSec, 64 * 60);
  for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i - 1].endSec - p[i].startSec - 90) < 0.01);
});

test('plan: boundary cases', () => {
  assert.equal(plan(10 * 60).length, 1);
  assert.equal(plan(28 * 60).length, 1);
  assert.equal(plan(28 * 60 + 1).length, 2);
  assert.equal(plan(50 * 60).length, 2);
  assert.equal(plan(120 * 60).length, 5);
  for (const m of [29, 55, 56, 57, 90, 150, 300]) {
    const p = plan(m * 60);
    for (const x of p) assert.ok(x.endSec - x.startSec <= 28 * 60 + 0.001, `${m} min piece too long`);
  }
  assert.throws(() => plan(3600, { maxSec: 60, overlapSec: 60 }));
});

test('parse: duration of a 64 min file, skipping ID3 and Xing', () => {
  const mp3 = makeMp3(64 * 60);
  const info = parse(mp3);
  assert.ok(Math.abs(info.durationSec - 3840) < 0.05, `got ${info.durationSec}`);
  assert.equal(info.sampleRate, 44100);
  assert.ok(info.audioStart >= 310 + 417); // after the ID3 tag and the Xing frame
});

test('split: pieces are valid MP3s of the planned length and overlap', () => {
  const mp3 = makeMp3(64 * 60);
  const info = parse(mp3);
  const pieces = plan(info.durationSec);
  const parsed = pieces.map((p) => {
    const r = byteRange(info, p.startSec, p.endSec);
    const sub = mp3.subarray(r.startByte, r.endByte);
    const pi = parse(sub);
    assert.ok(Math.abs(pi.durationSec - (r.actualEndSec - r.actualStartSec)) < 0.05);
    assert.ok(pi.durationSec <= 28 * 60);
    return { r, pi };
  });
  for (let i = 1; i < parsed.length; i++) {
    const overlap = parsed[i - 1].r.actualEndSec - parsed[i].r.actualStartSec;
    assert.ok(Math.abs(overlap - 90) < 0.1, `overlap ${overlap}`);
  }
  assert.ok(parsed[0].r.actualStartSec < 0.05);
  assert.ok(Math.abs(parsed.at(-1).r.actualEndSec - info.durationSec) < 0.05);
});

test('parse: rejects non-MP3', () => {
  assert.throws(() => parse(new Uint8Array(5000)));
});
