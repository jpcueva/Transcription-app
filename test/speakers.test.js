const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolve, capSpeakers, UNID } = require('../speakers.js');

const LINES = [
  'we should move the launch date to the second week of march',
  'that works for engineering as long as the contract is signed',
  'legal told me the contract will be ready by friday afternoon',
  'then let us confirm the budget before the board meeting starts',
  'finance still needs the updated forecast from the sales team',
  'sales will send the forecast tomorrow morning without fail'
];
// piece segment helper: global start time, label, text
const seg = (start, speaker, text) => ({ start, end: start + 8, speaker, text });

// Piece 1 covers 0-1340, piece 2 covers 1250-2590; overlap 1250-1340, speakers alternate A/B.
function twoPieces(swap) {
  const p1 = [seg(10, 'Speaker 1', 'hello everyone thanks for joining today'), seg(1255, 'Speaker 1', LINES[0]), seg(1265, 'Speaker 2', LINES[1]),
              seg(1280, 'Speaker 1', LINES[2]), seg(1300, 'Speaker 2', LINES[3]), seg(1320, 'Speaker 1', LINES[4])];
  const a = swap ? 'Speaker 2' : 'Speaker 1', b = swap ? 'Speaker 1' : 'Speaker 2';
  const p2 = [seg(1256, a, LINES[0]), seg(1266, b, LINES[1]), seg(1281, a, LINES[2]), seg(1301, b, LINES[3]), seg(1321, a, LINES[4]),
              seg(1400, b, 'completely new topic about the hiring plan for next quarter')];
  return [{ startSec: 0, endSec: 1340, segments: p1 }, { startSec: 1250, endSec: 2590, segments: p2 }];
}

test('labels swapped between pieces are matched through the overlap', async () => {
  const { pieces } = await resolve(twoPieces(true));
  const later = pieces[1].segments;
  assert.equal(later[0].speaker, 'Speaker 1'); // raw "Speaker 2" -> canonical "Speaker 1"
  assert.equal(later[0].rawSpeaker, 'Speaker 2');
  assert.equal(later[1].speaker, 'Speaker 2');
  assert.equal(later.at(-1).speaker, 'Speaker 2'); // non-overlap line follows the mapping too
});

test('identical labels stay identical', async () => {
  const { pieces } = await resolve(twoPieces(false));
  assert.deepEqual(pieces[1].segments.map((s) => s.speaker), ['Speaker 1', 'Speaker 2', 'Speaker 1', 'Speaker 2', 'Speaker 1', 'Speaker 2']);
});

test('a speaker silent in the overlap is Unidentified without a resolver', async () => {
  const ps = twoPieces(false);
  ps[1].segments.push(seg(1500, 'Speaker 3', 'a brand new voice speaking about something unrelated entirely'));
  const { pieces } = await resolve(ps);
  assert.equal(pieces[1].segments.at(-1).speaker, UNID);
  assert.equal(pieces[1].segments.at(-1).rawSpeaker, 'Speaker 3');
});

test('resolver can map to a known speaker or declare a new one', async () => {
  const ps = twoPieces(false);
  ps[1].segments.push(seg(1500, 'Speaker 3', 'a brand new voice speaking about something unrelated entirely'));
  ps[1].segments.push(seg(1600, 'Speaker 4', 'yet another person talking about the quarterly hiring plan again'));
  let request;
  const { pieces } = await resolve(ps, {
    resolver: async (r) => { request = r; return { 'Speaker 3': 'Speaker 2', 'Speaker 4': 'NEW' }; }
  });
  assert.deepEqual(request.unresolved.map((u) => u.label), ['Speaker 3', 'Speaker 4']);
  assert.deepEqual(request.canonical.map((c) => c.label).sort(), ['Speaker 1', 'Speaker 2']);
  assert.ok(request.canonical[0].samples.length > 0);
  const last2 = pieces[1].segments.slice(-2).map((s) => s.speaker);
  assert.deepEqual(last2, ['Speaker 2', 'Speaker 3']); // NEW gets the first unused number
});

test('a failing or lying resolver degrades to Unidentified', async () => {
  const ps = twoPieces(false);
  ps[1].segments.push(seg(1500, 'Speaker 3', 'a brand new voice speaking about something unrelated entirely'));
  const failed = await resolve(ps, { resolver: async () => { throw new Error('boom'); } });
  assert.equal(failed.pieces[1].segments.at(-1).speaker, UNID);
  assert.match(failed.warnings[0], /part 2/);
  const lied = await resolve(ps, { resolver: async () => ({ 'Speaker 3': 'Speaker 99' }) });
  assert.equal(lied.pieces[1].segments.at(-1).speaker, UNID);
});

test('ambiguous votes are not guessed', async () => {
  const ps = twoPieces(false);
  // Speaker 2 in piece 2 repeats words that piece 1 attributed to both Speaker 1 and Speaker 2 equally.
  ps[1].segments = [seg(1256, 'Speaker 2', LINES[0]), seg(1266, 'Speaker 2', LINES[1])];
  ps[0].segments = [seg(1255, 'Speaker 1', LINES[0]), seg(1265, 'Speaker 2', LINES[1])];
  const { pieces } = await resolve(ps);
  assert.deepEqual(pieces[1].segments.map((s) => s.speaker), [UNID, UNID]);
});

test('chains across three pieces', async () => {
  const p = twoPieces(true);
  const third = { startSec: 2500, endSec: 3840, segments: [] };
  // piece 2 ends at 2590; overlap 2500-2590 with labels swapped again relative to piece 2's raw labels
  p[1].segments.push(seg(2505, 'Speaker 1', LINES[3]), seg(2520, 'Speaker 2', LINES[4]));
  third.segments.push(seg(2506, 'Speaker 2', LINES[3]), seg(2521, 'Speaker 1', LINES[4]), seg(2700, 'Speaker 1', 'closing remarks and next steps for everybody'));
  const { pieces } = await resolve([...p, third]);
  // piece 2 raw "Speaker 1" == canonical "Speaker 2"; piece 3 raw "Speaker 2" == piece 2 raw "Speaker 1"
  assert.equal(pieces[2].segments[0].speaker, 'Speaker 2');
  assert.equal(pieces[2].segments.at(-1).speaker, 'Speaker 1');
});

test('capSpeakers demotes the quietest speakers', () => {
  const segs = [
    { start: 0, speaker: 'A', text: 'one two three four five six seven' }, { start: 1, speaker: 'B', text: 'one two three four five' },
    { start: 2, speaker: 'C', text: 'one two' }, { start: 3, speaker: UNID, text: 'x' }
  ];
  assert.deepEqual(capSpeakers(segs, 2).map((s) => s.speaker), ['A', 'B', UNID, UNID]);
  assert.deepEqual(capSpeakers(segs, 8).map((s) => s.speaker), ['A', 'B', 'C', UNID]);
});
