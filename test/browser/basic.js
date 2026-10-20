// Full run for MP3 and M4A: plan, upload, transcribe (mocked), speaker matching across pieces, join.
const assert = require('node:assert/strict');
const { launch, startServer, writeAudio, mockGemini, rows } = require('./helpers');

(async () => {
  const server = await startServer(), browser = await launch();
  try {
    for (const kind of ['m4a', 'mp3']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const m = await mockGemini(ctx);
      await page.goto(server.url);
      await page.fill('#key', 'test-key'); await page.dispatchEvent('#key', 'change');
      await page.setInputFiles('#file', writeAudio(kind, 3840));
      await page.waitForSelector('#planBox:not([hidden])');
      assert.match(await page.textContent('#planSummary'), /01:04:00 → 3 pieces, 90 s overlap/);
      await page.click('#go');
      await page.waitForSelector('#outCard:not([hidden])', { timeout: 30000 });
      const r = await rows(page);
      const wrong = r.filter((x) => { const k = /line (\d+)/.exec(x.text); return k && x.who !== (+k[1] % 2 === 0 ? 'Speaker 1' : 'Speaker 2'); });
      const guests = r.filter((x) => x.text.startsWith('guest')).map((x) => x.who);
      assert.equal(r.length, 128); assert.equal(wrong.length, 0); assert.deepEqual(guests, ['Speaker 3', 'Speaker 3']);
      assert.equal(m.aiCalls, 1);
      assert.deepEqual(m.uploads.map((u) => u.mime), Array(3).fill(kind === 'm4a' ? 'audio/aac' : 'audio/mpeg'));
      assert.equal(m.lastBody.input[0].mime_type, kind === 'm4a' ? 'audio/aac' : 'audio/mpeg');
      assert.deepEqual(m.lastBody.generation_config.transcription_config.mode, { type: 'verbatim', diarization_mode: 'speaker', timestamp_granularities: ['word'] });
      assert.deepEqual(errors, []);
      console.log(`ok ${kind}: 128 lines, consistent speakers across 3 pieces, guest = Speaker 3`);
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
