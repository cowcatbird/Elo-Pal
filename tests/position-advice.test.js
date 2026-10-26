import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { getPositionAdvice } from '../src/position-advice.js';

function played(moves, fen) {
  const board = fen ? new Chess(fen) : new Chess();
  let move = null;
  for (const san of moves) move = board.move(san);
  return { fen: board.fen(), move };
}

const prose = advice => `${advice.reason} ${advice.plan} ${advice.line}`;
const boundedAdvice = advice => {
  for (const key of ['reason', 'plan', 'line']) {
    assert.equal(typeof advice[key], 'string', `${key} must always be a string`);
    assert.ok(advice[key].length < 1500, `${key} must stay readable`);
    assert.doesNotMatch(advice[key], /undefined|NaN|Infinity/);
  }
};

test('an engine-backed plan names the legal reply and continuation from this position', () => {
  const state = played(['e4', 'e5', 'Nf3']);
  const advice = getPositionAdvice({ ...state, analysis: { cp: 24, pv: ['b8c6', 'f1b5', 'a7a6'] } });
  boundedAdvice(advice);
  assert.match(advice.plan, /Black/);
  assert.match(advice.plan, /Nc6/);
  assert.match(advice.line, /2\s*\.{3}\s*Nc6/);
  assert.match(advice.line, /3\.\s*Bb5\s+a6/);
  assert.doesNotMatch(prose(advice), /Look at your opponent’s strongest reply before planning your next move/);
});

test('white-to-move and black-to-move lines retain the actual move numbers', () => {
  const white = getPositionAdvice({
    ...played(['e4', 'e5']), analysis: { pv: ['g1f3', 'b8c6', 'f1b5'] },
  });
  assert.match(white.plan, /White/);
  assert.match(white.line, /2\.\s*Nf3\s+Nc6\s+3\.\s*Bb5/);

  const black = getPositionAdvice({
    fen: 'r3k2r/ppp2ppp/2n5/3p4/3P4/2N5/PPP2PPP/R3K2R b KQkq - 0 18',
    analysis: { cp: -130, pv: ['e8g8', 'e1g1', 'f8e8'] },
  });
  assert.match(black.plan, /Black/);
  assert.match(black.line, /18\s*\.{3}\s*O-O/);
  assert.match(black.line, /19\.\s*O-O\s+Rfe8/);
  assert.doesNotMatch(prose(black), /White (?:wins|gains|is better|has the advantage)/);
});

test('an illegal first PV move never becomes a suggested engine reply', () => {
  const state = played(['e4', 'e5', 'Nf3']);
  for (const pv of [['e2e4', 'b8c6'], ['a1a8'], ['not-a-move'], [null], [{ from: 'b8', to: 'c6' }]]) {
    const advice = getPositionAdvice({ ...state, analysis: { cp: 999, pv } });
    boundedAdvice(advice);
    assert.equal(advice.line, '');
    assert.doesNotMatch(prose(advice), /Stockfish (?:suggests|prefers|recommends|expects|chooses)/);
  }
});

test('the displayed line stops before an illegal suffix instead of skipping it', () => {
  const state = played(['e4', 'e5', 'Nf3']);
  const valid = getPositionAdvice({ ...state, analysis: { pv: ['b8c6'] } });
  const broken = getPositionAdvice({ ...state, analysis: { pv: ['b8c6', 'a1a8', 'f1b5'] } });
  assert.equal(broken.line, valid.line);
  assert.match(broken.line, /Nc6/);
  assert.doesNotMatch(prose(broken), /Ra8|Bb5/);
});

test('analysis tagged for another position is rejected even when its first move is legal here', () => {
  const state = played(['e4', 'e5', 'Nf3']);
  const stale = getPositionAdvice({
    ...state,
    analysis: { fen: played(['d4', 'd5', 'Nf3']).fen, cp: 240, pv: ['b8c6', 'f1b5'] },
  });
  boundedAdvice(stale);
  assert.equal(stale.line, '');
  assert.doesNotMatch(prose(stale), /Stockfish (?:suggests|prefers|recommends|expects|chooses)/);
  const current = getPositionAdvice({ ...state, analysis: { fen: state.fen, pv: ['b8c6'] } });
  assert.match(current.line, /Nc6/);
});

test('a last-move record from another board cannot supply made-up tactical facts', () => {
  const current = played(['d4', 'd5', 'c4']);
  const unrelated = played(['e4', 'd5', 'exd5']);
  const baseline = getPositionAdvice({ fen: current.fen });
  const mismatched = getPositionAdvice({ fen: current.fen, move: unrelated.move });
  assert.deepEqual(mismatched, baseline);
  const forged = getPositionAdvice({ fen: current.fen, move: { ...current.move, san: 'FAKE'.repeat(10000), to: 'z9' } });
  boundedAdvice(forged);
  assert.doesNotMatch(prose(forged), /FAKE|z9/);
});

test('a capture followed by a recapture is not presented as a guaranteed material win', () => {
  const state = played(['e4', 'd5', 'exd5']);
  const advice = getPositionAdvice({ ...state, analysis: { cp: 15, pv: ['d8d5', 'b1c3', 'd5a5'] } });
  boundedAdvice(advice);
  assert.match(advice.line, /Qxd5/);
  assert.match(advice.line, /Nc3/);
  assert.doesNotMatch(prose(advice), /(?:guarantees?|definitely|certainly|forcibly) (?:wins?|gains?)/i);
  assert.doesNotMatch(prose(advice), /exd5 (?:wins?|gains?) (?:a pawn|material|one pawn)/i);
  assert.doesNotMatch(prose(advice), /Qxd5 (?:wins?|gains?) (?:a pawn|material|one pawn)/i);
});

test('material advice distinguishes an equal exchange from a line changing the material balance', () => {
  const exchanged = getPositionAdvice({
    ...played(['e4', 'd5']),
    analysis: { cp: 20, pv: ['e4d5', 'd8d5'] },
  });
  assert.match(exchanged.reason, /material balance unchanged|equal exchange|material.*equal/i);
  assert.match(exchanged.reason, /exd5/);
  assert.match(exchanged.reason, /Qxd5/);
  const recaptured = getPositionAdvice({
    ...played(['e4', 'd5', 'exd5']),
    analysis: { cp: 20, pv: ['d8d5'] },
  });
  assert.match(recaptured.reason, /1 pawn/);
  assert.match(recaptured.reason, /toward Black/);
  assert.match(recaptured.reason, /line|continuation/);
  assert.doesNotMatch(recaptured.reason, /toward White/);
});

test('without analysis the coach still identifies a concrete legal tactical candidate', () => {
  const advice = getPositionAdvice({ fen: '7k/8/8/4q3/8/5N2/8/7K w - - 0 1' });
  assert.match(advice.reason, /queen.*e5/);
  assert.match(advice.plan, /Nxe5/);
  assert.match(advice.plan, /candidate/);
  assert.doesNotMatch(prose(advice), /Stockfish’s continuation|Stockfish prefers|guaranteed win/);
});

test('a pinned knight cannot be recommended to capture its geometric targets', () => {
  const fen = 'k3r3/8/8/8/3b1q2/8/4N3/4K3 w - - 1 2';
  const board = new Chess(fen);
  assert.ok(!board.moves({ square: 'e2' }).length, 'fixture knight is absolutely pinned');
  const advice = getPositionAdvice({ fen, analysis: { pv: ['e2f4'] } });
  boundedAdvice(advice);
  assert.equal(advice.line, '');
  assert.doesNotMatch(prose(advice), /Nxf4|Nxd4|forks?|double attack|attacks .* at the same time/i);
});

test('a genuine king-ray pin names the pinned piece and both relevant squares', () => {
  const state = played(['Bb5'], '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1');
  const advice = getPositionAdvice(state);
  assert.match(advice.reason, /pins.*knight.*c6.*king.*e8/);
  assert.doesNotMatch(advice.reason, /wins the knight|guaranteed/);
});

test('a checking knight fork identifies both targets while requiring a reply to check', () => {
  const state = played(['Nc7+'], 'r3k3/8/8/1N6/8/8/8/7K w - - 0 1');
  const advice = getPositionAdvice(state);
  assert.match(advice.reason, /king on e8/);
  assert.match(advice.reason, /rook on a8/);
  assert.match(advice.reason, /Black.*answer check/);
  assert.doesNotMatch(advice.reason, /wins the rook|guaranteed/);
});

test('castling without a pawn shield is not automatically described as making the king safe', () => {
  const state = played(['O-O'], '4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  const advice = getPositionAdvice(state);
  boundedAdvice(advice);
  assert.doesNotMatch(prose(advice), /(?:king is|king becomes|king remains|king to|king into|king now|makes? .*king) (?:safe|safer|safety)/i);
  assert.doesNotMatch(prose(advice), /(?:protected|secure|safe) behind (?:its|the|your|a) pawns/i);
});

test('a pawn with an opposing pawn ahead on an adjacent file is not called passed', () => {
  const blocked = getPositionAdvice({ fen: '7k/1p6/8/P7/8/8/8/7K w - - 0 1' });
  boundedAdvice(blocked);
  assert.doesNotMatch(prose(blocked), /(?:has|is|your|the|advance|push|support|create|created) (?:a |the |your |White’s )?passed pawn/i);
  assert.doesNotMatch(prose(blocked), /a5 (?:is|becomes) (?:a )?passed/i);
});

test('a passed pawn blocked by a piece is described with its actual obstacle', () => {
  const state = played(['e5'], '7k/8/4b3/8/4P3/8/8/7K w - - 0 1');
  const advice = getPositionAdvice(state);
  assert.match(advice.reason, /pawn on e5 is passed/);
  assert.match(advice.reason, /bishop on e6 blocks/);
  assert.doesNotMatch(advice.reason, /unstoppable|will promote|promotes next/);
});

test('legal promotion and en passant remain valid engine continuations', () => {
  const promotion = getPositionAdvice({
    fen: '7k/P7/8/8/8/8/8/7K w - - 0 12',
    analysis: { pv: ['a7a8q', 'h8h7'] },
  });
  assert.match(promotion.line, /12\.\s*a8=Q\+/);
  assert.match(promotion.line, /Kh7/);
  const ep = getPositionAdvice({
    ...played(['e4', 'a6', 'e5', 'd5']),
    analysis: { pv: ['e5d6', 'c7d6'] },
  });
  assert.match(ep.line, /3\.\s*exd6\s+cxd6/);
});

test('terminal positions and absent move history are safe to inspect', () => {
  for (const fen of [
    '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1',
    '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
    '7k/8/8/8/8/8/8/K7 w - - 0 1',
  ]) {
    const advice = getPositionAdvice({ fen, analysis: { pv: ['h8h7'] } });
    boundedAdvice(advice);
    assert.equal(advice.line, '');
  }
  boundedAdvice(getPositionAdvice({ fen: new Chess().fen() }));
  boundedAdvice(getPositionAdvice());
});

test('malformed and oversized inputs neither escape into advice nor create an unbounded line', () => {
  for (const fen of [null, 42, {}, '', 'not-a-fen', 'x'.repeat(100000)]) {
    const advice = getPositionAdvice({ fen, move: { san: 'injected'.repeat(10000) }, analysis: { pv: ['a1a8'] } });
    boundedAdvice(advice);
    assert.equal(prose(advice).trim(), '');
  }
  const fen = new Chess().fen();
  for (const pv of [null, 42, {}, 'x'.repeat(100000), Array(50000).fill('a'.repeat(1000))]) {
    const advice = getPositionAdvice({ fen, analysis: { pv } });
    boundedAdvice(advice);
    assert.equal(advice.line, '');
  }
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const repeated = getPositionAdvice({ fen, analysis: { pv: Array.from({ length: 10000 }, (_, i) => cycle[i % cycle.length]) } });
  boundedAdvice(repeated);
  assert.ok(repeated.line.length < 150, 'only a short legal continuation belongs in the coach bubble');
});
