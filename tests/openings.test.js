import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Chess } from '../vendor/chess.js';
import { parseGame } from '../src/model.js';
import { OPENING_SOURCE, buildOpeningTimeline, getOpeningForBoard, getOpeningMoves, getOpeningDetails } from '../src/openings.js';

function board(pgn) { const chess = new Chess(); chess.loadPgn(pgn); return chess; }

test('the bundled index covers all ECO codes and matches its pinned provenance', async () => {
  const metadata = JSON.parse(await readFile(new URL('../vendor/openings/provenance.json', import.meta.url), 'utf8'));
  assert.equal(metadata.revision, 'a6189a30dc273ccb21fc2536a9a2fefd5592a67a');
  assert.equal(metadata.license, 'CC0-1.0');
  assert.equal(metadata.ecoCodes.length, 500);
  assert.equal(metadata.ecoCodes[0], 'A00');
  assert.equal(metadata.ecoCodes.at(-1), 'E99');
  assert.equal(OPENING_SOURCE.openingCount, metadata.openingCount);
  const generated = await readFile(new URL('../vendor/openings/index.js', import.meta.url));
  assert.equal(createHash('sha256').update(generated).digest('hex'), metadata.indexSha256);
});

test('2.f4 is recognized as a King’s Gambit book move at exactly ply three', () => {
  const timeline = buildOpeningTimeline(parseGame('1. e4 e5 2. f4 *'));
  assert.equal(timeline.length, 4);
  assert.equal(timeline[0], null);
  assert.equal(timeline[2].name, "King's Pawn Game");
  assert.equal(timeline[3].name, "King's Gambit");
  assert.equal(timeline[3].eco, 'C30');
  assert.equal(timeline[3].isBookMove, true);
  assert.equal(timeline[3].namedPosition, true);
  assert.equal(timeline[3].matchedPly, 3);
  assert.equal(timeline[3].pgn, '1. e4 e5 2. f4');
});

test('accepted, classical declined and Falkbeer branches get distinct names only after Black moves', () => {
  for (const [reply, name, eco] of [
    ['exf4', "King's Gambit Accepted", 'C33'],
    ['Bc5', "King's Gambit Declined: Classical Variation", 'C30'],
    ['d5', "King's Gambit Declined: Falkbeer Countergambit", 'C31'],
  ]) {
    const timeline = buildOpeningTimeline(parseGame(`1. e4 e5 2. f4 ${reply}`));
    assert.equal(timeline[3].name, "King's Gambit");
    assert.equal(timeline[4].name, name);
    assert.equal(timeline[4].eco, eco);
    assert.equal(timeline[4].isBookMove, true);
  }
});

test('later subvariations do not leak into earlier positions or PGN header metadata', () => {
  const game = parseGame('[Opening "Unrelated Header"]\n[Variation "Future Branch"]\n1. e4 e5 2. f4 exf4 3. Nf3 g5 4. h4 g4 5. Ne5');
  const timeline = buildOpeningTimeline(game);
  assert.equal(timeline[3].name, "King's Gambit");
  assert.equal(timeline[4].name, "King's Gambit Accepted");
  assert.equal(timeline[9].name, "King's Gambit Accepted: Kieseritzky Gambit");
  assert.equal(timeline[9].variation, 'Kieseritzky Gambit');
  assert.ok(timeline.every(opening => !opening || !/Unrelated|Future/.test(opening.name)));
});

test('off-book moves retain the known opening name without being labeled Book', () => {
  const timeline = buildOpeningTimeline(parseGame('1. e4 e5 2. f4 a5 3. h4'));
  assert.equal(timeline[4].name, "King's Gambit");
  assert.equal(timeline[4].exact, false);
  assert.equal(timeline[4].isBookMove, false);
  assert.equal(timeline[5].isBookMove, false);
  assert.equal(timeline[5].matchedPly, 3);
  assert.equal(timeline[5].currentPly, 5);
  assert.equal(getOpeningForBoard(board('1. e4 e5 2. f4 a5 3. h4')), null);
});

test('named positions match across legal move-order transpositions', () => {
  const first = board('1. d4 d5 2. c4 e6 3. Nc3 Nf6');
  const second = board('1. d4 Nf6 2. c4 e6 3. Nc3 d5');
  assert.equal(first.fen().split(' ').slice(0, 4).join(' '), second.fen().split(' ').slice(0, 4).join(' '));
  const a = getOpeningForBoard(first), b = getOpeningForBoard(second);
  assert.ok(a?.exact && b?.exact);
  assert.equal(a.name, b.name);
  assert.equal(a.eco, b.eco);
  assert.ok(a.transposition || b.transposition);
  assert.equal(a.isBookMove, true);
  assert.equal(b.isBookMove, true);
});

test('intermediate book continuations retain the named ancestor actually played', () => {
  const chess = board('1. d4 d5 2. c4 e6 3. Nf3 Nf6');
  const match = getOpeningForBoard(chess);
  assert.ok(match.exact);
  assert.match(match.name, /^Queen's Gambit Declined/);
  assert.doesNotMatch(match.name, /Anti-Nimzo/);
});

test('a recognized FEN can be named without claiming historical moves were played', () => {
  const chess = board('1. e4 e5 2. f4');
  const fenOnly = new Chess(chess.fen());
  const record = getOpeningForBoard(fenOnly);
  assert.equal(record.name, "King's Gambit");
  assert.equal(record.isBookMove, false);
  assert.equal(record.fromSetup, true);
  assert.equal(record.matchedPly, 0);
  const timeline = buildOpeningTimeline(parseGame(chess.fen()));
  assert.equal(timeline[0].isBookMove, false);
  fenOnly.move('exf4');
  assert.equal(getOpeningForBoard(fenOnly).name, "King's Gambit Accepted");
  assert.equal(getOpeningForBoard(fenOnly).isBookMove, true);
});

test('position keys include castling rights and normalize harmless en-passant targets', () => {
  const chess = board('1. e4 e5 2. f4');
  const epFen = chess.fen().replace(' b KQkq - ', ' b KQkq f3 ');
  assert.equal(getOpeningForBoard(new Chess(epFen)).name, "King's Gambit");
  assert.equal(getOpeningForBoard(new Chess(chess.fen().replace(' KQkq ', ' - '))), null);
  assert.equal(getOpeningForBoard('not a fen'), null);
});

test('repetition and late FEN counters cannot manufacture fresh Book grades', () => {
  const repeated = buildOpeningTimeline(parseGame('1. Nf3 Nf6 2. Ng1 Ng8 3. e4'));
  assert.equal(repeated.at(-1).name, "King's Pawn Game");
  assert.equal(repeated.at(-1).isBookMove, false);
  const late = new Chess(board('1. e4 e5 2. f4').fen().replace(/ \d+ \d+$/, ' 0 40'));
  late.move('exf4');
  assert.equal(getOpeningForBoard(late).name, "King's Gambit Accepted");
  assert.equal(getOpeningForBoard(late).isBookMove, false);
});

test('opening choices are legal, named after the chosen move, bounded and non-mutating', () => {
  const chess = board('1. e4 e5 2. f4');
  const before = chess.fen();
  const history = chess.history();
  const moves = getOpeningMoves(chess);
  assert.equal(moves.length, 6);
  assert.equal(moves.find(move => move.uci === 'e5f4')?.name, "King's Gambit Accepted");
  assert.match(moves.find(move => move.uci === 'd7d5')?.name || '', /Falkbeer/);
  assert.match(moves.find(move => move.uci === 'f8c5')?.name || '', /Classical/);
  assert.equal(getOpeningMoves(chess, { limit: 2 }).length, 2);
  const legal = chess.moves();
  for (const move of moves) assert.ok(legal.includes(move.san));
  assert.equal(chess.fen(), before);
  assert.deepEqual(chess.history(), history);
  assert.deepEqual(getOpeningMoves(board('1. e4 e5 2. f4 a5 3. h4')), []);
});

test('instructional notes distinguish main King’s Gambit branches and stay bounded plain text', () => {
  const accepted = getOpeningDetails(getOpeningForBoard(board('1. e4 e5 2. f4 exf4')));
  const declined = getOpeningDetails(getOpeningForBoard(board('1. e4 e5 2. f4 Bc5')));
  const falkbeer = getOpeningDetails(getOpeningForBoard(board('1. e4 e5 2. f4 d5')));
  assert.match(accepted.description, /accepted/);
  assert.match(declined.description, /declines/);
  assert.match(falkbeer.description, /Falkbeer/);
  for (const notes of [accepted, declined, falkbeer, getOpeningDetails(null)]) {
    for (const field of ['description', 'whitePlan', 'blackPlan', 'watchFor']) {
      assert.equal(typeof notes[field], 'string');
      assert.ok(notes[field].length > 10 && notes[field].length < 350);
      assert.doesNotMatch(notes[field], /<[^>]+>/);
    }
  }
});
