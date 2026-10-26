import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { importSource, sourceGameReference } from '../src/import-sources.js';
import { chesscomUrl, gameReference, ChesscomImportError, validateImportedSnapshot } from '../src/chesscom-import.js';

const PAGE = 'https://lichess.org/game/AbCd1234/black/analysis';
const PGN = '[Event "Casual rapid game"]\n[Site "https://lichess.org/AbCd1234"]\n[White "Alice"]\n[Black "Bob"]\n[WhiteElo "1800"]\n[BlackElo "1820"]\n[Variant "Standard"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';
const snapshot = (candidates = [{ format: 'pgn', text: PGN, method: 'Lichess game export' }], sourceUrl = PAGE) => ({ source: 'lichess.org', sourceUrl, candidates });
const errorCode = code => error => error instanceof ChesscomImportError && error.code === code;

test('supported provider URLs canonicalize HTTPS origins and remove query/hash', () => {
  assert.deepEqual(importSource('https://www.lichess.org/AbCd1234/black/?ply=3#8'), { source: 'lichess.org', label: 'Lichess', url: 'https://lichess.org/AbCd1234/black' });
  assert.deepEqual(importSource('https://chess.com/analysis/?tab=review#move'), { source: 'chess.com', label: 'Chess.com', url: 'https://www.chess.com/analysis' });
  assert.equal(importSource('https://LICHESS.ORG').url, 'https://lichess.org/');
  assert.equal(chesscomUrl('https://lichess.org/AbCd1234'), null);
  assert.equal(gameReference('https://chess.com/game/live/123'), 'live:123');
});

test('provider recognition rejects credentials, ports, suffixes, and URL parser tricks', () => {
  for (const value of [
    null, {}, 'http://lichess.org/AbCd1234', 'https://lichess.org.evil.test/AbCd1234',
    'https://evillichess.org/AbCd1234', 'https://api.lichess.org/AbCd1234',
    'https://user@lichess.org/AbCd1234', 'https://lichess.org@evil.test/AbCd1234',
    'https://lichess.org:443/AbCd1234', 'https://lichess.org:8443/AbCd1234',
    'https://www.chess.com:443/game/live/1', 'https://lichess.org./AbCd1234',
    'https://%6cichess.org/AbCd1234', 'https://lichess.org\\@evil.test/AbCd1234',
    'https://lichess.org\n/AbCd1234', 'javascript:https://lichess.org/AbCd1234',
  ]) assert.equal(importSource(value), null, String(value));
});

test('game references cover current and legacy routes without retaining private tokens', () => {
  for (const path of ['/AbCd1234', '/AbCd1234/white', '/AbCd1234/black/analysis', '/game/AbCd1234', '/game/AbCd1234/black', '/game/AbCd1234/white/analysis', '/AbCd1234WXYZ', '/game/AbCd1234WXYZ']) {
    assert.deepEqual(sourceGameReference(`https://lichess.org${path}`), { source: 'lichess.org', kind: 'game', id: 'AbCd1234', key: 'lichess.org:game:AbCd1234' });
  }
  assert.deepEqual(sourceGameReference('https://chess.com/analysis/game/daily/987'), { source: 'chess.com', kind: 'game', gameType: 'daily', id: '987', key: 'chess.com:daily:987' });
  for (const path of ['/analysis', '/analysis/pgn/1.e4', '/analysis/standard', '/game/AbCd123', '/game/AbCd12345', '/game/AbCd1234/surprise', '/game/AbCd1234_more']) assert.equal(sourceGameReference(`https://lichess.org${path}`), null, path);
});

test('study references retain chapter identity independently of game references', () => {
  assert.deepEqual(sourceGameReference('https://lichess.org/study/Study123/Chap1234#3'), { source: 'lichess.org', kind: 'study', id: 'Study123', chapterId: 'Chap1234', key: 'lichess.org:study:Study123:Chap1234' });
  assert.equal(sourceGameReference('https://lichess.org/study/Study123').chapterId, null);
  assert.equal(sourceGameReference('https://lichess.org/study/Study123/Chap12345'), null);
});

test('Lichess PGN is replayed with source identity, names, and ratings intact', () => {
  const result = validateImportedSnapshot(snapshot(), PAGE);
  assert.equal(result.source, 'lichess.org');
  assert.equal(result.sourceUrl, PAGE);
  assert.equal(result.moveCount, 6);
  assert.match(result.pgn, /\[White "Alice"\]/);
  assert.match(result.pgn, /\[BlackElo "1820"\]/);
  assert.match(result.pgn, /3\. Bb5 a6/);
  const privatePage = 'https://www.lichess.org/AbCd1234WXYZ?foo=bar#6';
  assert.equal(validateImportedSnapshot(snapshot(undefined, privatePage), privatePage).moveCount, 6);
});

test('known game identity conflicts reject even when another candidate is valid', () => {
  const valid = { format: 'moves', moves: ['e4', 'e5'] };
  for (const foreign of ['https://lichess.org/ZzZz9876', 'https://lichess.org/game/abcd1234', 'https://chess.com/game/live/123', 'https://lichess.org/study/Study123/Chap1234']) {
    const wrong = PGN.replace('https://lichess.org/AbCd1234', foreign);
    assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'pgn', text: wrong }, valid]), PAGE), errorCode('game-mismatch'));
  }
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'pgn', text: PGN.replace('[White ', '[Link "https://lichess.org/ZzZz9876"]\n[White ') }]), PAGE), errorCode('game-mismatch'));
});

test('source-page and provider changes fail independently of PGN legality', () => {
  assert.throws(() => validateImportedSnapshot(snapshot(), PAGE.replace('/black/', '/white/')), errorCode('page-changed'));
  assert.throws(() => validateImportedSnapshot({ ...snapshot(), source: 'chess.com' }, PAGE), errorCode('page-changed'));
  assert.throws(() => validateImportedSnapshot(snapshot(), 'https://lichess.org.evil.test/game/AbCd1234'), errorCode('wrong-site'));
});

test('delayed ongoing-game exports explain why the complete game cannot be imported', () => {
  assert.throws(() => validateImportedSnapshot({ ...snapshot(), error: 'ongoing-game' }, PAGE), error => error.code === 'ongoing-game' && /Lichess delays exports/.test(error.message));
  const chesscom = 'https://www.chess.com/game/live/123';
  const data = { sourceUrl: chesscom, error: 'ongoing-game', candidates: [{ format: 'moves', moves: ['e4', 'e5'] }] };
  assert.equal(validateImportedSnapshot(data, chesscom).moveCount, 2);
});

test('unavailable and timed-out Lichess exports give useful recovery guidance', () => {
  for (const [code, message] of [
    ['export-unavailable', /public PGN export.*Download PGN/],
    ['export-timeout', /took too long.*Try again/],
    ['export-too-large', /too large.*individual study chapter/],
    ['invalid-pgn', /readable PGN.*Download PGN/],
    ['unsupported-page', /game, analysis board, or individual study chapter/],
  ]) {
    assert.throws(() => validateImportedSnapshot({ ...snapshot(), error: code }, PAGE), error => error instanceof ChesscomImportError && error.code === code && message.test(error.message));
  }
});

test('chapter extraction failures reject stale data even when the source URL is unchanged', () => {
  const page = 'https://lichess.org/study/Study123';
  assert.throws(() => validateImportedSnapshot({ ...snapshot(undefined, page), error: 'page-changed' }, page), error => error.code === 'page-changed' && /selected study chapter changed/.test(error.message));
  assert.throws(() => validateImportedSnapshot({ ...snapshot(undefined, page), error: 'no-selected-chapter' }, page), error => error.code === 'no-selected-chapter' && /Select a chapter/.test(error.message));
});

test('study chapter links are checked while original-game provenance remains valid', () => {
  const page = 'https://lichess.org/study/Study123/Chap1234';
  assert.equal(validateImportedSnapshot(snapshot(undefined, page), page).moveCount, 6);
  const withLink = link => PGN.replace('[Event ', `[Link "${link}"]\n[Event `);
  assert.equal(validateImportedSnapshot(snapshot([{ format: 'pgn', text: withLink(page) }], page), page).moveCount, 6);
  for (const foreign of ['https://lichess.org/study/Other123/Chap1234', 'https://lichess.org/study/Study123/Other123']) {
    assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'pgn', text: withLink(foreign) }], page), page), errorCode('game-mismatch'));
  }
  const studyRoot = 'https://lichess.org/study/Study123';
  assert.equal(validateImportedSnapshot(snapshot([{ format: 'pgn', text: withLink(page) }], studyRoot), studyRoot).moveCount, 6);
});

test('variant validation allows only standard rules and explicit standard From Position FENs', () => {
  for (const variant of ['chess960', 'Crazyhouse', 'atomic', 'antichess', 'Three-check']) {
    assert.throws(() => validateImportedSnapshot({ ...snapshot(), variant }, PAGE), errorCode('unsupported-variant'));
    assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'pgn', text: PGN.replace('Standard', variant) }]), PAGE), errorCode('unsupported-variant'));
  }
  const custom = { format: 'moves', startFen: '7k/P7/6K1/8/8/8/8/8 w - - 0 1', headers: { Variant: 'From Position' }, moves: ['a8=Q+'] };
  assert.equal(validateImportedSnapshot({ ...snapshot([custom]), variant: 'fromPosition' }, PAGE).moveCount, 1);
  assert.throws(() => validateImportedSnapshot({ ...snapshot(), variant: 'fromPosition' }, PAGE), errorCode('invalid-game'));
  const wrongCastling = { format: 'moves', startFen: '4k3/8/8/8/8/8/8/1K5R w K - 0 1', headers: { Variant: 'From Position' }, moves: ['Rh2'] };
  assert.throws(() => validateImportedSnapshot(snapshot([wrongCastling]), PAGE), errorCode('invalid-game'));
});

test('displayed-board and complete-ply guards also protect Lichess imports', () => {
  const board = new Chess(); board.move('e4');
  assert.equal(validateImportedSnapshot(snapshot([{ format: 'pgn', text: PGN, currentFen: board.fen() }]), PAGE).moveCount, 6);
  board.reset(); board.move('d4');
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'pgn', text: PGN, currentFen: board.fen() }]), PAGE), errorCode('invalid-game'));
  assert.throws(() => validateImportedSnapshot({ ...snapshot(), minimumPly: 7 }, PAGE), errorCode('invalid-game'));
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'moves', moves: ['e4', 'e5'], expectedPly: 6 }]), PAGE), errorCode('invalid-game'));
  assert.throws(() => validateImportedSnapshot(snapshot([{ format: 'pgn', text: '1. e4 Qh8' }]), PAGE), errorCode('invalid-game'));
});

test('verified complete mainlines beat selected variations and retain fallback ratings', () => {
  const result = validateImportedSnapshot(snapshot([
    { format: 'pgn', text: '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 *' },
    { format: 'moves', moves: ['e4', 'e5', 'Nf3', 'Nc6'], headers: { White: 'Alice', Black: 'Bob', WhiteElo: '1800', BlackElo: '1820' }, mainline: true },
  ]), PAGE);
  assert.equal(result.moveCount, 4);
  assert.match(result.pgn, /\[WhiteElo "1800"\]/);
  assert.match(result.pgn, /2\. Nf3 Nc6/);
});
