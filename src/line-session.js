import { Chess } from '../vendor/chess.js';

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function boundedIndex(index, length) {
  if (index === Infinity) return length;
  if (!Number.isFinite(index)) return 0;
  return Math.min(length, Math.max(0, Math.floor(index)));
}

function coordinates(move) {
  return { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) };
}

function snapshot(move) {
  const moveNumber = Number(move.before.split(' ')[5]);
  return Object.freeze({
    ...move,
    uci: `${move.from}${move.to}${move.promotion || ''}`,
    moveNumber,
    numberedSan: `${moveNumber}${move.color === 'w' ? '.' : '...'} ${move.san}`,
  });
}

/**
 * Freeze a legal engine line at an original-game origin. Cursor 0 is the origin;
 * cursor n includes n PV moves. Each boardAt call replays the original history,
 * retaining repetition information, and returns an independent mutable Chess.
 * A malformed or illegal PV suffix is discarded. Invalid original history is
 * an error, because it cannot identify the requested origin reliably.
 */
export function createLineSession({ startFen, moves = [], originPly = 0, pv = [] } = {}) {
  if (!Array.isArray(moves)) throw new Error('The original game moves must be an array.');
  const origin = boundedIndex(originPly, moves.length);
  let board;
  try {
    board = new Chess(startFen);
  } catch (error) {
    throw new Error(`Could not open the line's starting position: ${error.message}`);
  }
  const initialFen = board.fen();
  const history = [];
  for (let index = 0; index < origin; index += 1) {
    try {
      const original = moves[index];
      const move = board.move(typeof original === 'string' ? original : coordinates(original));
      history.push(snapshot(move));
    } catch {
      throw new Error(`Could not replay original game move ${index + 1}.`);
    }
  }
  const originFen = board.fen();
  const tokens = typeof pv === 'string' ? pv.trim().split(/\s+/) : Array.isArray(pv) ? [...pv] : [];
  const steps = [];
  for (const token of tokens) {
    if (board.isGameOver() || typeof token !== 'string' || !UCI_MOVE.test(token)) break;
    try {
      const move = board.move({ from: token.slice(0, 2), to: token.slice(2, 4), promotion: token[4] });
      steps.push(snapshot(move));
    } catch {
      break;
    }
  }
  Object.freeze(history);
  Object.freeze(steps);
  const san = steps.map((move, index) => move.color === 'w' || index === 0 ? move.numberedSan : move.san).join(' ');
  const moveAt = (index) => steps[boundedIndex(index, steps.length) - 1] || null;

  return Object.freeze({
    originPly: origin,
    originFen,
    length: steps.length,
    steps,
    san,
    boardAt(index) {
      const result = new Chess(initialFen);
      for (const move of history) result.move(coordinates(move));
      const count = boundedIndex(index, steps.length);
      for (let cursor = 0; cursor < count; cursor += 1) result.move(coordinates(steps[cursor]));
      return result;
    },
    moveAt,
    sanAt: (index) => moveAt(index)?.san || '',
    notationAt: (index) => moveAt(index)?.numberedSan || '',
  });
}
