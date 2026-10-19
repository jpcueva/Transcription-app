const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('page version, version.json and script cache-busters agree', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  const appVersion = /var APP_VERSION = '([^']+)', APP_DATE = '([^']+)'/.exec(html);
  assert.ok(appVersion, 'APP_VERSION not found');
  assert.equal(appVersion[1], json.version);
  assert.equal(appVersion[2], json.date);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 6);
  scripts.forEach((s) => assert.equal(s.split('?v=')[1], json.version, s));
});
