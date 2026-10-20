const assert = require('node:assert/strict');
const { test } = require('node:test');
const Q = require('../quality.js');
const E = require('../edits.js');

const say = (n, from = 0) => Array.from({ length: n }, (_, i) => 'w' + (from + i)).join(' ');

test('flags impossibly fast lines but not normal or short ones', () => {
  const segs = [
    { start: 0, end: 20, text: say(50) },            // 2.5 w/s: fine
    { start: 25, end: 37, text: say(150, 100) },     // 12.5 w/s: the 37:25 case
    { start: 40, end: 40.3, text: 'Yes.' },          // short: ignored
    { start: 41, end: 41, text: say(40, 400) },      // no end time: uses next start (3 s) -> 13 w/s
    { start: 44, end: 50, text: say(20, 600) }
  ];
  const f = Q.flags(segs);
  assert.deepEqual(Object.keys(f), ['1', '3']);
  assert.deepEqual(f[1].reasons, ['fast']);
  assert.equal(f[1].wps, 13);
  assert.match(Q.describe(f[1]), /13 words\/s/);
});

test('flags a line that repeats earlier text', () => {
  const earlier = 'open source model costs ten cents compared to a dollar which is ten percent of the frontier model';
  const segs = [
    { start: 0, end: 30, text: earlier + ' and we will give access to open source models by default' },
    { start: 60, end: 70, text: 'something completely different about dashboards and power bi reports' },
    { start: 900, end: 960, text: 'and then we will say okay ' + earlier }
  ];
  const f = Q.flags(segs);
  assert.deepEqual(Object.keys(f), ['2']);
  assert.deepEqual(f[2].reasons, ['repeat']);
});

test('short stock phrases are not flagged as repeats', () => {
  const segs = [
    { start: 0, end: 3, text: 'Thank you very much for your time today.' },
    { start: 60, end: 63, text: 'Thank you very much for your time, really.' }
  ];
  assert.deepEqual(Q.flags(segs), {});
});

test('lines marked OK are not flagged', () => {
  const segs = [{ start: 25, end: 37, text: say(150) }];
  assert.equal(Object.keys(Q.flags(segs)).length, 1);
  assert.equal(Object.keys(Q.flags(E.markOk(segs, 0))).length, 0);
});

test('splitLine cuts at the cursor and estimates the split time', () => {
  const segs = [
    { start: 0, end: 5, speaker: 'A', text: 'before' },
    { start: 10, end: 20, speaker: 'Karthik', text: 'Is that correct? Yes. If we do not have a business case', ok: true },
    { start: 30, end: 31, speaker: 'B', text: 'after' }
  ];
  const text = segs[1].text, pos = text.indexOf('Yes.');
  const out = E.splitLine(segs, 1, text, pos);
  assert.equal(out.length, 4);
  assert.deepEqual([out[1].text, out[2].text], ['Is that correct?', 'Yes. If we do not have a business case']);
  assert.equal(out[1].speaker, 'Karthik'); assert.equal(out[2].speaker, 'Karthik');
  assert.equal(out[1].start, 10); assert.equal(out[2].end, 20);
  assert.ok(out[1].end > 10 && out[1].end < 20 && out[1].end === out[2].start);
  assert.ok(out[1].edited && out[2].edited && !out[1].ok && !out[2].ok);
  assert.equal(segs.length, 3); // not mutated
  assert.equal(E.splitLine(segs, 1, text, 0), segs);
  assert.equal(E.splitLine(segs, 1, text, text.length), segs);
  assert.equal(E.splitLine(segs, 1, 'edited text here', 6)[2].text, 'text here'); // uses the edited text
});
