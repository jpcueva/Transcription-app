const assert = require('node:assert/strict');
const { test } = require('node:test');
const G = require('../gemini.js');

test('resolveSpeakers prompt carries name cues and last-seen context, and parses the answer', async () => {
  let sent;
  global.fetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    const answer = [{ label: 'Speaker 3', match: 'NEW' }];
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) };
  };
  const out = await G.resolveSpeakers({
    key: 'k', model: 'text-model',
    canonical: [{ label: 'Karthik', samples: [{ start: 600, text: 'we are implementing a 200 dollar limit' }], lastLines: [{ start: 1897, text: 'I need to drop off for another meeting' }], lastSeen: 1897, cues: [{ start: 105, speaker: 'Bjorne', text: "So let's talk with Karthik." }] }],
    unresolved: [{ label: 'Speaker 3', firstSeen: 3126, samples: [{ start: 3126, text: 'how do I scale it up' }], cues: [{ start: 3122, speaker: 'Bjorne', text: 'Fantastic. Juan, good question.' }] }]
  });
  assert.deepEqual(out, { 'Speaker 3': 'NEW' });
  assert.match(sent.url, /models\/text-model:generateContent$/);
  const prompt = sent.body.contents[0].parts[0].text;
  assert.match(prompt, /## Karthik \(last spoke at 31:37\)/);
  assert.match(prompt, /\[31:37\] I need to drop off/);
  assert.match(prompt, /## Speaker 3 \(first speaks at 52:06\)/);
  assert.match(prompt, /\[52:02\] Bjorne: Fantastic\. Juan, good question\./);
  assert.match(prompt, /\[1:45\] Bjorne: So let's talk with Karthik\./);
  assert.match(prompt, /topics/); // broad matching is kept
  delete global.fetch;
});
