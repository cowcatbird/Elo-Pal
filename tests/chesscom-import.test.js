import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { chesscomUrl, gameReference, validateImportedSnapshot, IMPORT_PREFIX, IMPORT_TTL_MS, MAX_IMPORT_MOVES } from '../src/chesscom-import.js';
import { extractChesscomGame } from '../src/chesscom-extractor.js';
import { importFromTab } from '../background.js';

const URL = 'https://www.chess.com/analysis/game/live/123456789';
const PGN = '[White "Alice"]\n[Black "Bob"]\n[Link "https://www.chess.com/game/live/123456789"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';
const snapshot = (candidates = [{ format: 'pgn', text: PGN, method: 'board.game.getPGN' }]) => ({ sourceUrl: URL, candidates });

test('only HTTPS Chess.com apex and www pages qualify for one-click reading', () => {
  assert.equal(chesscomUrl('https://chess.com/analysis/?tab=analysis#board'), 'https://www.chess.com/analysis');
  for (const url of ['https://chess.com.evil.example/game/live/1', 'https://evilchess.com', 'http://www.chess.com', 'https://name:password@chess.com/analysis', 'https://chess.com:444/analysis', 'file:///chess.com', 'chrome://extensions']) assert.equal(chesscomUrl(url), null);
  assert.equal(gameReference(URL), 'live:123456789');
  assert.equal(gameReference('https://www.chess.com/game/daily/1234'), 'daily:1234');
});

test('PGN is legally replayed and canonicalized with its identity and names', () => {
  const result = validateImportedSnapshot(snapshot(), URL);
  assert.equal(result.moveCount, 6);
  assert.equal(result.method, 'board.game.getPGN');
  assert.match(result.pgn, /\[White "Alice"\]/);
  assert.match(result.pgn, /3\. Bb5 a6/);
});

test('fallback move history accepts SAN, figurines, and coordinate moves', () => {
  const result = validateImportedSnapshot(snapshot([{ format: 'moves', moves: ['e4', { from: 'e7', to: 'e5' }, '♘f3', 'b8c6', 'Bb5', 'a6'], method: 'history' }]), URL);
  assert.equal(result.moveCount, 6);
  assert.match(result.pgn, /2\. Nf3 Nc6/);
});

test('custom starting FEN is preserved while replaying a promotion history', () => {
  const result = validateImportedSnapshot(snapshot([{ format: 'moves', startFen: '7k/P7/6K1/8/8/8/8/8 w - - 0 1', moves: ['a8=Q+'] }]), URL);
  assert.match(result.pgn, /\[SetUp "1"\]/);
  assert.match(result.pgn, /a8=Q/);
});

test('invalid candidates can fall back, but foreign game identities cannot', () => {
  const valid = { format: 'moves', moves: ['e4', 'e5'] };
  assert.equal(validateImportedSnapshot(snapshot([{ format: 'pgn', text: '1. e4 Qh8' }, valid]), URL).moveCount, 2);
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'pgn', text: PGN.replaceAll('123456789', '999') }, valid]), URL), error => error.code === 'game-mismatch');
});

test('a partial board history never displaces the complete displayed main line', () => {
  const candidates = [
    { format: 'pgn', text: '1. e4 e5 *', method: 'partial PGN' },
    { format: 'moves', moves: ['e4', 'e5', 'Nf3'], method: 'partial history' },
    { format: 'moves', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], mainline: true, method: 'mainline' },
  ];
  assert.equal(validateImportedSnapshot(snapshot(candidates), URL).moveCount, 6);
  assert.equal(validateImportedSnapshot(snapshot(candidates), URL).method, 'mainline');
  candidates.unshift({ format: 'pgn', text: '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 *', method: 'selected variation' });
  assert.equal(validateImportedSnapshot(snapshot(candidates), URL).method, 'mainline');
  candidates.unshift({ format: 'pgn', text: PGN + ' 4. Ba4 Nf6', method: 'complete PGN' });
  // A valid full PGN may be longer than the rendered list's prefix.
  candidates[0].text = PGN.replace(' *', ' 4. Ba4 Nf6 *');
  assert.equal(validateImportedSnapshot(snapshot(candidates), URL).moveCount, 8);
});

test('unsupported variants are rejected in both snapshot and PGN headers', () => {
  assert.throws(() => validateImportedSnapshot({ ...snapshot(), variant: 'chess960' }, URL), error => error.code === 'unsupported-variant');
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'pgn', text: '[Variant "Crazyhouse"]\n1. e4 e5' }]), URL), error => error.code === 'unsupported-variant');
  assert.equal(validateImportedSnapshot({ ...snapshot(), variant: 'Standard' }, URL).moveCount, 6);
});

test('navigation, empty games, illegal moves and incomplete snapshots fail explicitly', () => {
  assert.throws(() => validateImportedSnapshot(snapshot(), URL.replace('123456789', '987')), error => error.code === 'page-changed');
  assert.throws(() => validateImportedSnapshot(snapshot([]), URL), error => error.code === 'no-game');
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'moves', moves: ['e5'] }]), URL), error => error.code === 'invalid-game');
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'moves', moves: ['e4', 'e5'], expectedPly: 6 }]), URL), error => error.code === 'invalid-game');
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'moves', moves: Array(MAX_IMPORT_MOVES + 1).fill('e4') }]), URL), error => error.code === 'invalid-game');
});

test('displaying an earlier move is accepted but an unrelated board position is not', () => {
  const earlier = new Chess(); earlier.move('e4');
  assert.equal(validateImportedSnapshot(snapshot([{ format: 'pgn', text: PGN, currentFen: earlier.fen() }]), URL).moveCount, 6);
  earlier.reset(); earlier.move('d4');
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'pgn', text: PGN, currentFen: earlier.fen() }]), URL), error => error.code === 'invalid-game');
  earlier.reset(); earlier.move('e4');
  const rawFen = earlier.fen().replace(' b KQkq - ', ' b KQkq e3 ');
  assert.equal(validateImportedSnapshot(snapshot([{ format: 'pgn', text: PGN, currentFen: rawFen }]), URL).moveCount, 6);
});

test('known displayed ply count rejects API prefixes even when DOM notation is unreadable', () => {
  assert.throws(() => validateImportedSnapshot({ ...snapshot([{ format: 'moves', moves: ['e4', 'e5'] }]), minimumPly: 6 }, URL), error => error.code === 'invalid-game');
});

function mockApi({ snap = snapshot(), values = {}, injectionError, storageError } = {}) {
  const calls = { scripts: [], tabs: [], removed: [] };
  const api = {
    scripting: { async executeScript(args) { calls.scripts.push(args); if (injectionError) throw new Error(injectionError); return [{ frameId: 0, result: snap }]; } },
    storage: { session: {
      async get() { return { ...values }; },
      async set(data) { if (storageError) throw new Error('Storage failed'); Object.assign(values, data); },
      async remove(keys) { calls.removed.push(...keys); keys.forEach(key => delete values[key]); },
    } },
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    tabs: { async create(tab) { calls.tabs.push(tab); } },
  };
  return { api, calls, values };
}

test('toolbar reads one MAIN frame and hands off through session storage without PGN in URL', async () => {
  const { api, calls, values } = mockApi();
  const result = await importFromTab({ id: 42, url: URL }, api, { now: () => 1000, token: () => 'one-token' });
  assert.equal(result.status, 'success');
  assert.equal(calls.scripts.length, 1);
  assert.deepEqual(calls.scripts[0].target, { tabId: 42 });
  assert.equal(calls.scripts[0].world, 'MAIN');
  assert.equal(calls.scripts[0].func, extractChesscomGame);
  assert.equal(values[IMPORT_PREFIX + 'one-token'].pgn, result.pgn);
  assert.equal(calls.tabs[0].url, 'chrome-extension://test/index.html?import=one-token');
  assert.ok(!calls.tabs[0].url.includes('Alice'));
});

test('wrong-site clicks open a useful error without injecting into another website', async () => {
  const { api, calls, values } = mockApi();
  await importFromTab({ id: 42, url: 'https://example.org' }, api, { token: () => 'wrong-site' });
  assert.equal(calls.scripts.length, 0);
  assert.equal(values[IMPORT_PREFIX + 'wrong-site'].code, 'wrong-site');
  assert.equal(calls.tabs.length, 1);
});

test('injection failure opens an explicit import failure rather than silently selecting a demo', async () => {
  const { api, values } = mockApi({ injectionError: 'Cannot access page' });
  await importFromTab({ id: 42, url: URL }, api, { token: () => 'blocked' });
  assert.equal(values[IMPORT_PREFIX + 'blocked'].status, 'error');
  assert.equal(values[IMPORT_PREFIX + 'blocked'].code, 'extraction-failed');
});

test('expired handoffs are removed while unrelated session settings remain', async () => {
  const now = IMPORT_TTL_MS + 10000;
  const { api, calls, values } = mockApi({ values: { [IMPORT_PREFIX + 'old']: { createdAt: 1 }, [IMPORT_PREFIX + 'recent']: { createdAt: now - 100 }, preference: true } });
  await importFromTab({ id: 42, url: URL }, api, { now: () => now, token: () => 'new' });
  assert.deepEqual(calls.removed, [IMPORT_PREFIX + 'old']);
  assert.equal(values.preference, true);
  assert.ok(values[IMPORT_PREFIX + 'recent']);
});

test('storage failures use a fixed error code with no game data in the URL', async () => {
  const { api, calls } = mockApi({ storageError: true });
  const result = await importFromTab({ id: 42, url: URL }, api);
  assert.equal(result.code, 'storage-unavailable');
  assert.equal(calls.tabs[0].url, 'chrome-extension://test/index.html?importError=storage-unavailable');
});

const visible = () => ({ width: 500, height: 500 });
async function withPage(document, run) {
  const oldDocument = globalThis.document, oldLocation = globalThis.location;
  globalThis.document = document;
  globalThis.location = { href: URL, protocol: 'https:', hostname: 'www.chess.com' };
  try { return await run(); }
  finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
  }
}

test('extractor uses feature-detected PGN API without page writes or network access', async () => {
  const board = { id: 'board-analysis-board', game: { getPGN: () => PGN }, dataset: {}, getBoundingClientRect: visible };
  await withPage({ querySelectorAll: selector => selector === 'wc-chess-board, chess-board' ? [board] : [] }, async () => {
    const extracted = await extractChesscomGame();
    assert.equal(extracted.candidates[0].method, 'board.game.getPGN');
    assert.equal(validateImportedSnapshot(extracted, URL).moveCount, 6);
  });
});

test('real-site main-line markup replays figurines and excludes variation nodes', async () => {
  const board = { id: 'board-analysis-board', dataset: {}, getBoundingClientRect: visible };
  const nodes = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'].map((san, index) => {
    const piece = /^[NB]/.test(san) ? san[0] : '';
    const content = { textContent: piece ? san.slice(1) : san, querySelector: () => piece ? { getAttribute: () => piece, className: 'icon-font-chess' } : null };
    return { getAttribute: () => `0-${index}`, querySelector: () => content };
  });
  const list = { getBoundingClientRect: visible, getAttribute: () => board.id, querySelectorAll: selector => selector === '.main-line-ply[data-node]' ? nodes : [] };
  const document = { querySelectorAll: selector => selector === 'wc-chess-board, chess-board' ? [board] : selector === 'wc-move-list, vertical-move-list, .vertical-move-list' ? [list] : [], querySelector: () => null };
  await withPage(document, async () => {
    const extracted = await extractChesscomGame();
    assert.equal(extracted.candidates[0].method, 'Chess.com main move list');
    assert.equal(validateImportedSnapshot(extracted, URL).moveCount, 6);
  });
  nodes[0].getAttribute = () => '0-2';
  await withPage(document, async () => {
    assert.equal((await extractChesscomGame()).candidates.length, 0);
  });
});

test('observed plain-text mainline markup is complete even when the API returns a prefix', async () => {
  const board = { id: 'board-analysis-board', dataset: {}, game: { getHistory: () => ['e4', 'e5'] }, getBoundingClientRect: visible };
  const nodes = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'].map((san, index) => ({ getAttribute: () => `0-${index}`, querySelector: () => ({ textContent: `${san} `, querySelector: () => null }) }));
  const variation = { getAttribute: () => '1-0', textContent: 'd4' };
  const list = { getBoundingClientRect: visible, getAttribute: () => board.id, querySelectorAll: selector => selector === '.main-line-ply[data-node]' ? nodes : [...nodes, variation] };
  const document = { querySelectorAll: selector => selector === 'wc-chess-board, chess-board' ? [board] : selector === 'wc-move-list, vertical-move-list, .vertical-move-list' ? [list] : [], querySelector: () => null };
  await withPage(document, async () => {
    const extracted = await extractChesscomGame();
    assert.equal(extracted.candidates.length, 2);
    const game = validateImportedSnapshot(extracted, URL);
    assert.equal(game.moveCount, 6);
    assert.equal(game.method, 'Chess.com main move list');
  });
});

test('unknown figurine cannot silently become a legal pawn move', async () => {
  const board = { id: 'board-analysis-board', dataset: {}, getBoundingClientRect: visible };
  const node = { getAttribute: () => '0-0', querySelector: () => ({ textContent: 'f3', querySelector: () => ({ getAttribute: () => 'unknown-piece', className: 'icon-font-chess' }) }) };
  const list = { getBoundingClientRect: visible, getAttribute: () => board.id, querySelectorAll: () => [node] };
  const document = { querySelectorAll: selector => selector === 'wc-chess-board, chess-board' ? [board] : selector === 'wc-move-list, vertical-move-list, .vertical-move-list' ? [list] : [], querySelector: () => null };
  await withPage(document, async () => assert.equal((await extractChesscomGame()).candidates.length, 0));
});

test('DOM extraction carries a custom initial position through legal replay', async () => {
  const board = { id: 'board-analysis-board', dataset: {}, game: { getStartingFEN: () => '7k/P7/6K1/8/8/8/8/8 w - - 0 1' }, getBoundingClientRect: visible };
  const node = { getAttribute: () => '0-0', querySelector: () => ({ textContent: 'a8=Q+', querySelector: () => null }) };
  const list = { getBoundingClientRect: visible, getAttribute: () => board.id, querySelectorAll: () => [node] };
  const document = { querySelectorAll: selector => selector === 'wc-chess-board, chess-board' ? [board] : selector === 'wc-move-list, vertical-move-list, .vertical-move-list' ? [list] : [], querySelector: () => null };
  await withPage(document, async () => {
    const game = validateImportedSnapshot(await extractChesscomGame(), URL);
    assert.equal(game.moveCount, 1);
    assert.match(game.pgn, /\[SetUp "1"\]/);
  });
});

test('player labels come from the White–Black title, not flipped board cards', async () => {
  const board = { id: 'board-analysis-board', dataset: {}, getBoundingClientRect: visible };
  const node = { getAttribute: () => '0-0', querySelector: () => ({ textContent: 'e4', querySelector: () => null }) };
  const list = { getBoundingClientRect: visible, getAttribute: () => board.id, querySelectorAll: () => [node] };
  const title = { querySelectorAll: () => [{ textContent: 'Alice' }, { textContent: 'Bob' }], querySelector: () => ({ textContent: '*' }) };
  const document = {
    querySelectorAll: selector => selector === 'wc-chess-board, chess-board' ? [board] : selector === 'wc-move-list, vertical-move-list, .vertical-move-list' ? [list] : [{ textContent: 'Bob' }, { textContent: 'Alice' }],
    querySelector: selector => selector === '.analysis-game-title-component' ? title : null,
  };
  // Restrict the PGN textarea query to its real empty result in this fixture.
  const select = document.querySelectorAll;
  document.querySelectorAll = selector => selector.startsWith('textarea') ? [] : select(selector);
  await withPage(document, async () => {
    const game = validateImportedSnapshot(await extractChesscomGame(), URL);
    assert.match(game.pgn, /\[White "Alice"\]/);
    assert.match(game.pgn, /\[Black "Bob"\]/);
  });
  document.querySelector = () => null;
  await withPage(document, async () => {
    const game = validateImportedSnapshot(await extractChesscomGame(), URL);
    assert.doesNotMatch(game.pgn, /\[White "(?:Alice|Bob)"\]/);
  });
});

test('extractor rejects multiple visible boards instead of importing an arbitrary game', async () => {
  const board = { getBoundingClientRect: visible };
  await withPage({ querySelectorAll: () => [board, board] }, async () => {
    assert.equal((await extractChesscomGame()).error, 'ambiguous-board');
  });
});
