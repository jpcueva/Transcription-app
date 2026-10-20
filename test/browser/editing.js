// Resume after failure/reload, review flags, speaker sheet (suggestions, rename, move, merge),
// text edit, split, delete + undo, and restoring everything after a reload.
const assert = require('node:assert/strict');
const { TMP, launch, startServer, writeAudio, mockGemini, rows } = require('./helpers');

(async () => {
  const server = await startServer(), browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
  const m = await mockGemini(ctx, { failPiece: 1, hallucination: true });
  const file = writeAudio('m4a', 3840);
  const open = async () => {
    await page.goto(server.url);
    await page.fill('#key', 'test-key'); await page.dispatchEvent('#key', 'change');
    await page.setInputFiles('#file', file);
    await page.waitForSelector('#planBox:not([hidden])');
  };
  const seg = (i) => page.locator('.seg').nth(i);
  try {
    // 1. a piece fails: finished pieces are kept
    await open();
    assert.equal(await page.$('#spk'), null); // no speaker-limit setting any more
    await page.click('#go');
    await page.waitForSelector('#error:not([hidden])', { timeout: 30000 });
    assert.match(await page.textContent('#error'), /saved/i);

    // 2. reload and resume: only the failed piece is requested again
    m.failPiece = undefined; m.asked.length = 0;
    await open();
    assert.match(await page.textContent('#savedText'), /2 of 3/);
    await page.click('#go');
    await page.waitForSelector('#outCard:not([hidden])', { timeout: 30000 });
    assert.deepEqual([...new Set(m.asked)], [1]);
    assert.ok(await page.isHidden('#saved')); // the progress bar disappears once the run is done
    let r = await rows(page);
    assert.equal(r.length, 129); // 128 lines + the hallucinated one
    console.log('ok resume: only piece 2 re-requested');

    // 3. review flag on the hallucinated line, then "Mark OK"
    const fi = r.findIndex((x) => x.text.startsWith('echo'));
    assert.match(r[fi].flag, /very fast speech .* repeats earlier text|very fast speech/);
    assert.equal(r.filter((x) => x.flag).length, 1);
    assert.match(await page.textContent('#out p.muted'), /1 line flagged/);
    await seg(fi).locator('button.edit').click();
    await seg(fi).locator('.editBar button', { hasText: 'Mark OK' }).click();
    r = await rows(page);
    assert.equal(r.filter((x) => x.flag).length, 0);
    console.log('ok flag: "' + 'very fast speech' + '" shown, cleared by Mark OK');

    // 4. speaker sheet: suggestion -> rename everywhere
    await page.locator('.seg', { hasText: 'guest' }).first().locator('button.who').click();
    await page.waitForSelector('#sheetSuggest .chip');
    await page.click('#sheetSuggest .chip');
    assert.equal(await page.inputValue('#sheetName'), 'Roman');
    await page.click('#sheetSave');
    r = await rows(page);
    assert.deepEqual(r.filter((x) => x.text.startsWith('guest')).map((x) => x.who), ['Roman', 'Roman']);

    // 5. move one line, then merge Speaker 1 into Roman
    await seg(1).locator('button.who').click();
    await page.locator('#sheetMove .chip', { hasText: 'Roman' }).click();
    assert.equal((await rows(page))[1].who, 'Roman');
    await seg(0).locator('button.who').click();
    assert.ok(await page.isVisible('#sheetMergeLabel'));
    await page.locator('#sheetMerge .chip', { hasText: 'Roman' }).click();
    r = await rows(page);
    assert.deepEqual([...new Set(r.map((x) => x.who))].sort(), ['Roman', 'Speaker 2']);
    assert.equal(m.suggestCalls, 1);
    console.log('ok speakers: suggestion, rename, move, merge');

    // 6. edit text (cancel first)
    const orig = r[2].text;
    await seg(2).locator('button.edit').click();
    await seg(2).locator('textarea').fill('totally different');
    await seg(2).locator('.editBar button', { hasText: 'Cancel' }).click();
    assert.equal((await rows(page))[2].text, orig);
    await seg(2).locator('button.edit').click();
    await seg(2).locator('textarea').fill('  We should move the LAUNCH date,\n corrected. Yes. And the budget too.  ');
    await seg(2).locator('.editBar button', { hasText: 'Save' }).click();
    r = await rows(page);
    assert.equal(r[2].text, 'We should move the LAUNCH date, corrected. Yes. And the budget too.'); assert.ok(r[2].edited);

    // 7. split at the caret: "...corrected." | "Yes. And the budget too."
    await seg(2).locator('button.edit').click();
    const ta = seg(2).locator('textarea');
    await seg(2).locator('.editBar button', { hasText: 'Split here' }).click(); // caret at end -> refused with a hint
    assert.match(await seg(2).locator('.editHint').textContent(), /Tap inside the text/);
    await ta.evaluate((el) => { const p = el.value.indexOf('Yes.'); el.focus(); el.setSelectionRange(p, p); });
    await page.screenshot({ path: TMP + '/split.png' });
    await seg(2).locator('.editBar button', { hasText: 'Split here' }).click();
    r = await rows(page);
    assert.equal(r.length, 130);
    assert.deepEqual([r[2].text, r[3].text], ['We should move the LAUNCH date, corrected.', 'Yes. And the budget too.']);
    assert.match(await page.textContent('#toastText'), /split/i);
    await page.click('#toastUndo');
    assert.equal((await rows(page)).length, 129);
    await seg(2).locator('button.edit').click();
    await seg(2).locator('textarea').evaluate((el) => { const p = el.value.indexOf('Yes.'); el.focus(); el.setSelectionRange(p, p); });
    await seg(2).locator('.editBar button', { hasText: 'Split here' }).click();
    await seg(3).locator('button.who').click();
    await page.locator('#sheetMove .chip', { hasText: 'Speaker 2' }).click();
    r = await rows(page);
    assert.deepEqual([r[2].who, r[3].who], ['Roman', 'Speaker 2']);
    console.log('ok split: caret split, undo, re-split and reassign second half');

    // 8. delete + undo, delete again
    const t6 = r[6].text;
    await seg(6).locator('button.edit').click(); await seg(6).locator('.editBar .danger').click();
    assert.equal((await rows(page)).length, 129);
    await page.click('#toastUndo');
    assert.equal((await rows(page))[6].text, t6);
    await seg(6).locator('button.edit').click(); await seg(6).locator('.editBar .danger').click();
    assert.equal((await rows(page)).length, 129);
    console.log('ok delete: undo restores, second delete sticks');

    // 9. reload: everything restored
    await open();
    assert.match(await page.textContent('#savedText'), /Restored/);
    r = await rows(page);
    assert.equal(r.length, 129);
    assert.deepEqual([r[2].text, r[3].text, r[3].who], ['We should move the LAUNCH date, corrected.', 'Yes. And the budget too.', 'Speaker 2']);
    assert.equal(r.filter((x) => x.flag).length, 0); // "Mark OK" persisted
    assert.deepEqual(errors, []);
    console.log('ok restore: edits, split, deletion and review marks survive a reload');
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
