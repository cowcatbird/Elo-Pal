import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLichessGame } from '../src/lichess-extractor.js';
import { validateImportedSnapshot } from '../src/chesscom-import.js';

const GAME = 'https://lichess.org/game/Ab12Cd34';
const PGN = '[Event "Test"]\n[Site "https://lichess.org/Ab12Cd34"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0';
const visible = () => ({ width: 500, height: 500 });
const element = ({ classes = '', queries = {}, attributes = {}, ...props } = {}) => ({
  className: classes, classList: { contains: name => classes.split(' ').includes(name) },
  getBoundingClientRect: visible, querySelectorAll: selector => queries[selector] || [],
  getAttribute: name => attributes[name] ?? null, ...props,
});
const moveTree = (count, inline = false) => element({
  classes: inline ? 'tview2 tview2-inline' : 'tview2 tview2-column',
  queries: { [inline ? ':scope > move.mainline[p]' : ':scope > move[p]']: Array.from({ length: count }, (_, index) => element({ attributes: { p: 'ab'.repeat(index + 1) } })) },
});
const root = (queries = {}, classes = 'analyse variant-standard') => element({ classes, queries });
const documentFor = (board = root(), selected = []) => ({ querySelectorAll: selector => selector === 'main.analyse, .round__app' ? (Array.isArray(board) ? board : [board]) : selector === '.study__chapters .study-list > button.active[data-id]' ? selected : [] });
const chapter = id => element({ attributes: { 'data-id': id } });
function response(text = PGN, { url, type = 'application/x-chess-pgn', status = 200, redirected = false, headers = {}, body } = {}) {
  const result = new Response(body || text, { status, headers: { 'content-type': type, ...headers } });
  Object.defineProperties(result, { url: { value: url || 'https://lichess.org/game/export/Ab12Cd34' }, redirected: { value: redirected } });
  return result;
}
async function withPage({ url = GAME, document = documentFor(), fetch: fetcher, timers } = {}, run) {
  const keys = ['location', 'document', 'fetch', ...(timers ? ['setTimeout', 'clearTimeout'] : [])];
  const old = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const calls = [];
  globalThis.location = { href: url };
  globalThis.document = document;
  globalThis.fetch = async (input, options) => { calls.push({ url: input, options }); return fetcher ? fetcher(input, options) : response(PGN, { url: input }); };
  if (timers) { globalThis.setTimeout = timers.setTimeout; globalThis.clearTimeout = timers.clearTimeout; }
  try { return await run(calls); }
  finally { for (const key of keys) { if (old[key]) Object.defineProperty(globalThis, key, old[key]); else delete globalThis[key]; } }
}

test('serialized MAIN-world function reads the exact public game without credentials', async () => {
  await withPage({}, async calls => {
    const serialized = Function(`return (${extractLichessGame.toString()})`)();
    const snapshot = await serialized();
    assert.equal(snapshot.candidates.length, 1);
    assert.equal(snapshot.variant, 'standard');
    assert.equal(snapshot.candidates[0].mainline, true);
    assert.equal(validateImportedSnapshot(snapshot, GAME).moveCount, 6);
    assert.equal(calls.length, 1);
    const request = new URL(calls[0].url);
    assert.equal(request.pathname, '/game/export/Ab12Cd34');
    assert.equal(request.searchParams.get('moves'), 'true');
    assert.equal(request.searchParams.get('evals'), 'false');
    assert.equal(calls[0].options.credentials, 'omit');
    assert.equal(calls[0].options.mode, 'same-origin');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.headers.Authorization, undefined);
  });
});

test('game orientations, analysis routes and private player URLs export only the public eight-character ID', async () => {
  for (const path of ['/Ab12Cd34', '/Ab12Cd34/black', '/Ab12Cd34/white/analysis', '/Ab12Cd34abcd', '/game/Ab12Cd34', '/game/Ab12Cd34/black/analysis', '/game/Ab12Cd34abcd']) {
    await withPage({ url: `https://lichess.org${path}#12` }, async calls => {
      assert.equal((await extractLichessGame()).candidates.length, 1, path);
      assert.equal(new URL(calls[0].url).pathname, '/game/export/Ab12Cd34');
      assert.ok(!calls[0].url.includes('abcd'));
    });
  }
});

test('profiles, puzzles, TV, exports, reserved pages and non-Lichess origins never trigger a fetch', async () => {
  const urls = ['/training', '/practice', '/openings', '/@/Ab12Cd34', '/tv', '/tv/Ab12Cd34', '/study/Ab12Cd34.pgn', '/study/embed/Ab12Cd34/Ef56Gh78', '/game/export/Ab12Cd34', '/analysis/help', '/Ab12Cd34/other']
    .map(path => `https://lichess.org${path}`)
    .concat(['http://lichess.org/Ab12Cd34', 'https://lichess.org:444/Ab12Cd34', 'https://lichess.org:443/Ab12Cd34', 'https://lichess.org.evil.example/Ab12Cd34', 'https://name:secret@lichess.org/Ab12Cd34']);
  for (const url of urls) await withPage({ url }, async calls => {
    assert.equal((await extractLichessGame()).error, 'unsupported-page', url);
    assert.equal(calls.length, 0);
  });
});

test('an unloaded page, a hidden board and multiple boards cannot supply a game', async () => {
  for (const [board, error] of [[[], 'no-game'], [[root(), root()], 'ambiguous-board'], [element({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }), 'no-game']]) {
    await withPage({ document: documentFor(board) }, async calls => {
      assert.equal((await extractLichessGame()).error, error);
      assert.equal(calls.length, 0);
    });
  }
});

test('column and inline mainline paths reject an export missing visible moves', async () => {
  for (const inline of [false, true]) {
    await withPage({ document: documentFor(root({ '.analyse__moves .tview2': [moveTree(8, inline)] })) }, async () => {
      const snapshot = await extractLichessGame();
      assert.equal(snapshot.minimumPly, 8);
      assert.throws(() => validateImportedSnapshot(snapshot, GAME), error => error.code === 'invalid-game');
    });
  }
});

test('mainline bound excludes user-added nongame moves and does not count variation descendants', async () => {
  const tree = element({ classes: 'tview2-column', queries: {
    ':scope > move[p]': [element({ attributes: { p: 'ab' } }), element({ attributes: { p: 'abcd' } }), element({ classes: 'nongame', attributes: { p: 'abcdef' } })],
    'move[p]': Array.from({ length: 200 }, () => element({ attributes: { p: 'fake' } })),
  } });
  await withPage({ document: documentFor(root({ '.analyse__moves .tview2': [tree] })) }, async () => assert.equal((await extractLichessGame()).minimumPly, 2));
});

test('round replay count handles a Black-to-move custom start without using absolute move numbers', async () => {
  const children = [['QZM', '23'], ['Z7YX', '…'], ['Z7YX', 'Kf7'], ['QZM', '24'], ['Z7YX', 'Kg3'], ['Z7YX', 'Kg6']].map(([tagName, textContent]) => element({ tagName, textContent }));
  const board = root({ 'i5d app': [element({ children })] }, 'round__app variant-standard');
  await withPage({ document: documentFor(board) }, async () => assert.equal((await extractLichessGame()).minimumPly, 3));
});

test('new visible moves arriving during export raise the minimum length', async () => {
  const queries = { '.analyse__moves .tview2': [moveTree(4)] };
  await withPage({ document: documentFor(root(queries)), fetch: url => { queries['.analyse__moves .tview2'] = [moveTree(8)]; return response(PGN, { url }); } }, async () => {
    assert.equal((await extractLichessGame()).minimumPly, 8);
  });
});

test('ongoing public game exports are never presented as complete, even without a rendered move list', async () => {
  await withPage({ fetch: url => response(PGN.replaceAll('1-0', '*'), { url }) }, async () => {
    const snapshot = await extractLichessGame();
    assert.equal(snapshot.error, 'ongoing-game');
    assert.deepEqual(snapshot.candidates, []);
  });
});

test('manual analysis reads only its exact PGN field and checks against the displayed FEN', async () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const board = root({ '.copyables .pgn textarea.copyable': [element({ value: PGN.replaceAll('1-0', '*') })], '.copyables input.copyable': [element({ value: fen })] });
  await withPage({ url: 'https://lichess.org/analysis', document: documentFor(board) }, async calls => {
    const snapshot = await extractLichessGame();
    assert.equal(snapshot.candidates[0].currentFen, fen);
    assert.equal(validateImportedSnapshot(snapshot, location.href).moveCount, 6);
    assert.equal(calls.length, 0);
  });
});

test('manual custom positions preserve the explicit starting FEN required by the validator', async () => {
  const fen = '7k/P7/6K1/8/8/8/8/8 w - - 0 1';
  const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n[Variant "From Position"]\n\n1. a8=Q+ *`;
  const board = root({ '.copyables .pgn textarea.copyable': [element({ value: pgn })] }, 'analyse variant-fromPosition');
  await withPage({ url: 'https://lichess.org/analysis/standard/custom', document: documentFor(board) }, async () => {
    const snapshot = await extractLichessGame();
    assert.equal(snapshot.candidates[0].startFen, fen);
    assert.equal(validateImportedSnapshot(snapshot, location.href).moveCount, 1);
  });
});

test('legal PGN comments and tags may contain angle brackets without being mistaken for HTML', async () => {
  const text = PGN.replace('[Event "Test"]', '[Event "Alice < Bob > Carol"]').replace('1. e4 e5', '1. e4 { eval > +1, time < 30 } e5');
  await withPage({ fetch: url => response(text, { url }) }, async () => {
    assert.equal(validateImportedSnapshot(await extractLichessGame(), GAME).moveCount, 6);
  });
  await withPage({ url: 'https://lichess.org/analysis', document: documentFor(root({ '.copyables .pgn textarea.copyable': [element({ value: text })] })) }, async () => {
    assert.equal(validateImportedSnapshot(await extractLichessGame(), location.href).moveCount, 6);
  });
});

test('invalid or ambiguous manual PGN fields cannot silently select unrelated textareas', async () => {
  for (const fields of [[], [element({ value: PGN, classes: 'is-error' })], [element({ value: PGN }), element({ value: PGN })]]) {
    await withPage({ url: 'https://lichess.org/analysis', document: documentFor(root({ '.copyables .pgn textarea.copyable': fields, textarea: [element({ value: PGN })] })) }, async calls => {
      assert.equal((await extractLichessGame()).error, 'no-game');
      assert.equal(calls.length, 0);
    });
  }
});

test('public study export targets the exact selected chapter and may retain its original game Site', async () => {
  for (const path of ['/study/St12Ud34/Ch56Ap78', '/study/St12Ud34']) {
    await withPage({ url: `https://lichess.org${path}`, document: documentFor(root(), [chapter('Ch56Ap78')]), fetch: url => response(PGN.replaceAll('1-0', '*'), { url }) }, async calls => {
      const snapshot = await extractLichessGame();
      assert.equal(snapshot.candidates.length, 1);
      assert.equal(new URL(calls[0].url).pathname, '/api/study/St12Ud34/Ch56Ap78.pgn');
      assert.equal(new URL(calls[0].url).searchParams.get('variations'), 'false');
      assert.equal(validateImportedSnapshot(snapshot, location.href).moveCount, 6);
    });
  }
});

test('a study without a selected chapter never falls back to the first chapter or bulk export', async () => {
  await withPage({ url: 'https://lichess.org/study/St12Ud34' }, async calls => {
    assert.equal((await extractLichessGame()).error, 'no-selected-chapter');
    assert.equal(calls.length, 0);
  });
});

test('study chapter transitions are detected before and during requests, even if the URL is unchanged', async () => {
  await withPage({ url: 'https://lichess.org/study/St12Ud34/Ch56Ap78', document: documentFor(root(), [chapter('Ot12He34')]) }, async calls => {
    assert.equal((await extractLichessGame()).error, 'page-changed');
    assert.equal(calls.length, 0);
  });
  const selected = [chapter('Ch56Ap78')];
  await withPage({ url: 'https://lichess.org/study/St12Ud34', document: documentFor(root(), selected), fetch: url => { selected[0] = chapter('Ot12He34'); return response(PGN, { url }); } }, async () => {
    const snapshot = await extractLichessGame();
    assert.equal(snapshot.error, 'page-changed');
    assert.deepEqual(snapshot.candidates, []);
  });
});

test('navigation during an export reports the final page URL for independent source validation', async () => {
  await withPage({ fetch: url => { location.href = 'https://lichess.org/game/Ot12He34'; return response(PGN, { url }); } }, async () => {
    const snapshot = await extractLichessGame();
    assert.equal(snapshot.sourceUrl, 'https://lichess.org/game/Ot12He34');
    assert.throws(() => validateImportedSnapshot(snapshot, GAME), error => error.code === 'page-changed');
  });
});

test('redirects, different games, offsite responses, non-PGN bodies and protected exports fail closed', async () => {
  const cases = [
    { redirected: true }, { url: 'https://lichess.org/game/export/Ot12He34' }, { url: 'https://example.org/game/export/Ab12Cd34' },
    { type: 'text/html' }, { status: 401 }, { status: 404 },
  ];
  for (const options of cases) await withPage({ fetch: () => response(PGN, options) }, async () => assert.equal((await extractLichessGame()).candidates.length, 0));
  for (const text of ['<!doctype html><h1>Sign in</h1>', '{"pgn":"not a PGN response"}', '']) {
    await withPage({ fetch: () => response(text, { type: 'text/plain' }) }, async () => assert.equal((await extractLichessGame()).error, 'invalid-pgn'));
  }
});

test('response Content-Length and streamed UTF-8 bytes both enforce the 256 KiB limit', async () => {
  await withPage({ fetch: () => response(PGN, { headers: { 'content-length': '262145' } }) }, async () => assert.equal((await extractLichessGame()).error, 'export-too-large'));
  await withPage({ fetch: () => response(PGN + 'é'.repeat(132000)) }, async () => assert.equal((await extractLichessGame()).error, 'export-too-large'));
  await withPage({ url: 'https://lichess.org/analysis', document: documentFor(root({ '.copyables .pgn textarea.copyable': [element({ value: PGN + 'é'.repeat(132000) })] })) }, async () => assert.equal((await extractLichessGame()).error, 'invalid-pgn'));
});

test('hung exports are bounded by a four-second timer and abort their request', async () => {
  let milliseconds;
  const timers = { setTimeout: (callback, delay) => { milliseconds = delay; queueMicrotask(callback); return 1; }, clearTimeout() {} };
  await withPage({ timers, fetch: () => new Promise(() => {}) }, async calls => {
    const snapshot = await extractLichessGame();
    assert.equal(snapshot.error, 'export-timeout');
    assert.equal(milliseconds, 4000);
    assert.equal(calls[0].options.signal.aborted, true);
  });
});
