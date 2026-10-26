import test from 'node:test';
import assert from 'node:assert/strict';
import { importFromTab } from '../background.js';
import { extractLichessGame } from '../src/lichess-extractor.js';
import { consumeImportSession } from '../src/import-session.js';

const url = 'https://lichess.org/game/AbCd1234/black/analysis';
const pgn = '[Site "https://lichess.org/AbCd1234"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 Nc6 *';
const token = '12345678-abcd-4321-abcd-123456789abc';

function setup(snapshot = { sourceUrl: url, candidates: [{ format: 'pgn', text: pgn, method: 'Lichess game export' }] }) {
  const values = {}, calls = { scripts: [], tabs: [] };
  const session = {
    async get(key) { return key == null ? { ...values } : { [key]: values[key] }; },
    async set(data) { Object.assign(values, data); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
  const api = {
    scripting: { async executeScript(args) { calls.scripts.push(args); return [{ frameId: 0, result: snapshot }]; } },
    storage: { session },
    runtime: { getURL: path => `chrome-extension://elo-pal/${path}` },
    tabs: { async create(args) { calls.tabs.push(args); } },
  };
  return { api, calls, values, session };
}

test('Lichess toolbar click dispatches its own extractor and consumes a validated private handoff', async () => {
  const { api, calls, values, session } = setup();
  const result = await importFromTab({ id: 9, url }, api, { token: () => token, now: () => 1000 });
  assert.equal(result.status, 'success');
  assert.equal(result.source, 'lichess.org');
  assert.equal(result.moveCount, 4);
  assert.equal(calls.scripts.length, 1);
  assert.deepEqual(calls.scripts[0].target, { tabId: 9 });
  assert.equal(calls.scripts[0].world, 'MAIN');
  assert.equal(calls.scripts[0].func, extractLichessGame);
  assert.deepEqual(calls.tabs, [{ url: `chrome-extension://elo-pal/index.html?import=${token}` }]);
  assert.equal(Object.keys(values).length, 1);
  const imported = await consumeImportSession(token, { storage: session, now: 1001 });
  assert.equal(imported.status, 'success');
  assert.equal(imported.sourceLabel, 'Lichess');
  assert.match(imported.pgn, /2\. Nf3 Nc6/);
  assert.equal(Object.keys(values).length, 0);
});

test('Lichess failures remain source-specific and open the manual-import fallback', async () => {
  const { api, calls, values } = setup();
  api.scripting.executeScript = async () => { throw new Error('Blocked'); };
  const result = await importFromTab({ id: 9, url }, api, { token: () => token, now: () => 1000 });
  assert.equal(result.status, 'error');
  assert.equal(result.source, 'lichess.org');
  assert.match(result.message, /Lichess/);
  assert.equal(values['rook.import.' + token].code, 'extraction-failed');
  assert.equal(calls.tabs.length, 1);
});

test('navigation and different game exports fail instead of importing the wrong Lichess game', async () => {
  for (const snapshot of [
    { sourceUrl: url.replace('AbCd1234', 'EfGh5678'), candidates: [{ format: 'pgn', text: pgn }] },
    { sourceUrl: url, candidates: [{ format: 'pgn', text: pgn.replace('AbCd1234', 'EfGh5678') }] },
  ]) {
    const { api } = setup(snapshot);
    const result = await importFromTab({ id: 9, url }, api, { token: () => token, now: () => 1000 });
    assert.equal(result.status, 'error');
    assert.ok(['page-changed', 'game-mismatch'].includes(result.code));
  }
});

test('lookalike Lichess hosts never receive an injected script', async () => {
  const { api, calls } = setup();
  const result = await importFromTab({ id: 9, url: 'https://lichess.org.example.test/AbCd1234' }, api, { token: () => token });
  assert.equal(result.code, 'wrong-site');
  assert.equal(calls.scripts.length, 0);
});
