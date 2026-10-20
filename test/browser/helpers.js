// Shared helpers for the browser tests: static server, Chromium launcher, test audio and a Gemini API mock.
// Run with: node test/browser/basic.js && node test/browser/editing.js
//   PLAYWRIGHT_MODULE  path to the playwright package (default: require('playwright'))
//   CHROMIUM_PATH      Chromium executable (default: Playwright's own, or /opt/pw-browsers/chromium if present)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-browser-'));

function playwright() { return require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }

async function launch() {
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return playwright().chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--no-proxy-server'] });
}

function startServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + server.address().port + '/index.html', close: () => server.close() })));
}

function writeAudio(kind, seconds) {
  const file = path.join(TMP, 'long.' + kind);
  if (kind === 'm4a') fs.writeFileSync(file, Buffer.from(require(path.join(ROOT, 'test/helpers/m4a-builder.js')).makeM4a(seconds)));
  else {
    const n = Math.round(seconds / (1152 / 44100)), f = Buffer.alloc(417);
    f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90;
    fs.writeFileSync(file, Buffer.concat(Array(n).fill(f)));
  }
  return file;
}

/*
 * Mock of the three Gemini calls the app makes, for a 64 min file cut into 3 pieces:
 *  - every 30 s a 10-word line "line K ..."; speakers alternate, labels are swapped in pieces 2 and 3
 *  - a guest (third voice) speaks only in piece 3 at 50:15 and 51:45
 *  - opts.hallucination: piece 1 also contains a 150-word line squeezed into ~7 s that repeats earlier lines
 * Counters in the returned object: aiCalls (speaker matching), suggestCalls (name suggestions), asked (pieces).
 */
async function mockGemini(ctx, opts = {}) {
  const PS = [0, 1250, 2500], PE = [1340, 2590, 3840];
  const WORDS = 'we should move the launch date to the second week of march and confirm the budget'.split(' ');
  const m = { aiCalls: 0, suggestCalls: 0, asked: [], failPiece: opts.failPiece, lastBody: null, uploads: [] };
  await ctx.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request(), url = req.url(), cors = { 'access-control-allow-origin': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/upload/')) {
      const head = req.postDataBuffer().subarray(0, 600).toString('latin1');
      const part = +/part (\d)/.exec(head)[1] - 1;
      m.uploads.push({ part, mime: /Content-Type: (audio\/\w+)/.exec(head)[1], bytes: req.postDataBuffer().length });
      return route.fulfill({ headers: cors, json: { file: { name: 'files/x' + part, uri: 'u' + part, state: 'ACTIVE', mimeType: 'audio/mpeg' } } });
    }
    const body = JSON.parse(req.postData());
    const reply = (data) => route.fulfill({ headers: cors, json: { candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] } });
    if (url.includes(':generateContent')) {
      const prompt = body.contents[0].parts[0].text;
      if (prompt.includes('# TRANSCRIPT')) { m.suggestCalls++; return reply([{ label: 'Speaker 3', names: [{ name: 'Roman', evidence: '[0:32] host: "Roman."' }] }, { label: 'Speaker 2', names: [{ name: 'Maria', evidence: '[1:02] "Maria, go ahead"' }] }, { label: 'Speaker 1', names: [] }]); }
      m.aiCalls++;
      return reply([{ label: 'Speaker 3', match: 'NEW' }]);
    }
    if (!url.endsWith('/v1beta/interactions')) throw new Error('unexpected request ' + url);
    m.lastBody = body;
    const p = +body.input[0].uri.slice(1); m.asked.push(p);
    if (m.failPiece === p) return route.fulfill({ status: 400, headers: cors, json: { error: { message: 'boom' } } });
    const annotations = []; let text = '';
    const add = (t0, line, spk, step) => line.split(' ').forEach((w, j) => {
      const t = t0 + j * step;
      annotations.push({ type: 'word_info', text: w, start_offset: t.toFixed(2) + 's', end_offset: (t + step * 0.8).toFixed(2) + 's', speaker: spk });
      text += (text ? ' ' : '') + w;
    });
    for (let g = 15; g < 3840; g += 30) {
      if (g < PS[p] || g >= PE[p]) continue;
      const k = (g - 15) / 30, even = k % 2 === 0;
      let spk = (even !== (p > 0)) ? 'spk:0' : 'spk:1';
      let line = 'line ' + k + ' ' + WORDS.slice(k % 5, k % 5 + 9).join(' ') + '.';
      if (p === 2 && (g === 3015 || g === 3105)) { spk = 'spk:2'; line = 'guest ' + k + ' says something entirely different about hiring plans.'; }
      add(g - PS[p], line, spk, 0.4);
      if (opts.hallucination && p === 0 && g === 615) {
        const rep = Array.from({ length: 15 }, (_, r) => 'echo ' + WORDS.slice(r % 5, r % 5 + 9).join(' ')).join(' ');
        add(g - PS[p] + 6.5, rep, 'spk:1', 0.05);
      }
    }
    return route.fulfill({ headers: cors, json: { id: 'i' + p, status: 'completed', output_text: text, steps: [{ type: 'model_output', content: [{ type: 'text', text, annotations }] }] } });
  });
  return m;
}

const rows = (page) => page.$$eval('.seg', (x) => x.map((y) => ({
  who: y.querySelector('.who').textContent, text: y.querySelector('.text').textContent,
  edited: !!y.querySelector('.tag'), flag: y.querySelector('.flag') ? y.querySelector('.flag').textContent : ''
})));

module.exports = { ROOT, TMP, launch, startServer, writeAudio, mockGemini, rows };
