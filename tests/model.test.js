import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import {
  DEMO_PGN, parseGame, evaluateMove, classifySacrifice, classifyGreat, normalizeOpening, summarizeReview, pvToSan, scoreText,
} from '../src/model.js';

test('the demo is a legal complete game ending in checkmate', () => {
  const game = parseGame(DEMO_PGN);
  assert.equal(game.moves.length, 33);
  assert.equal(game.positions.length, 34);
  assert.equal(game.headers.White, 'Paul Morphy');
  assert.equal(game.moves.at(-1).san, 'Rd8#');
  assert.equal(new Chess(game.positions.at(-1)).isCheckmate(), true);
  assert.equal(game.startFen, new Chess().fen());
  for (let i = 0; i < game.moves.length; i++) {
    assert.equal(game.moves[i].before, game.positions[i]);
    assert.equal(game.moves[i].after, game.positions[i + 1]);
  }
});

test('FEN imports retain side to move and custom starting positions', () => {
  const fen = '8/8/8/8/8/4k3/8/4K2R b - - 0 1';
  const game = parseGame(fen);
  assert.deepEqual(game.positions, [fen]);
  assert.deepEqual(game.moves, []);
  assert.equal(game.startFen, fen);
});

test('invalid, empty, and illegal input produces readable errors', () => {
  assert.throws(() => parseGame(''), /Paste a PGN/);
  assert.throws(() => parseGame('[Event "Empty"]\n*'), /contains no moves/);
  assert.throws(() => parseGame('1. e4 e5 2. Qh8'), /Could not read this PGN/);
  assert.throws(() => parseGame('8/8/8/8/8/8/8/8 w - - 0 1'), /FEN position/);
  assert.throws(() => parseGame('8/8/8/8/8/4k3/8/4K2R x - - 0 1'), /FEN position/);
});

test('FEN validation rejects adjacent kings and a checked non-moving king', () => {
  assert.throws(() => parseGame('8/8/8/8/8/8/4k3/4K3 w - - 0 1'), /starting position is illegal/);
  assert.throws(() => parseGame('4k3/8/8/8/8/8/8/K3R3 w - - 0 1'), /starting position is illegal/);
  assert.doesNotThrow(() => parseGame('4k3/8/8/8/8/8/8/K3R3 b - - 0 1'));
});

test('PGN comments and variations are excluded from the played main line', () => {
  const game = parseGame('1. e4 {hello} e5 (1... c5) 2. Nf3 Nc6 *');
  assert.deepEqual(game.moves.map((move) => move.san), ['e4', 'e5', 'Nf3', 'Nc6']);
});

test('multiple complete games cannot silently replace or merge into one game', () => {
  const first = '[Event "First"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
  const second = '[Event "Second"]\n[Result "0-1"]\n\n1. d4 d5 0-1';
  assert.throws(() => parseGame(`${first}\n\n${second}`));
  assert.throws(() => parseGame('1. e4 e5 1-0\n\n1. d4 d5 0-1'));
});

test('PGN setup preserves promotion and the starting FEN', () => {
  const fen = '7k/P7/8/8/8/8/8/K7 w - - 0 1';
  const game = parseGame(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. a8=Q+ *`);
  assert.equal(game.startFen, fen);
  assert.equal(game.moves[0].promotion, 'q');
  assert.equal(game.moves[0].san, 'a8=Q+');
  assert.equal(pvToSan(fen, 'a7a8q h8h7'), 'a8=Q+ Kh7');
});

test('special moves include castling and en passant', () => {
  const castling = parseGame('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O *');
  assert.equal(castling.moves.at(-1).san, 'O-O');
  assert.equal(castling.moves.at(-1).from, 'e1');
  assert.equal(castling.moves.at(-1).to, 'g1');
  const enPassant = parseGame('1. e4 a6 2. e5 d5 3. exd6 *');
  assert.equal(enPassant.moves.at(-1).isEnPassant(), true);
  assert.equal(new Chess(enPassant.positions.at(-1)).get('d5'), undefined);
});

test('evaluation loss reverses correctly for Black', () => {
  const moves = parseGame('1. e4 e5 *').moves;
  const white = evaluateMove({ cp: 0 }, { cp: -300 }, moves[0], 'd2d4');
  const black = evaluateMove({ cp: 0 }, { cp: 300 }, moves[1], 'c7c5');
  assert.equal(white.key, 'blunder');
  assert.equal(black.key, 'blunder');
  assert.equal(white.loss, 300);
  assert.equal(black.loss, 300);
  assert.equal(white.accuracy, black.accuracy);
  assert.ok(white.accuracy < 30);
});

test('best moves and engine improvements are never penalized', () => {
  const move = parseGame('1. e4 *').moves[0];
  assert.equal(evaluateMove({ cp: 50 }, { cp: 0 }, move, 'e2e4').accuracy, 100);
  const improved = evaluateMove({ cp: 0 }, { cp: 100 }, move, 'd2d4');
  assert.equal(improved.loss, 0);
  assert.equal(improved.key, 'excellent');
  assert.equal(improved.accuracy, 100);
});

test('custom categories follow their documented win-chance thresholds', () => {
  const move = parseGame('1. e4 *').moves[0];
  for (const [cp, key] of [
    [-10, 'excellent'], [-40, 'good'], [-70, 'inaccuracy'], [-150, 'mistake'], [-300, 'blunder'],
  ]) {
    const result = evaluateMove({ cp: 0 }, { cp }, move, 'd2d4');
    assert.equal(result.key, key);
    assert.ok(result.accuracy >= 0 && result.accuracy <= 100);
  }
});

test('mate scores remain finite and lost forced wins are serious errors', () => {
  const move = parseGame('1. e4 *').moves[0];
  const result = evaluateMove({ mate: 3 }, { cp: 0 }, move, 'd2d4');
  assert.equal(result.key, 'blunder');
  assert.ok(Number.isFinite(result.loss));
  assert.ok(Number.isFinite(result.accuracy));
  const keptMate = evaluateMove({ mate: 4 }, { mate: 3 }, move, 'd2d4');
  assert.equal(keptMate.loss, 0);
});

test('mate in zero is resolved using the actual terminal board', () => {
  const game = parseGame('1. f3 e5 2. g4 Qh4# 0-1');
  const result = evaluateMove({ mate: -1 }, { mate: 0 }, game.moves.at(-1), null);
  assert.equal(result.key, 'best');
  assert.equal(result.loss, 0);
  assert.equal(result.accuracy, 100);
});

test('stalemate scores as a draw even if a stale engine score says winning', () => {
  const board = new Chess('7k/5K2/6Q1/8/8/8/8/8 w - - 0 1');
  const move = board.move('Qf5');
  assert.equal(board.isStalemate(), true);
  const result = evaluateMove({ cp: 900 }, { cp: 900 }, move, 'g6g7');
  assert.equal(result.key, 'blunder');
  assert.equal(result.loss, 900);
});

test('only legal moves are marked forced', () => {
  const board = new Chess('7k/8/5K2/8/8/8/8/7R b - - 0 1');
  // Black is in check down the h-file and can only move the king to g8.
  const legal = board.moves({ verbose: true });
  assert.equal(legal.length, 1);
  const result = evaluateMove({ cp: 0 }, { cp: -80 }, legal[0], null);
  assert.equal(result.key, 'forced');
  assert.equal(result.accuracy, 100);
});

test('summary groups by actual color, including a Black-to-move setup', () => {
  const game = parseGame('[SetUp "1"]\n[FEN "8/8/8/8/8/4k3/8/4K2R b - - 0 1"]\n\n1... Kd3 2. Rh3+ *');
  const result = summarizeReview(game, [{ key: 'good', accuracy: 80 }, null]);
  assert.equal(result.black.reviewed, 1);
  assert.equal(result.black.accuracy, 80);
  assert.equal(result.black.categories.good, 1);
  assert.equal(result.white.accuracy, null);
  assert.equal(result.white.total, 1);
  assert.equal(result.total, 2);
  assert.equal(result.reviewed, 1);
});

test('SAN variations stop at invalid moves, with configurable length', () => {
  const fen = new Chess().fen();
  assert.equal(pvToSan(fen, ['e2e4', 'e7e5', 'g1f3']), 'e4 e5 Nf3');
  assert.equal(pvToSan(fen, 'e2e4 e7e5 g1f3', 2), 'e4 e5');
  assert.equal(pvToSan(fen, 'e2e4 a1a8 g1f3'), 'e4');
  assert.equal(pvToSan('invalid', 'e2e4'), '');
});

test('score labels preserve White perspective and handle missing scores', () => {
  assert.equal(scoreText({ cp: 34 }), '+0.34');
  assert.equal(scoreText({ cp: -120 }), '-1.20');
  assert.equal(scoreText({ cp: 0 }), '+0.00');
  assert.equal(scoreText({ mate: 3 }), 'M3');
  assert.equal(scoreText({ mate: -2 }), '-M2');
  assert.equal(scoreText({ mate: -0 }), '-M0');
  assert.equal(scoreText(null), '—');
});

const deep = (cp = 150, extra = {}) => ({ cp, depth: 16, ...extra });
const uci = (move) => `${move.from}${move.to}${move.promotion ?? ''}`;
const operaMove = (san) => parseGame(DEMO_PGN).moves.find((move) => move.color === 'w' && move.san === san);

test('deep, sound Opera Game sacrifices receive Brilliant with inspectable evidence', () => {
  for (const [san, pv, cost, basis] of [
    ['Nxb5', ['c6b5', 'c4b5'], 1, 'legal-exchange'],
    ['Rxd7', ['d8d7', 'h1d1'], 2, 'engine-continuation'],
    ['Qb8+', ['d7b8', 'd1d8'], 9, 'legal-exchange'],
  ]) {
    const move = operaMove(san);
    const before = san === 'Qb8+' ? { mate: 2, depth: 16 } : deep();
    const after = san === 'Qb8+' ? { mate: 1, depth: 16, pv } : deep(150, { pv });
    const result = evaluateMove(before, after, move, uci(move));
    assert.equal(result.key, 'brilliant', san);
    assert.equal(result.symbol, '!!');
    assert.equal(result.accuracy, 100);
    assert.equal(result.sacrifice.materialCost, cost);
    assert.equal(result.sacrifice.basis, basis);
    assert.equal(result.sacrifice.square, move.to);
    assert.equal(result.sacrifice.piece, move.piece);
    const board = new Chess(move.after);
    for (const san of result.sacrifice.line) assert.doesNotThrow(() => board.move(san));
    const summary = summarizeReview({ moves: [move] }, [result]);
    assert.equal(summary.white.categories.brilliant, 1);
  }
});

test('temporary exchange sacrifices require a legal engine continuation that keeps the investment', () => {
  const move = operaMove('Rxd7');
  // Rxd7 Rxd7 Bxd7+ Kxd7 restores material. Without a stronger continuation,
  // the apparent exchange sacrifice is just an ordinary liquidation.
  assert.equal(classifySacrifice(deep(), deep(), move, uci(move)), null);
  assert.equal(classifySacrifice(deep(), deep(150, { pv: ['d8d7', 'b5d7'] }), move, uci(move)), null);
  assert.equal(classifySacrifice(deep(), deep(150, { pv: ['d8d7', 'h1h8'] }), move, uci(move)), null);
  assert.equal(classifySacrifice(deep(), deep(150, { pv: ['d8d7', 'h1d1'] }), move, uci(move)).materialCost, 2);
});

test('a near-best sound sacrifice keeps its measured accuracy instead of automatically scoring 100', () => {
  const move = operaMove('Nxb5');
  const result = evaluateMove(deep(150), deep(140), move, 'g5f6');
  assert.equal(result.key, 'brilliant');
  assert.ok(result.accuracy > 90 && result.accuracy < 100);
  assert.equal(result.loss, 10);
});

test('Brilliant requires deep, known, non-losing and preserved engine evaluations', () => {
  const move = operaMove('Nxb5');
  for (const [before, after] of [
    [{ cp: 150 }, deep()],
    [deep(150, { depth: 11 }), deep()],
    [deep(), deep(150, { depth: 11 })],
    [deep(150, { depth: Infinity }), deep()],
    [deep(150, { lowerbound: true }), deep()],
    [deep(), deep(150, { upperbound: true })],
    [deep(150, { bound: 'lower' }), deep()],
    [deep(), deep(150, { bound: 'upperbound' })],
    [deep(150, { terminal: 'threefold repetition' }), deep()],
    [deep(), deep(150, { terminal: 'draw' })],
    [{ depth: 16 }, deep()],
    [deep(), { depth: 16 }],
    [deep(-300), deep(-280)],
    [deep(150), deep(-400)],
    [{ mate: 2, depth: 16 }, deep(2000)],
  ]) assert.equal(classifySacrifice(before, after, move, uci(move)), null);
  assert.equal(classifySacrifice(deep(), deep(), move, 'a9b9'), null);
  assert.equal(evaluateMove(deep(150, { depth: 11 }), deep(), move, uci(move)).key, 'best');
});

test('equal trades and ordinary defended recaptures are not sacrifices', () => {
  for (const pgn of [
    '1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. Bxc6 *',
    '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 *',
  ]) {
    const move = parseGame(pgn).moves.at(-1);
    const result = evaluateMove(deep(), deep(), move, uci(move));
    assert.equal(result.key, 'best');
    assert.equal(result.sacrifice, undefined);
  }
  const board = new Chess('3qk3/4b3/8/8/8/8/8/3QK3 w - - 0 1');
  const trade = board.move('Qxd8+');
  assert.equal(classifySacrifice(deep(), deep(150, { pv: ['e8d8', 'e1f1'] }), trade, uci(trade)), null);
});

test('a pinned pawn cannot legally accept an apparent rook sacrifice', () => {
  const board = new Chess('2k5/8/2p5/8/8/8/8/KRR5 w - - 0 1');
  const move = board.move('Rb5');
  assert.equal(board.isAttacked('b5', 'b'), true);
  assert.equal(board.moves().includes('cxb5'), false);
  assert.equal(classifySacrifice(deep(), deep(), move, uci(move)), null);
});

test('moving an already hanging piece does not manufacture a new sacrifice', () => {
  const board = new Chess('7k/8/2p5/8/2Bp4/2N5/8/7K w - - 0 1');
  const move = board.move('Nb5');
  assert.ok(board.moves().includes('cxb5'));
  assert.equal(classifySacrifice(deep(), deep(), move, uci(move)), null);
});

test('forced interpositions and delivered checkmate do not receive Brilliant', () => {
  const board = new Chess('7r/8/8/8/8/4b1k1/R7/7K w - - 0 1');
  assert.deepEqual(board.moves(), ['Rh2']);
  const move = board.move('Rh2');
  assert.equal(evaluateMove(deep(0), deep(0), move, uci(move)).key, 'forced');
  const mate = parseGame(DEMO_PGN).moves.at(-1);
  assert.equal(evaluateMove({ mate: 1, depth: 16 }, { mate: 0, depth: 16 }, mate, uci(mate)).key, 'best');
});

test('promotion alone is excluded, and accepting promotions count the material correctly', () => {
  const promotionBoard = new Chess('1r5k/P7/8/8/8/8/8/K7 w - - 0 1');
  const promotion = promotionBoard.move('a8=Q');
  assert.ok(promotionBoard.moves().includes('Rxa8+'));
  assert.equal(classifySacrifice(deep(), deep(), promotion, uci(promotion)), null);

  const board = new Chess('7k/8/8/8/8/R7/1pN5/7K w - - 0 1');
  const move = board.move('Ra1');
  const offer = classifySacrifice(deep(), deep(), move, uci(move));
  assert.ok(offer);
  // ...bxa1=Q Nxa1 exchanges the rook for a pawn, a four-pawn investment.
  assert.equal(offer.materialCost, 4);
  assert.equal(offer.value, 5);
  assert.equal(offer.piece, 'r');
});

test('Brilliant uses the same criteria for Black sacrifices', () => {
  const whiteMove = operaMove('Nxb5');
  const mirrorSquare = (square) => square[0] + (9 - Number(square[1]));
  const fields = whiteMove.before.split(' ');
  fields[0] = fields[0].split('/').reverse().join('/').replace(/[a-zA-Z]/g,
    (piece) => piece === piece.toLowerCase() ? piece.toUpperCase() : piece.toLowerCase());
  fields[1] = 'b';
  fields[2] = fields[2] === '-' ? '-' : fields[2].replace(/[KQkq]/g,
    (piece) => piece === piece.toLowerCase() ? piece.toUpperCase() : piece.toLowerCase());
  fields[3] = '-';
  const board = new Chess(fields.join(' '));
  const move = board.move({ from: mirrorSquare(whiteMove.from), to: mirrorSquare(whiteMove.to) });
  const result = evaluateMove(deep(-150), deep(-150), move, uci(move));
  assert.equal(result.key, 'brilliant');
  assert.equal(result.sacrifice.materialCost, 1);
  assert.equal(result.sacrifice.square, 'b4');
  assert.equal(result.accuracy, 100);
});

function rankedBefore(move, alternative, firstCp, secondCp) {
  const first = { multipv: 1, depth: 16, cp: firstCp, pv: [uci(move)] };
  const second = { multipv: 2, depth: 16, cp: secondCp, pv: [alternative] };
  return { ...first, lines: [first, second] };
}

test('Great marks a critical best move with a genuinely worse legal second candidate', () => {
  const move = parseGame('1. e4 *').moves[0];
  const before = rankedBefore(move, 'd2d4', 0, -250);
  const result = evaluateMove(before, deep(-10), move, uci(move));
  assert.equal(result.key, 'great');
  assert.equal(result.symbol, '!');
  assert.equal(result.great.reason, 'only-nonlosing-move');
  assert.equal(result.great.alternative.san, 'd4');
  assert.equal(result.great.gap, 250);
  assert.equal(result.accuracy, 100);
  assert.equal(summarizeReview({ moves: [move] }, [result]).white.categories.great, 1);
  const winning = evaluateMove(rankedBefore(move, 'd2d4', 300, 30), deep(280), move, uci(move));
  assert.equal(winning.great.reason, 'only-winning-move');
});

test('Great is symmetric for Black and accepts candidate depths differing by one', () => {
  const move = parseGame('1. e4 e5 *').moves[1];
  const before = rankedBefore(move, 'c7c5', 0, 250);
  before.lines[1].depth = 15;
  const result = evaluateMove(before, deep(10), move, uci(move));
  assert.equal(result.key, 'great');
  assert.equal(result.great.alternative.san, 'c5');
  assert.equal(result.great.gap, 250);
  assert.equal(result.great.engineDepth, 15);
});

test('a gap alone does not make every best move Great', () => {
  const move = parseGame('1. e4 *').moves[0];
  for (const [first, second, after] of [[0, -199, 0], [700, 300, 700], [-200, -700, -200], [100, -100, 100], [0, -250, -200], [300, 30, 100], [210, -200, 180]]) {
    assert.equal(classifyGreat(rankedBefore(move, 'd2d4', first, second), deep(after), move, uci(move)), null);
  }
  assert.equal(classifyGreat(rankedBefore(move, 'd2d4', 0, -250), deep(0), move, 'd2d4'), null);
});

test('Great requires exact, deep, consistent and distinct legal MultiPV evidence', () => {
  const move = parseGame('1. e4 *').moves[0];
  const mutate = [
    (score) => { score.lines.pop(); },
    (score) => { score.lines[1].pv = ['a1a8']; },
    (score) => { score.lines[1].pv = ['e2e4']; },
    (score) => { score.lines[1].depth = 13; },
    (score) => { score.lines[1].cp = NaN; },
    (score) => { score.lines[0].lowerbound = true; },
    (score) => { score.lines[1].upperbound = true; },
    (score) => { score.bound = 'lower'; },
    (score) => { score.cp = 1; },
    (score) => { score.depth = 15; },
    (score) => { score.lines[1].multipv = 3; },
  ];
  for (const change of mutate) {
    const before = rankedBefore(move, 'd2d4', 0, -250);
    change(before);
    assert.equal(classifyGreat(before, deep(0), move, uci(move)), null);
  }
  for (const after of [deep(0, { depth: 11 }), deep(0, { upperbound: true }), deep(0, { terminal: 'draw' })]) {
    assert.equal(classifyGreat(rankedBefore(move, 'd2d4', 0, -250), after, move, uci(move)), null);
  }
});

test('Great excludes forced and terminal moves and retains previously forced mate', () => {
  const board = new Chess('7r/8/8/8/8/4b1k1/R7/7K w - - 0 1');
  const forced = board.move('Rh2');
  assert.equal(classifyGreat(rankedBefore(forced, 'h1g1', 0, -250), deep(0), forced, uci(forced)), null);
  const mate = parseGame(DEMO_PGN).moves.at(-1);
  assert.equal(classifyGreat(rankedBefore(mate, 'd1d2', 9000, 0), { mate: 0, depth: 16 }, mate, uci(mate)), null);
  const move = parseGame('1. e4 *').moves[0];
  const before = rankedBefore(move, 'd2d4', null, 0);
  before.mate = before.lines[0].mate = 3;
  assert.equal(classifyGreat(before, deep(2000), move, uci(move)), null);
  assert.equal(classifyGreat(before, { mate: 2, depth: 16 }, move, uci(move)).reason, 'only-winning-move');
});

test('Brilliant takes priority over Great when both have evidence', () => {
  const move = operaMove('Nxb5');
  const before = rankedBefore(move, 'g5f6', 150, -300);
  assert.ok(classifyGreat(before, deep(150), move, uci(move)));
  assert.equal(evaluateMove(before, deep(150), move, uci(move)).key, 'brilliant');
});

test('a matched King’s Gambit move is Book while numeric engine estimates remain separate', () => {
  const move = parseGame('1. e4 e5 2. f4 *').moves.at(-1);
  const opening = { isBookMove: true, eco: 'C30', name: "King's Gambit", family: "King's Gambit", pgn: '1. e4 e5 2. f4' };
  const before = deep(50), after = deep(-90);
  const result = evaluateMove(before, after, move, 'g1f3', { opening });
  assert.equal(result.key, 'book');
  assert.equal(result.accuracy, 100);
  assert.equal(result.loss, 140);
  assert.ok(result.engineAccuracy < 100);
  assert.equal(result.opening.eco, 'C30');
  assert.equal(after.cp, -90);
  assert.equal(summarizeReview({ moves: [move] }, [result]).white.categories.book, 1);
  assert.notEqual(evaluateMove(before, after, move, 'g1f3', { opening: { ...opening, isBookMove: false } }).key, 'book');
  assert.notEqual(evaluateMove(before, after, move, 'g1f3', { opening: { ...opening, isBookMove: 'true' } }).key, 'book');
  assert.equal(evaluateMove(rankedBefore(move, 'g1f3', 0, -300), deep(0), move, uci(move), { opening }).key, 'book');
});

test('opening metadata is bounded plain text with a valid ECO identifier', () => {
  const book = normalizeOpening({ isBookMove: true, name: 'X'.repeat(10000), eco: 'BAD', pgn: 'e4 '.repeat(1000), variation: 'Y'.repeat(1000), details: { description: '\n'.repeat(200) + 'd'.repeat(1000), watchFor: ['not a string'] } });
  assert.equal(book.name.length, 120);
  assert.equal(book.variation.length, 120);
  assert.ok(book.pgn.length <= 1200);
  assert.equal(book.eco, '');
  assert.equal(book.details.description.length, 300);
  assert.equal(book.details.watchFor, '');
  assert.equal(normalizeOpening(null), null);
});
