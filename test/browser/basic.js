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
      // "Name all speakers": one suggestion call, numbered speakers renamed, unnamed ones stay, Undo restores
      await page.click('#nameAll');
      await page.waitForSelector('#toast:not([hidden])');
      const named = await rows(page);
      assert.deepEqual([...new Set(named.map((x) => x.who))].sort(), ['Maria', 'Roman', 'Speaker 1']);
      assert.match(await page.textContent('#toastText'), /Named 2 speakers: #2→Maria, #3→Roman/);
      assert.equal(m.suggestCalls, 1);
      await page.click('#toastUndo');
      assert.deepEqual([...new Set((await rows(page)).map((x) => x.who))].sort(), ['Speaker 1', 'Speaker 2', 'Speaker 3']);
      await page.click('#nameAll'); // cached suggestions: no second call
      await page.waitForSelector('#toast:not([hidden])');
      assert.equal(m.suggestCalls, 1);
      if (kind === 'm4a') await page.screenshot({ path: require('./helpers').TMP + '/nameall.png' });
      console.log('ok name all: 2 speakers named from suggestions, undo, cached');
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
