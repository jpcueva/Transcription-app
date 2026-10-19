const assert = require('node:assert/strict');
const { test } = require('node:test');
const T = require('../transcript.js');

test('parseTime handles common formats', () => {
  assert.equal(T.parseTime('1:23'), 83);
  assert.equal(T.parseTime('0:01:23.5'), 83.5);
  assert.equal(T.parseTime(12), 12);
  assert.equal(T.parseTime('nope'), null);
  assert.equal(T.parseTime(null), null);
});

test('normalize shifts timestamps and labels missing speakers', () => {
  const s = T.normalize([{ start: '00:10', end: '00:12', speaker: '', text: ' hi ' }, { start: 'x', text: 'drop' }], 1250);
  assert.equal(s.length, 1);
  assert.equal(s[0].start, 1260);
  assert.equal(s[0].speaker, 'Unidentified speaker');
  assert.equal(s[0].text, 'hi');
});

test('join cuts each overlap at its midpoint without gaps or repeats', () => {
  // 64 min plan: pieces start 0 / 1250 / 2500, length 1340.
  const mk = (startSec, endSec) => {
    const segments = [];
    for (let t = Math.ceil(startSec); t < endSec; t += 10) segments.push({ start: t, end: t + 9, speaker: 'A', text: 't' + t });
    return { startSec, endSec, segments };
  };
  const pieces = [mk(0, 1340), mk(1250, 2590), mk(2500, 3840)];
  const j = T.join(pieces);
  const starts = j.map((s) => s.start);
  assert.equal(new Set(starts).size, starts.length); // no repeats
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.equal(starts[0], 0);
  for (let i = 1; i < starts.length; i++) assert.equal(starts[i] - starts[i - 1], 10); // no gaps
  assert.equal(j.find((s) => s.start === 1290).piece, 0); // before midpoint 1295
  assert.equal(j.find((s) => s.start === 1300).piece, 1);
});

test('exports', () => {
  const segs = [{ start: 3, end: 5, speaker: 'A', text: 'x' }];
  assert.equal(T.toText(segs), '[00:00:03] A: x');
  assert.match(T.toSrt(segs), /00:00:03,000 --> 00:00:05,000/);
});
