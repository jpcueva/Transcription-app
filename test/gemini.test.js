const assert = require('node:assert/strict');
const { test } = require('node:test');
const { wordsToSegments } = require('../gemini.js');

// Shape from the Gemini cookbook (Get_started_transcribe): steps -> content -> annotations[word_info].
function interaction(words, { withIndex = true } = {}) {
  let text = '', annotations = [];
  const enc = new TextEncoder();
  words.forEach(([w, s, e, spk], i) => {
    if (i) text += ' ';
    const startIdx = enc.encode(text).length;
    text += w;
    const a = { type: 'word_info', text: w, start_offset: s + 's', end_offset: e + 's', speaker: spk };
    if (withIndex) Object.assign(a, { start_index: startIdx, end_index: enc.encode(text).length });
    annotations.push(a);
  });
  return { status: 'completed', output_text: text, steps: [{ type: 'model_output', content: [{ type: 'text', text, annotations }] }] };
}

test('groups words into speaker turns and names speakers in order of appearance', () => {
  const segs = wordsToSegments(interaction([
    ['One', 0.4, 0.6, 'spk:1'], ['chocolatine,', 0.6, 1.2, 'spk:1'], ['please.', 1.2, 1.6, 'spk:1'],
    ['Tiago,', 2.0, 2.4, 'spk:0'], ['arrête.', 2.4, 3.0, 'spk:0'],
    ['Wait.', 3.5, 3.9, 'spk:1']
  ]));
  assert.deepEqual(segs.map((s) => [s.speaker, s.text, s.start, s.end]), [
    ['Speaker 1', 'One chocolatine, please.', 0.4, 1.6],
    ['Speaker 2', 'Tiago, arrête.', 2.0, 3.0],
    ['Speaker 1', 'Wait.', 3.5, 3.9]
  ]);
});

test('splits on long pauses and on sentence ends in long turns', () => {
  const w = [];
  for (let i = 0; i < 40; i++) w.push([i % 10 === 9 ? 'end.' : 'word', i, i + 0.9, 'spk_1']);
  w.push(['later', 45, 45.5, 'spk_1']);
  const segs = wordsToSegments(interaction(w, { withIndex: false }));
  assert.ok(segs.length >= 2);
  assert.equal(segs.at(-1).text, 'later'); // 4.1 s pause starts a new segment
  segs.slice(0, -1).forEach((s) => assert.ok(s.end - s.start <= 41));
  assert.ok(segs.every((s) => s.speaker === 'Speaker 1'));
});

test('missing speaker and missing annotations', () => {
  const segs = wordsToSegments(interaction([['hi', 0, 0.5, undefined]]));
  assert.equal(segs[0].speaker, '');
  const plain = wordsToSegments({ status: 'completed', output_text: 'just text', steps: [{ content: [{ type: 'text', text: 'just text' }] }] });
  assert.deepEqual(plain, [{ start: 0, end: 0, speaker: '', text: 'just text' }]);
});
