import { Chess } from '../vendor/chess.js';

/** Morphy's 1858 Opera Game, with a complete legal main line. */
export const DEMO_PGN = `[Event "Opera Game"]
[Site "Paris"]
[Date "1858.??.??"]
[Round "?"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5
6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5
11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6
15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

export const REVIEW_CATEGORIES = Object.freeze([
  'book', 'brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'forced',
]);

/**
 * Read one PGN game or one FEN. Positions are indexed by ply, so positions[0]
 * is the starting board and moves[i] leads to positions[i + 1]. Chess.js
 * validates the board and all main-line moves, including special moves.
 */
export function parseGame(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Paste a PGN game or a FEN position to begin.');
  }

  const source = text.replace(/^\uFEFF/, '').trim();
  const firstToken = source.split(/\s/, 1)[0];
  const isFen = firstToken.includes('/') && !firstToken.startsWith('[');
  let board;

  try {
    board = isFen ? new Chess(source) : new Chess();
    if (!isFen) board.loadPgn(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read this ${isFen ? 'FEN position' : 'PGN game'}: ${reason}`);
  }

  const moves = board.history({ verbose: true });
  const headers = { ...board.getHeaders() };
  if (!isFen && !moves.length && !headers.FEN) {
    throw new Error('This PGN contains no moves. Paste a game with legal moves, or a FEN position.');
  }

  const startFen = moves[0]?.before ?? board.fen();
  // Chess.js validates FEN structure/material basics, but allows editor-style
  // positions where the side that just moved has left its own king in check.
  // Such a position cannot be analyzed as a legal game. Flipping only the turn
  // lets isCheck inspect that king; en-passant is irrelevant to this check.
  const previousSideFen = startFen.split(' ');
  previousSideFen[1] = previousSideFen[1] === 'w' ? 'b' : 'w';
  previousSideFen[3] = '-';
  if (new Chess(previousSideFen.join(' ')).isCheck()) {
    throw new Error('This starting position is illegal: the side that just moved is still in check. Check the kings and the side to move.');
  }
  return {
    headers,
    positions: [startFen, ...moves.map((move) => move.after)],
    moves,
    pgn: board.pgn(),
    startFen,
  };
}

function finiteScore(evaluation) {
  if (Number.isFinite(evaluation?.mate)) {
    // A finite surrogate lets mate scores participate in averages and charts.
    // Mate distance remains ordered; a shorter win is worth more.
    const distance = Math.min(Math.abs(evaluation.mate), 99);
    const negative = evaluation.mate < 0 || Object.is(evaluation.mate, -0);
    return (negative ? -1 : 1) * (10000 - distance * 10);
  }
  if (Number.isFinite(evaluation?.cp)) return evaluation.cp;
  throw new Error('An engine evaluation must contain a finite cp or mate score.');
}

const boundedScore = (evaluation) => evaluation?.lowerbound || evaluation?.upperbound
  || (evaluation?.bound != null && evaluation.bound !== 'exact');

function winChance(cp) {
  // This is a transparent heuristic, not a calibrated engine WDL probability.
  // Zero = 50%; +300 cp = about 73.1%. Clamping avoids numeric overflow.
  return 100 / (1 + Math.exp(-Math.max(-10000, Math.min(10000, cp)) / 300));
}

function inspectPosition(fen) {
  if (!fen) return null;
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

const MATERIAL = Object.freeze({ p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 });
const PIECE_NAMES = Object.freeze({ n: 'knight', b: 'bishop', r: 'rook', q: 'queen' });
const moveUci = (move) => `${move.from}${move.to}${move.promotion ?? ''}`;
const captureValue = (move) => (MATERIAL[move.captured] ?? 0)
  + (move.promotion ? MATERIAL[move.promotion] - MATERIAL.p : 0);

/**
 * A legal static-exchange search: each player can stop exchanging or choose
 * any legal recapture on this square. Unlike an attacked-square test, this
 * respects pins, king safety, underpromotions and recaptures. The search is
 * deliberately bounded; an unresolved branch cannot support a Brilliant.
 */
function exchangeGain(board, square, budget, depth = 0) {
  if (++budget.nodes > 1500) return null;
  const captures = board.moves({ verbose: true }).filter((move) => move.to === square && move.captured);
  if (!captures.length) return { gain: 0, line: [] };
  if (depth >= 12) return null;
  let best = { gain: 0, line: [] };
  for (const capture of captures) {
    board.move(capture);
    const reply = exchangeGain(board, square, budget, depth + 1);
    board.undo();
    if (!reply) return null;
    const gain = captureValue(capture) - reply.gain;
    if (gain > best.gain) best = { gain, line: [capture.san, ...reply.line] };
  }
  return best;
}

function bestCaptureReply(board, budget) {
  let best = { gain: 0, line: [] };
  for (const capture of board.moves({ verbose: true }).filter((move) => move.captured)) {
    board.move(capture);
    const reply = exchangeGain(board, capture.to, budget);
    board.undo();
    if (!reply) return null;
    const gain = captureValue(capture) - reply.gain;
    if (gain > best.gain) best = { gain, line: [capture.san, ...reply.line] };
  }
  return best;
}

function materialBalance(board, color) {
  return board.board().flat().reduce((total, piece) => !piece ? total
    : total + MATERIAL[piece.type] * (piece.color === color ? 1 : -1), 0);
}

function parseUci(board, token) {
  if (typeof token !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) return null;
  try {
    return board.move({ from: token.slice(0, 2), to: token.slice(2, 4), promotion: token[4] });
  } catch {
    return null;
  }
}

/**
 * Conservative, custom Brilliant detector. This is not Chess.com's formula.
 *
 * Only a newly offered, moved knight/bishop/rook/queen can qualify. Both engine
 * searches must reach depth 12; the result must be at least -0.50 for the mover,
 * lose at most 0.50 pawns OR 1.5 heuristic win-chance points, and retain any
 * previously forced mate. The original piece must not already be hanging.
 *
 * A legal acceptance must cost at least one pawn after the mover's best
 * immediate capture (any square) and its legal recapture chain, including
 * material captured by the candidate move. A temporary
 * sacrifice can instead be supported by an engine PV that legally accepts it
 * and deliberately leaves that material invested with its next move. This
 * recognizes exchange sacrifices with a stronger non-recapture continuation.
 * Ordinary equal trades, pawn promotions, forced moves, terminal positions and
 * shallow/unknown evaluations do not qualify. We intentionally miss some
 * indirect sacrifices instead of guessing from attacked squares.
 *
 * All metadata values are in pawn units; line contains legal SAN moves after
 * the candidate. Returns null whenever the evidence is insufficient.
 */
export function classifySacrifice(before, after, move, bestUci) {
  if (!move || !PIECE_NAMES[move.piece] || move.promotion
    || !['w', 'b'].includes(move.color)
    || !Number.isFinite(before?.depth) || !Number.isFinite(after?.depth)
    || before.depth < 12 || after.depth < 12 || boundedScore(before) || boundedScore(after)) return null;
  const beforeBoard = inspectPosition(move.before);
  const afterBoard = inspectPosition(move.after);
  if (!beforeBoard || !afterBoard || beforeBoard.isGameOver() || afterBoard.isGameOver()
    || before?.terminal || after?.terminal) return null;
  const legal = beforeBoard.moves({ verbose: true });
  const best = typeof bestUci === 'string' ? bestUci.trim().split(/\s+/)[0] : before?.pv?.[0];
  if (legal.length <= 1 || !legal.some((candidate) => moveUci(candidate) === best)
    || !legal.some((candidate) => moveUci(candidate) === moveUci(move))) return null;
  const actual = parseUci(beforeBoard, moveUci(move));
  if (!actual || beforeBoard.fen() !== afterBoard.fen()) return null;
  beforeBoard.undo();

  const perspective = move.color === 'w' ? 1 : -1;
  let beforeCp, afterCp;
  try {
    beforeCp = finiteScore(before) * perspective;
    afterCp = finiteScore(after) * perspective;
  } catch {
    return null;
  }
  const loss = Math.max(0, beforeCp - afterCp);
  const chanceLoss = Math.max(0, winChance(beforeCp) - winChance(afterCp));
  if (afterCp < -50 || (loss > 50 && chanceLoss > 1.5)
    || (Number.isFinite(before.mate) && beforeCp > 0
      && !(Number.isFinite(after.mate) && afterCp > 0))) return null;

  // Probe the old square with a hypothetical pass, removing the en-passant
  // field because it belongs to the original side to move. Merely moving an
  // already hanging piece to another attacked square is not a new sacrifice.
  const oldFen = beforeBoard.fen().split(' ');
  oldFen[1] = oldFen[1] === 'w' ? 'b' : 'w';
  oldFen[3] = '-';
  const oldRisk = exchangeGain(new Chess(oldFen.join(' ')), move.from, { nodes: 0 });
  if (!oldRisk || oldRisk.gain > 0) return null;

  const capturedValue = MATERIAL[actual.captured] ?? 0;
  const baseline = materialBalance(beforeBoard, move.color);
  const accepted = [];
  const captures = afterBoard.moves({ verbose: true }).filter((capture) =>
    capture.to === move.to && capture.captured === move.piece);
  for (const capture of captures) {
    afterBoard.move(capture);
    const recapture = bestCaptureReply(afterBoard, { nodes: 0 });
    afterBoard.undo();
    if (!recapture) continue;
    const cost = captureValue(capture) - recapture.gain - capturedValue;
    if (cost >= 100) {
      accepted.push({ capture, cost, basis: 'legal-exchange', line: [capture.san, ...recapture.line] });
    }
  }

  // A temporary investment needs explicit engine evidence. Check both PV
  // moves legally, then verify the material is still down after the suggested
  // non-recapture; equal trades and immediate recovery cannot pass this test.
  const pv = after?.pv;
  if (Array.isArray(pv) && pv.length >= 2) {
    const capture = captures.find((candidate) => moveUci(candidate) === pv[0]);
    if (capture) {
      const continuation = new Chess(move.after);
      parseUci(continuation, pv[0]);
      const response = parseUci(continuation, pv[1]);
      if (response && response.to !== move.to && !response.promotion) {
        const cost = baseline - materialBalance(continuation, move.color);
        if (cost >= 100) accepted.push({ capture, cost, basis: 'engine-continuation', line: [capture.san, response.san] });
      }
    }
  }
  if (!accepted.length) return null;
  accepted.sort((a, b) => b.cost - a.cost);
  const offer = accepted[0];
  return {
    square: move.to,
    piece: move.piece,
    value: MATERIAL[move.piece] / 100,
    capturedPiece: actual.captured ?? null,
    capturedValue: capturedValue / 100,
    materialCost: offer.cost / 100,
    acceptance: { uci: moveUci(offer.capture), san: offer.capture.san },
    line: offer.line,
    basis: offer.basis,
    engineDepth: Math.min(before.depth, after.depth),
  };
}

/** Keep opening records short and textual; recognition belongs to the local book matcher. */
export function normalizeOpening(opening) {
  if (!opening || typeof opening !== 'object') return null;
  const clean = (value, limit) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
  const name = clean(opening.name, 120), family = clean(opening.family, 100);
  if (!name && !family) return null;
  const details = opening.details && typeof opening.details === 'object' ? opening.details : {};
  return {
    isBookMove: opening.isBookMove === true,
    eco: /^[A-E]\d{2}$/.test(opening.eco) ? opening.eco : '',
    name: name || family,
    family,
    variation: clean(opening.variation, 120),
    pgn: clean(opening.pgn, 1200),
    details: {
      description: clean(details.description, 300),
      whitePlan: clean(details.whitePlan, 180),
      blackPlan: clean(details.blackPlan, 180),
      watchFor: clean(details.watchFor, 180),
    },
  };
}

/**
 * Great is a conservative critical-move heuristic, not another name for Best.
 * The played move must be the top legal MultiPV candidate. Both ranked lines
 * and the resulting position need exact depth >=12 scores; the two candidates
 * must be within one depth and the top line must match the supplied before
 * evaluation. The second legal candidate must trail by >=200 centipawns and
 * either fall to <=-150 while the best stays >=-50, or fall to <=+50 while the
 * best keeps >=+200 (all from the mover's perspective). The played result must
 * preserve that outcome, lose <=50cp OR <=1.5 heuristic win-chance points, and
 * retain a previously forced mate. A merely large gap between two winning or
 * two losing moves is insufficient. Forced moves and terminal boards do not
 * qualify. MultiPV describes this search's ranking, not a mathematical proof.
 */
export function classifyGreat(before, after, move, bestUci) {
  if (!move || !['w', 'b'].includes(move.color) || !Array.isArray(before?.lines)) return null;
  const first = before.lines.find((line) => line?.multipv === 1);
  const second = before.lines.find((line) => line?.multipv === 2);
  if (![before, after, first, second].every((score) => score && Number.isFinite(score.depth)
    && score.depth >= 12 && !boundedScore(score) && !score.terminal)
    || Math.abs(first.depth - second.depth) > 1 || first.depth !== before.depth) return null;
  const board = inspectPosition(move.before), afterBoard = inspectPosition(move.after);
  if (!board || !afterBoard || board.isGameOver() || afterBoard.isGameOver()) return null;
  const legal = board.moves({ verbose: true });
  const uci = moveUci(move);
  const best = typeof bestUci === 'string' ? bestUci.trim().split(/\s+/)[0] : null;
  const alternative = legal.find((candidate) => moveUci(candidate) === second.pv?.[0]);
  if (legal.length <= 1 || best !== uci || first.pv?.[0] !== uci
    || !alternative || moveUci(alternative) === uci) return null;
  const played = parseUci(board, uci);
  if (!played || board.fen() !== afterBoard.fen()) return null;
  const perspective = move.color === 'w' ? 1 : -1;
  let firstCp, secondCp, afterCp;
  try {
    firstCp = finiteScore(first) * perspective;
    secondCp = finiteScore(second) * perspective;
    afterCp = finiteScore(after) * perspective;
    if (finiteScore(before) * perspective !== firstCp) return null;
  } catch {
    return null;
  }
  const gap = firstCp - secondCp;
  const loss = Math.max(0, firstCp - afterCp);
  const chanceLoss = Math.max(0, winChance(firstCp) - winChance(afterCp));
  if (gap < 200 || (loss > 50 && chanceLoss > 1.5)
    || (Number.isFinite(first.mate) && firstCp > 0
      && !(Number.isFinite(after.mate) && afterCp > 0))) return null;
  let reason;
  if (firstCp >= 200 && secondCp <= 50) {
    if (afterCp < 200) return null;
    reason = 'only-winning-move';
  } else if (firstCp >= -50 && secondCp <= -150) {
    if (afterCp < -50) return null;
    reason = 'only-nonlosing-move';
  }
  else return null;
  return {
    alternative: {
      uci: moveUci(alternative), san: alternative.san,
      cp: Number.isFinite(second.cp) ? second.cp : null,
      mate: Number.isFinite(second.mate) ? second.mate : null,
    },
    gap,
    winChanceGap: winChance(firstCp) - winChance(secondCp),
    reason,
    engineDepth: Math.min(first.depth, second.depth, after.depth),
  };
}

/**
 * Our review heuristic is intentionally independent of Chess.com's proprietary
 * labels and accuracy formula. Scores use White's perspective throughout.
 *
 * loss: nonnegative centipawns; winChanceLoss: percentage points from a logistic
 * cp/300 curve. Accuracy = 100 * exp(-winChanceLoss/15). Categories use losses
 * of <=1.5 / <=4 / <=8 / <=16 / >16 points. A matching best UCI move, or the
 * only legal move, scores 100. Brilliant additionally requires a new, sound
 * material offer confirmed by classifySacrifice. These are custom estimates.
 */
export function evaluateMove(before, after, move, bestUci, { opening } = {}) {
  if (!move || !['w', 'b'].includes(move.color)) {
    throw new Error('A reviewed move must identify its color as w or b.');
  }

  const perspective = move.color === 'w' ? 1 : -1;
  const beforeCp = finiteScore(before);
  const afterBoard = inspectPosition(move.after);
  let afterCp = finiteScore(after);
  if (afterBoard?.isCheckmate()) {
    afterCp = afterBoard.turn() === 'w' ? -10000 : 10000;
  } else if (afterBoard?.isDraw()) {
    afterCp = 0;
  }

  const loss = Math.max(0, (beforeCp - afterCp) * perspective);
  const winChanceLoss = Math.max(0,
    winChance(beforeCp * perspective) - winChance(afterCp * perspective));
  const uci = `${move.from}${move.to}${move.promotion ?? ''}`.toLowerCase();
  const best = typeof bestUci === 'string' ? bestUci.trim().split(/\s+/)[0].toLowerCase() : '';
  const beforeBoard = inspectPosition(move.before);

  const book = normalizeOpening(opening);
  if (book?.isBookMove) {
    return {
      key: 'book', label: 'Book', symbol: '▣', accuracy: 100, loss, winChanceLoss,
      engineAccuracy: 100 * Math.exp(-winChanceLoss / 15), opening: book,
      description: `${move.san} follows ${book.name}${book.eco ? ` (${book.eco})` : ''} in the local opening book. `
        + 'Book moves receive 100 review accuracy; the displayed engine score and measured evaluation loss remain separate.',
    };
  }

  if (beforeBoard && beforeBoard.moves().length === 1) {
    return {
      key: 'forced', label: 'Forced', loss: 0, winChanceLoss: 0, accuracy: 100,
      description: 'This was the only legal move in the position.',
    };
  }
  const sacrifice = classifySacrifice(before, after, move, bestUci);
  if (sacrifice) {
    const accuracy = best && uci === best ? 100 : 100 * Math.exp(-winChanceLoss / 15);
    return {
      key: 'brilliant', label: 'Brilliant', symbol: '!!', loss, winChanceLoss, accuracy, sacrifice,
      description: `Offers the ${PIECE_NAMES[sacrifice.piece]} on ${sacrifice.square}. `
        + `${sacrifice.acceptance.san} can accept it, with ${sacrifice.materialCost.toFixed(1)} pawns `
        + `invested in the ${sacrifice.basis === 'legal-exchange' ? 'local exchange' : 'engine continuation'}. `
        + 'The engine preserves a playable position. Brilliant is this extension’s conservative custom label.',
    };
  }
  const great = classifyGreat(before, after, move, bestUci);
  if (great) {
    return {
      key: 'great', label: 'Great', symbol: '!', accuracy: 100, loss, winChanceLoss, great,
      description: `${move.san} is the engine’s critical first choice at this depth. `
        + `${great.alternative.san}, its next candidate, ${great.reason === 'only-winning-move'
          ? 'gives up the clear advantage' : 'leaves a clear disadvantage'}. `
        + 'Great is a conservative local heuristic based on two legal engine lines.',
    };
  }
  if ((best && uci === best) || afterBoard?.isCheckmate()) {
    return {
      key: 'best', label: 'Best', loss: 0, winChanceLoss: 0, accuracy: 100,
      description: afterBoard?.isCheckmate()
        ? 'This move delivers checkmate.'
        : 'This move matches the engine’s first choice at the selected search strength.',
    };
  }

  let key;
  if (winChanceLoss <= 1.5) key = 'excellent';
  else if (winChanceLoss <= 4) key = 'good';
  else if (winChanceLoss <= 8) key = 'inaccuracy';
  else if (winChanceLoss <= 16) key = 'mistake';
  else key = 'blunder';

  const label = key[0].toUpperCase() + key.slice(1);
  const accuracy = Math.max(0, Math.min(100, 100 * Math.exp(-winChanceLoss / 15)));
  return {
    key, label, loss, winChanceLoss, accuracy,
    description: `Estimated win-chance loss: ${winChanceLoss.toFixed(1)} percentage points `
      + `(${(loss / 100).toFixed(2)} pawns of evaluation). Uses this extension’s custom review formula.`,
  };
}

/** Arithmetic mean of reviewed move accuracies, grouped by the moving color. */
export function summarizeReview(game, reviews = []) {
  const makeSide = () => ({
    accuracy: null,
    reviewed: 0,
    total: 0,
    categories: Object.fromEntries(REVIEW_CATEGORIES.map((key) => [key, 0])),
  });
  const summary = { white: makeSide(), black: makeSide(), reviewed: 0, total: game.moves.length };
  const sums = { white: 0, black: 0 };

  for (const move of game.moves) {
    summary[move.color === 'w' ? 'white' : 'black'].total += 1;
  }

  reviews.forEach((entry, index) => {
    if (!entry) return;
    const result = entry.result ?? entry.review ?? entry;
    const moveIndex = Number.isInteger(entry.index) ? entry.index : index;
    const move = entry.move ?? game.moves[moveIndex];
    if (!move || !Number.isFinite(result.accuracy) || !REVIEW_CATEGORIES.includes(result.key)) return;
    const color = move.color === 'w' ? 'white' : 'black';
    const side = summary[color];
    side.reviewed += 1;
    side.categories[result.key] += 1;
    summary.reviewed += 1;
    sums[color] += Math.max(0, Math.min(100, result.accuracy));
  });

  for (const color of ['white', 'black']) {
    if (summary[color].reviewed) summary[color].accuracy = sums[color] / summary[color].reviewed;
  }
  return summary;
}

/** Convert a UCI variation to SAN, stopping gracefully at any invalid move. */
export function pvToSan(fen, pv, max = 8) {
  const board = inspectPosition(fen);
  if (!board || !pv || max <= 0) return '';
  const tokens = Array.isArray(pv) ? pv : String(pv).trim().split(/\s+/);
  const variation = [];

  for (const token of tokens.slice(0, Math.floor(max))) {
    if (typeof token !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) break;
    try {
      const move = board.move({ from: token.slice(0, 2), to: token.slice(2, 4), promotion: token[4] });
      if (!move) break;
      variation.push(move.san);
    } catch {
      break;
    }
  }
  return variation.join(' ');
}

/** Human-readable evaluation, always from White's perspective. */
export function scoreText(evaluation) {
  if (Number.isFinite(evaluation?.mate)) {
    const negative = evaluation.mate < 0 || Object.is(evaluation.mate, -0);
    return `${negative ? '-' : ''}M${Math.abs(evaluation.mate)}`;
  }
  if (!Number.isFinite(evaluation?.cp)) return '—';
  const pawns = evaluation.cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
