import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('resolved page has unique IDs and one external script and stylesheet', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'HTML IDs must not be duplicated');
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css">/);
  assert.equal((html.match(/<script\b/g) || []).length, 1, 'the UI must not have a competing inline handler script');
  assert.doesNotMatch(html, /<style\b/);
});

test('resolved page preserves configurable backend URL and Debugger, CodeTrim, Verify, and model-check controls', () => {
  assert.match(html, /id="apiBase"[^>]*value="http:\/\/127\.0\.0\.1:8000"/);
  for (const id of ['tab-debug', 'tab-trim', 'tab-verify', 'runAction', 'verifyAction', 'checkConnection', 'modelList', 'loadSample']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} control should exist`);
  }
  assert.match(html, /id="sourceCode"/);
  assert.match(html, /id="errorMessage"/);
  assert.match(html, /id="trimGoal"/);
});
