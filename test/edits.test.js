const assert = require('node:assert/strict');
const { test } = require('node:test');
const E = require('../edits.js');
const P = require('../progress.js');

const segs = [
  { start: 1, speaker: 'Speaker 1', text: 'welcome everyone to the show today' },
  { start: 9, speaker: 'Speaker 2', text: 'thanks for having me on' },
  { start: 15, speaker: 'Speaker 3', text: 'happy to be here with you all' },
  { start: 30, speaker: 'Speaker 2', text: 'so let us get started then' }
];

test('stats lists speakers in order of first appearance', () => {
  assert.deepEqual(E.stats(segs).map((s) => [s.label, s.lines]), [['Speaker 1', 1], ['Speaker 2', 2], ['Speaker 3', 1]]);
});

test('rename changes every line, keeps other fields, does not mutate', () => {
  const out = E.rename(segs, 'Speaker 2', '  Roman   Y. ');
  assert.deepEqual(out.map((s) => s.speaker), ['Speaker 1', 'Roman Y.', 'Speaker 3', 'Roman Y.']);
  assert.equal(out[1].start, 9);
  assert.equal(segs[1].speaker, 'Speaker 2');
  assert.equal(E.rename(segs, 'Speaker 2', '   '), segs); // empty name ignored
});

test('renaming to an existing speaker merges them', () => {
  const out = E.rename(segs, 'Speaker 3', 'Speaker 1');
  assert.equal(E.stats(out).length, 2);
  assert.equal(E.stats(out)[0].lines, 2);
});

test('moveLine changes only one line', () => {
  const out = E.moveLine(segs, 3, 'Speaker 3');
  assert.deepEqual(out.map((s) => s.speaker), ['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 3']);
  assert.equal(E.moveLine(segs, 99, 'x'), segs);
});

test('editText replaces one line, tidies whitespace, ignores empty and unchanged', () => {
  const out = E.editText(segs, 1, '  thanks for\n having   me  ');
  assert.equal(out[1].text, 'thanks for having me');
  assert.equal(out[1].edited, true);
  assert.equal(out[1].speaker, 'Speaker 2');
  assert.equal(segs[1].text, 'thanks for having me on');
  assert.equal(E.editText(segs, 1, '   '), segs);
  assert.equal(E.editText(segs, 1, 'thanks for having me on'), segs);
  assert.equal(E.editText(segs, 9, 'x'), segs);
});

test('removeLine drops exactly one line without mutating', () => {
  const out = E.removeLine(segs, 1);
  assert.deepEqual(out.map((s) => s.start), [1, 15, 30]);
  assert.equal(segs.length, 4);
  assert.equal(E.removeLine(segs, 9), segs);
});

test('sampleLines skips very short lines and truncates', () => {
  const s = [{ start: 0, speaker: 'A', text: 'yes' }, { start: 1, speaker: 'A', text: 'this is a rather long line of speech' }];
  assert.deepEqual(E.sampleLines(s, 'A', 2, 12), [{ start: 1, text: 'this is a r…' }]);
});

// --- progress ---
function mem(limit) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (limit && [...m.values()].join('').length + v.length > limit) throw new Error('quota'); m.set(k, v); },
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()]
  };
}
const file = { name: 'm.m4a', size: 5, lastModified: 7 };
const set = { maxSec: 1680, overlapSec: 90, model: 'x' };

test('progress: fingerprint depends on file and settings', () => {
  assert.equal(P.fingerprint(file, set), P.fingerprint({ ...file }, { ...set }));
  assert.notEqual(P.fingerprint(file, set), P.fingerprint(file, { ...set, overlapSec: 60 }));
  assert.notEqual(P.fingerprint(file, set), P.fingerprint({ ...file, size: 6 }, set));
});

test('progress: pieces and final round-trip, clear removes', () => {
  const st = mem(), fp = P.fingerprint(file, set);
  assert.deepEqual(P.load(st, fp), { pieces: {}, final: null, t: 0 });
  P.savePiece(st, fp, 0, { startSec: 0, endSec: 5, segments: [{ text: 'a' }] });
  P.savePiece(st, fp, 2, { startSec: 9, endSec: 12, segments: [] });
  P.saveFinal(st, fp, [{ speaker: 'Roman' }]);
  const d = P.load(st, fp);
  assert.deepEqual(Object.keys(d.pieces), ['0', '2']);
  assert.equal(d.final[0].speaker, 'Roman');
  P.clear(st, fp);
  assert.deepEqual(P.load(st, fp).pieces, {});
});

test('progress: keeps only the 5 most recent files and survives a full or broken store', () => {
  const st = mem();
  for (let i = 0; i < 7; i++) P.savePiece(st, 'tx:f' + i, 0, { segments: [] });
  assert.equal(st.keys().filter((k) => k !== 'tx:index').length, 5);
  assert.equal(P.load(st, 'tx:f0').t, 0); // oldest evicted
  const tiny = mem(120);
  assert.equal(P.savePiece(tiny, 'tx:a', 0, { segments: [{ text: 'x'.repeat(500) }] }), false); // too big: reports failure, no throw
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(P.savePiece(bad, 'tx:a', 0, {}), false);
  assert.deepEqual(P.load(bad, 'tx:a').pieces, {});
});

test('applyNames names numbered speakers, keeps user names, merges equal names', () => {
  const s = [
    { start: 1, speaker: 'Bjorne', text: 'a' }, { start: 2, speaker: 'Speaker 2', text: 'b' },
    { start: 3, speaker: 'Speaker 3', text: 'c' }, { start: 4, speaker: 'Speaker 8', text: 'd' },
    { start: 5, speaker: 'Speaker 9', text: 'e' }, { start: 6, speaker: 'Unidentified speaker', text: 'f' }
  ];
  const sug = {
    Bjorne: [{ name: 'Someone Else' }],               // user-given name: untouched
    'Speaker 2': [{ name: 'Karthik' }, { name: 'Tim' }],
    'Speaker 3': [{ name: 'Anusha' }],
    'Speaker 8': [{ name: '  Anusha ' }],              // same person in another part -> merged
    'Speaker 9': [],                                    // no evidence -> stays numbered
    'Unidentified speaker': [{ name: 'X' }]
  };
  const { segments, applied } = E.applyNames(s, sug);
  assert.deepEqual(segments.map((x) => x.speaker), ['Bjorne', 'Karthik', 'Anusha', 'Anusha', 'Speaker 9', 'Unidentified speaker']);
  assert.deepEqual(applied, [{ from: 'Speaker 2', to: 'Karthik' }, { from: 'Speaker 3', to: 'Anusha' }, { from: 'Speaker 8', to: 'Anusha' }]);
  assert.equal(s[1].speaker, 'Speaker 2'); // not mutated
  assert.deepEqual(E.applyNames(s, {}).applied, []);
  assert.deepEqual(E.applyNames(s, null).applied, []);
});
