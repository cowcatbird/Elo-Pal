import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { createLineSession } from '../src/line-session.js';

function played(sans, startFen) {
  const board = new Chess(startFen);
  const initialFen = board.fen();
  for (const san of sans) board.move(san);
  return { startFen: initialFen, moves: board.history({ verbose: true }) };
}

test('a line branches at its origin and keeps the original move history', () => {
  const game = played(['e4', 'e5', 'Bc4', 'Nf6']);
  const session = createLineSession({ ...game, originPly: 2, pv: ['g1f3', 'b8c6', 'f1b5'] });
  assert.equal(session.originPly, 2);
  assert.equal(session.originFen, game.moves[1].after);
  assert.equal(session.length, 3);
  assert.deepEqual(session.boardAt(0).history(), ['e4', 'e5']);
  assert.deepEqual(session.boardAt(2).history(), ['e4', 'e5', 'Nf3', 'Nc6']);
  assert.equal(session.san, '2. Nf3 Nc6 3. Bb5');
  assert.equal(session.moveAt(0), null);
  assert.equal(session.sanAt(1), 'Nf3');
  assert.equal(session.notationAt(2), '2... Nc6');
  assert.equal(session.steps[0].before, session.originFen);
  assert.equal(session.steps[2].after, session.boardAt(3).fen());
  assert.equal(session.steps[2].uci, 'f1b5');
});

test('cursor bounds and independent boards cannot modify the frozen session', () => {
  const session = createLineSession({ pv: ['e2e4', 'e7e5'] });
  assert.equal(session.boardAt(-99).history().length, 0);
  assert.equal(session.boardAt(NaN).history().length, 0);
  assert.equal(session.boardAt(1.9).history().length, 1);
  assert.equal(session.boardAt(999).history().length, 2);
  assert.equal(session.boardAt(Infinity).history().length, 2);
  const externalBoard = session.boardAt(1);
  externalBoard.move('c5');
  assert.equal(session.boardAt(1).history().length, 1);
  assert.equal(session.boardAt(2).history().at(-1), 'e5');
  assert(Object.isFrozen(session));
  assert(Object.isFrozen(session.steps));
  assert(Object.isFrozen(session.steps[0]));
  assert.throws(() => { session.steps[0].san = 'd4'; }, TypeError);
});

test('original moves and PV tokens are snapshotted without mutating either input', () => {
  const game = played(['e4', 'e5']);
  const pv = ['g1f3', 'b8c6'];
  const original = JSON.stringify({ game, pv });
  const session = createLineSession({ ...game, originPly: 2, pv });
  assert.equal(JSON.stringify({ game, pv }), original);
  game.moves[0].to = 'e3';
  game.moves.splice(1);
  pv[0] = 'f1c4';
  pv.push('d2d4');
  assert.deepEqual(session.boardAt(2).history(), ['e4', 'e5', 'Nf3', 'Nc6']);
  assert.equal(session.length, 2);
});

test('illegal or malformed PV tokens truncate only the suffix', () => {
  const legalPrefix = createLineSession({ pv: ['e2e4', 'e7e5', 'e4e6', 'g1f3'] });
  assert.equal(legalPrefix.length, 2);
  assert.equal(legalPrefix.san, '1. e4 e5');
  assert.equal(createLineSession({ pv: ['Nf3', 'e7e5'] }).length, 0);
  assert.equal(createLineSession({ pv: ['e2e4', null] }).length, 1);
  assert.equal(createLineSession({ pv: ' e2e4   e7e5 0000 g1f3 ' }).length, 2);
  assert.equal(createLineSession({ pv: [] }).moveAt(10), null);
});

test('invalid original history fails clearly instead of changing the origin', () => {
  assert.throws(() => createLineSession({ startFen: 'invalid' }), /starting position/);
  assert.throws(() => createLineSession({ moves: ['e4', 'e4'], originPly: 2 }), /original game move 2/);
  assert.throws(() => createLineSession({ moves: null }), /must be an array/);
  const game = played(['e4']);
  assert.equal(createLineSession({ ...game, originPly: 999 }).originPly, 1);
  assert.equal(createLineSession({ ...game, originPly: -2 }).originPly, 0);
});

test('black-to-move FEN keeps its fullmove numbering', () => {
  const startFen = '4k2r/8/8/8/8/8/8/4K2R b Kk - 0 37';
  const session = createLineSession({ startFen, pv: ['h8h7', 'h1h2', 'h7h6'] });
  assert.equal(session.san, '37... Rh7 38. Rh2 Rh6');
  assert.equal(session.notationAt(1), '37... Rh7');
  assert.equal(session.notationAt(2), '38. Rh2');
  assert.equal(session.boardAt(1).turn(), 'w');
});

test('castling moves both king and rook and capture preserves SAN metadata', () => {
  const startFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const session = createLineSession({ startFen, pv: ['e1g1', 'a8a1'] });
  assert.equal(session.steps[0].san, 'O-O');
  assert.equal(session.boardAt(1).get('f1').type, 'r');
  assert.equal(session.boardAt(1).get('g1').type, 'k');
  assert.equal(session.steps[1].san, 'Rxa1');
  assert.equal(session.steps[1].captured, 'r');
});

test('promotions and en passant are replayed from their legal history', () => {
  const promotion = createLineSession({ startFen: '7k/P7/8/8/8/8/8/7K w - - 0 20', pv: ['a7a8n'] });
  assert.equal(promotion.steps[0].san, 'a8=N');
  assert.equal(promotion.steps[0].promotion, 'n');
  assert.equal(promotion.boardAt(1).get('a8').type, 'n');
  const game = played(['e4', 'a6', 'e5', 'd5']);
  const enPassant = createLineSession({ ...game, originPly: 4, pv: ['e5d6'] });
  assert.equal(enPassant.steps[0].san, 'exd6');
  assert(enPassant.steps[0].flags.includes('e'));
  assert.equal(enPassant.boardAt(1).get('d5'), undefined);
  assert.equal(enPassant.boardAt(1).get('d6').color, 'w');
});

test('terminal positions end the line even if the supplied PV continues', () => {
  const game = played(['f3', 'e5', 'g4']);
  const mate = createLineSession({ ...game, originPly: 3, pv: ['d8h4', 'e2e3'] });
  assert.equal(mate.length, 1);
  assert.equal(mate.steps[0].san, 'Qh4#');
  assert.equal(mate.boardAt(1).isCheckmate(), true);
  const terminalGame = played(['f3', 'e5', 'g4', 'Qh4#']);
  assert.equal(createLineSession({ ...terminalGame, originPly: 4, pv: ['e2e3'] }).length, 0);
  assert.equal(createLineSession({ startFen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', pv: ['h8h7'] }).length, 0);
});

test('repetition across the original game and PV is retained at every cursor', () => {
  const game = played(['Nf3', 'Nf6', 'Ng1', 'Ng8']);
  const session = createLineSession({ ...game, originPly: 4, pv: ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'e2e4'] });
  assert.equal(session.length, 4);
  assert.equal(session.boardAt(3).isThreefoldRepetition(), false);
  assert.equal(session.boardAt(4).isThreefoldRepetition(), true);
  assert.equal(session.boardAt(4).history().length, 8);
  // Loading that FEN alone would lose repetition; the session must replay it.
  assert.equal(new Chess(session.boardAt(4).fen()).isThreefoldRepetition(), false);
});
