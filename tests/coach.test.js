import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGame, DEMO_PGN, evaluateMove } from '../src/model.js';
import { getCoachMessage } from '../src/coach.js';

const messageFor = (pgn, options = {}) => {
  const game = parseGame(pgn);
  return getCoachMessage({ game, ply: game.moves.length, ...options });
};
const setup = (fen, moves) => `[SetUp "1"]\n[FEN "${fen}"]\n\n${moves} *`;

test('the coach introduces itself before review and explains a position study', () => {
  const game = parseGame('1. e4 e5 *');
  const initial = getCoachMessage({ game, ply: 0 });
  assert.match(initial.title, /Coach Cat/);
  assert.match(initial.text, /Review the game/);
  const study = getCoachMessage({ game: parseGame('7k/8/8/8/8/8/8/KR6 w - - 0 1') });
  assert.match(study.text, /explore this position/);
  assert.doesNotThrow(() => getCoachMessage());
});

test('unknown move quality gives observable facts and requests review', () => {
  const message = messageFor('1. e4 e5 2. Nf3 *');
  assert.match(message.text, /develops the knight from g1/);
  assert.match(message.text, /d4 and e5/);
  assert.match(message.tip, /Run a game review/);
  assert.doesNotMatch(message.text, /best|blunder|wins|loses/);
});

test('variation commentary does not reuse a selected main-line grade', () => {
  const message = messageFor(DEMO_PGN, { variation: true, review: { key: 'blunder' } });
  assert.match(message.text, /different continuation/);
  assert.doesNotMatch(message.text, /Checkmate|blunder|wins/);
  assert.equal(message.mood, 'thinking');
});

test('checkmate describes the correct winning side without needing a review', () => {
  const white = messageFor(DEMO_PGN);
  assert.match(white.text, /Rd8# ends the game/);
  assert.match(white.text, /White wins/);
  const black = messageFor('1. f3 e5 2. g4 Qh4# 0-1');
  assert.match(black.text, /Black wins/);
  assert.match(black.text, /no legal escape/);
});

test('terminal FEN positions explain stalemate and insufficient material', () => {
  const stale = getCoachMessage({ game: parseGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1') });
  assert.match(stale.text, /stalemate/);
  assert.match(stale.text, /Black has no legal move/);
  const bareKings = getCoachMessage({ game: parseGame('7k/8/8/8/8/8/8/K7 w - - 0 1') });
  assert.match(bareKings.text, /insufficient material/);
  const fifty = getCoachMessage({ game: parseGame('7k/8/8/8/8/8/8/KR6 w - - 100 51') });
  assert.match(fifty.text, /at least fifty moves/);
});

test('castling explains rook activity without assuming king safety', () => {
  const white = messageFor('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O *', { review: { key: 'good' } });
  assert.match(white.text, /rook to f1/);
  assert.match(white.text, /king on g1/);
  assert.match(white.text, /open lines/);
  const black = messageFor(setup('r3k2r/ppp2ppp/8/8/8/8/PPP2PPP/R3K2R b KQkq - 0 1', '1... O-O-O'), { review: { key: 'good' } });
  assert.match(black.text, /rook to d8/);
  assert.match(black.text, /king on c8/);
  assert.doesNotMatch(black.text, /king is safe|wins/);
});

test('capture and en-passant explanations identify the correct captured piece', () => {
  const capture = messageFor('1. e4 d5 2. exd5 *', { review: { key: 'best' } });
  assert.match(capture.text, /takes the pawn on d5/);
  assert.match(capture.text, /Black can recapture with Qxd5/);
  const ep = messageFor('1. e4 a6 2. e5 d5 3. exd6 *', { review: { key: 'good' } });
  assert.match(ep.text, /pawn on d5 en passant/);
});

test('real double attacks require actual legal captures and promise no material win', () => {
  const fork = messageFor(setup('r3k3/8/8/1N6/8/8/8/7K w - - 0 1', '1. Nc7+'), { review: { key: 'best' } });
  assert.match(fork.text, /attacks the king on e8 and the rook on a8 at once/);
  assert.match(fork.text, /must answer check/);
  assert.doesNotMatch(fork.text, /wins the rook|guaranteed/);
  const pinned = messageFor(setup('k3r3/8/8/8/3b1q2/8/8/2N1K3 w - - 0 1', '1. Ne2'), { review: { key: 'good' } });
  assert.doesNotMatch(pinned.text, /double|fork|at the same time/);
  assert.doesNotMatch(pinned.tip, /double attack/);
});

test('mistakes recommend only a legal best alternative and use mover-relative losses', () => {
  const white = messageFor('1. e4 e5 2. h3 *', {
    review: { key: 'mistake' }, before: { cp: 30, pv: ['g1f3'] }, after: { cp: -100 },
  });
  assert.match(white.text, /1.3 pawns for White/);
  assert.match(white.text, /Stockfish preferred Nf3/);
  assert.match(white.tip, /Replay Nf3/);
  const black = messageFor('1. e4 e5 *', {
    review: { key: 'blunder' }, before: { cp: 0, pv: ['c7c5'] }, after: { cp: 300 },
  });
  assert.match(black.text, /3.0 pawns for Black/);
  assert.match(black.text, /preferred c5/);
  assert.doesNotMatch(black.text, /hangs|fork|trap|undefended/);
});

test('missing, bound or mate scores never produce a numeric evaluation loss', () => {
  for (const [before, after] of [
    [{ cp: 30 }, {}],
    [{ cp: Infinity }, { cp: 0 }],
    [{ cp: 500, mate: 3 }, { cp: 0 }],
    [{ cp: 500, lowerbound: true }, { cp: 0 }],
    [{ cp: 500 }, { cp: 0, bound: 'upper' }],
  ]) {
    const message = messageFor('1. e4 *', { review: { key: 'mistake' }, before, after });
    assert.doesNotMatch(message.text, /pawns for|NaN|Infinity/);
    assert.match(message.text, /local review rates this/);
  }
});

test('an illegal or identical suggested engine move is not recommended', () => {
  for (const pv of [['a1a8'], ['e2e4'], ['invalid']]) {
    const message = messageFor('1. e4 *', { review: { key: 'inaccuracy' }, before: { cp: 0, pv }, after: { cp: -100 } });
    assert.doesNotMatch(message.text, /Stockfish preferred/);
    assert.doesNotMatch(message.tip, /Replay/);
  }
});

test('quiet moves do not invent tactical causes', () => {
  const message = messageFor('1. h3 *', { review: { key: 'good' }, before: { cp: 20 }, after: { cp: 15 } });
  assert.match(message.text, /(?:idea|candidate) for Black/i);
  assert.match(message.tip, /Black to move/);
  assert.doesNotMatch(message.text, /h3 (?:checks|forks|wins|attacks|sacrifices)/);
});

test('coach advice does not read the future moves in the game', () => {
  const first = parseGame('1. e4 d5 2. exd5 Qxd5 3. Nc3 *');
  const second = parseGame('1. e4 d5 2. exd5 Nf6 3. d4 *');
  const options = { ply: 3, review: { key: 'excellent' }, after: { cp: 15, pv: ['d8d5', 'b1c3', 'd5a5'] } };
  const message = getCoachMessage({ game: first, ...options });
  assert.deepEqual(message, getCoachMessage({ game: second, ...options }));
  assert.match(message.tip, /2\.\.\. Qxd5 3\. Nc3 Qa5/);
});

test('coaching explains forcing play and rook activity beyond counting a captured pawn', () => {
  const game = parseGame(DEMO_PGN);
  const message = getCoachMessage({
    game, ply: 20, review: { key: 'good' },
    positionAnalysis: { pv: ['c4b5', 'e8d8', 'e1c1', 'd8c7', 'd1d3', 'e7b4'] },
  });
  assert.match(message.text, /Bxb5\+.*with check/);
  assert.match(message.text, /O-O-O\+ activates White’s rook on d1/);
  assert.match(message.text, /Black must answer both checks/);
  assert.match(message.tip, /11\. Bxb5\+ Kd8 12\. O-O-O\+ Kc7/);
});

test('current search supplies advice while historical review scores keep the move loss stable', () => {
  const game = parseGame('1. e4 e5 2. h3 *');
  const options = {
    game, ply: 3, review: { key: 'mistake' },
    before: { cp: 30, pv: ['g1f3', 'b8c6'] }, after: { cp: -100, pv: ['b8c6'] },
    positionAnalysis: { cp: -240, pv: ['g8f6', 'b1c3'] },
  };
  const original = JSON.stringify(options);
  const message = getCoachMessage(options);
  assert.match(message.text, /Nf6/);
  assert.match(message.text, /1\.3 pawns for White/);
  assert.doesNotMatch(message.text, /2\.7 pawns/);
  assert.match(message.tip, /2\. Nf3 Nc6/);
  assert.equal(JSON.stringify(options), original);
});

test('variation coaching follows its displayed position instead of a selected main-line checkmate', () => {
  const game = parseGame(DEMO_PGN);
  const branch = parseGame('1. e4 d5 2. exd5 *');
  const message = getCoachMessage({
    game, ply: game.moves.length, variation: true, review: { key: 'blunder' },
    positionFen: branch.positions.at(-1), positionAnalysis: { pv: ['d8d5', 'b1c3'] },
  });
  assert.match(message.text, /different continuation/);
  assert.match(message.tip, /2\.\.\. Qxd5 3\. Nc3/);
  assert.doesNotMatch(message.text, /ends the game|White wins|blunder/);
});

test('a good move in a losing position explains the difference between grade and advantage', () => {
  const message = messageFor('1. e4 *', {
    review: { key: 'excellent' }, after: { cp: -766, pv: ['e7e5', 'g1f3'] },
  });
  assert.equal(message.title, 'e4 is an excellent move');
  assert.match(message.text, /Black still has a large advantage/);
  assert.match(message.text, /grade measures your choice/);
  assert.match(message.tip, /1\.\.\. e5 2\. Nf3/);
});

test('explicitly stale analysis cannot supply scores or suggestions for another board', () => {
  const game = parseGame('1. e4 *');
  const otherGame = parseGame('1. d4 *');
  const after = { fen: otherGame.positions.at(-1), cp: -766, pv: ['e7e5'] };
  const message = getCoachMessage({ game, ply: 1, review: { key: 'excellent' }, positionAnalysis: after });
  assert.doesNotMatch(message.text, /large advantage|In the engine continuation/);
  assert.doesNotMatch(message.tip, /Try this continuation/);
  const mistake = getCoachMessage({
    game, ply: 1, review: { key: 'mistake' },
    before: { fen: otherGame.positions.at(-1), cp: 30, pv: ['g1f3'] }, after,
  });
  assert.doesNotMatch(mistake.text, /pawns for|Stockfish preferred/);
  assert.doesNotMatch(mistake.tip, /Replay Nf3/);
});

test('a brilliant sacrifice explains the offered piece and a legal acceptance', () => {
  const game = parseGame(DEMO_PGN);
  const message = getCoachMessage({
    game, ply: 19, before: { cp: 200 }, after: { cp: 180 },
    review: { key: 'brilliant', sacrifice: { square: 'b5', piece: 'n', acceptance: { uci: 'c6b5', san: 'cxb5' } } },
  });
  assert.match(message.text, /Nxb5 offers the knight on b5/);
  assert.match(message.text, /Stockfish still favors White/);
  assert.match(message.text, /local review’s estimate/);
  assert.match(message.tip, /Try cxb5/);
  assert.doesNotMatch(message.text, /forced|guaranteed/);
  assert.equal(message.title, 'Nxb5 is a brilliant move');
});

test('the coach explains King’s Gambit before review using the actual played line', () => {
  const opening = { isBookMove: true, eco: 'C30', name: "King's Gambit", family: "King's Gambit", pgn: '1. e4 e5 2. f4' };
  const message = messageFor('1. e4 e5 2. f4 *', { opening });
  assert.equal(message.title, 'f4 is a book move');
  assert.match(message.text, /King's Gambit \(C30\)/);
  assert.match(message.text, /offers the f-pawn/);
  assert.match(message.text, /accept with exf4 or decline/);
  assert.match(message.text, /numerical evaluation is separate/);
  assert.match(message.tip, /1\. e4 e5 2\. f4/);
  assert.doesNotMatch(message.text, /inaccuracy|mistake|brilliant/);
});

test('accepted and named opening branches describe the current move, not a future line', () => {
  const opening = { isBookMove: true, eco: 'C33', name: "King's Gambit Accepted: Bishop's Gambit", family: "King's Gambit", variation: "Bishop's Gambit", pgn: '1. e4 e5 2. f4 exf4 3. Bc4', details: { description: 'White develops the bishop actively.', watchFor: 'Watch the exposed king before opening more lines.' } };
  const message = messageFor('1. e4 e5 2. f4 exf4 3. Bc4 *', { opening, review: { key: 'book', opening } });
  assert.equal(message.title, 'Bc4 is a book move');
  assert.equal((message.text.match(/Bishop's Gambit/g) || []).length, 1);
  assert.match(message.text, /develops White’s bishop from f1 to c4/);
  assert.match(message.tip, /3\. Bc4/);
  assert.match(message.tip, /Watch the exposed king/);
  const accepted = messageFor('1. e4 e5 2. f4 exf4 *', { opening: { ...opening, name: "King's Gambit Accepted", variation: '' } });
  assert.match(accepted.text, /Black accepts the gambit and takes White’s f-pawn/);
  const falseHistory = messageFor('1. d4 d5 2. c4 *', { opening: { ...opening, details: {} } });
  assert.doesNotMatch(falseHistory.text, /offers the f-pawn|accept with exf4/);
});

test('off-book and variation contexts retain an opening name without assigning a book grade', () => {
  const opening = { isBookMove: false, name: "King's Gambit", family: "King's Gambit" };
  const message = messageFor('1. e4 e5 2. f4 exf4 3. h3 *', { opening });
  assert.doesNotMatch(message.title, /book move/);
  assert.match(message.text, /last recognized opening/);
  assert.match(message.text, /not marked as a book move/);
  const varied = messageFor('1. e4 e5 2. f4 *', { opening, variation: true, review: { key: 'great' } });
  assert.match(varied.text, /Opening reference: King's Gambit/);
  assert.match(varied.text, /no game-review grade/);
  assert.doesNotMatch(varied.title, /great|book/);
});

test('Great commentary identifies the legal alternative and qualifies the critical comparison', () => {
  const game = parseGame('1. e4 *');
  const first = { cp: 0, depth: 16, multipv: 1, pv: ['e2e4'] };
  const second = { cp: -250, depth: 16, multipv: 2, pv: ['d2d4'] };
  const before = { ...first, lines: [first, second] }, after = { cp: -10, depth: 16 };
  const review = evaluateMove(before, after, game.moves[0], 'e2e4');
  const message = getCoachMessage({ game, ply: 1, review, before, after });
  assert.equal(message.title, 'e4 is a great move');
  assert.match(message.text, /At this search depth/);
  assert.match(message.text, /avoids a clear disadvantage/);
  assert.match(message.text, /d4 \(-2\.50 from White’s perspective\)/);
  assert.match(message.text, /2\.5 pawns worse for White/);
  assert.match(message.tip, /Replay d4/);
});

test('Great commentary rejects invalid alternative metadata and never turns mate proxies into pawn gaps', () => {
  const great = { gap: 10000, reason: 'only-winning-move', alternative: { uci: 'd2d4', mate: -2 } };
  const message = messageFor('1. e4 *', { review: { key: 'great', great }, before: { mate: 3 } });
  assert.match(message.text, /-M2/);
  assert.doesNotMatch(message.text, /pawns worse/);
  for (const token of ['a1a8', 'e2e4', 'invalid']) {
    const invalid = messageFor('1. e4 *', { review: { key: 'great', great: { ...great, alternative: { uci: token } } } });
    assert.doesNotMatch(invalid.title, /great move/);
    assert.doesNotMatch(invalid.tip, /Replay/);
  }
});

test('coach grade titles prominently include the selected SAN and opening text stays bounded', () => {
  assert.equal(messageFor('1. e4 *', { review: { key: 'best' } }).title, 'e4 is the best move');
  assert.equal(messageFor('1. e4 *', { review: { key: 'inaccuracy' } }).title, 'e4 is an inaccuracy');
  const message = messageFor('1. e4 *', { opening: { isBookMove: true, name: 'x'.repeat(10000), variation: 'y'.repeat(10000), details: { description: 'z'.repeat(10000), watchFor: 'w'.repeat(10000) } } });
  assert.equal(message.title, 'e4 is a book move');
  assert.ok(message.text.length < 900);
  assert.ok(message.tip.length < 500);
});
