import { Chess } from '../vendor/chess.js';
import { parseGame } from './model.js';
import { importSource, sourceGameReference } from './import-sources.js';

export const IMPORT_PREFIX = 'rook.import.';
export const IMPORT_TTL_MS = 15 * 60 * 1000;
export const MAX_IMPORT_TEXT = 262144;
export const MAX_IMPORT_MOVES = 1000;

export class ChesscomImportError extends Error {
  constructor(code, message) { super(message); this.name = 'ChesscomImportError'; this.code = code; }
}

export function chesscomUrl(value) {
  const provider = importSource(value);
  return provider?.source === 'chess.com' ? provider.url : null;
}

export function gameReference(value) {
  const url = chesscomUrl(value);
  return url?.match(/\/(?:analysis\/)?game\/(live|daily)\/(\d+)(?:\/|$)/)?.slice(1).join(':') || null;
}

const fromPosition = value => typeof value === 'string' && /^from[\s_-]?position$/i.test(value.trim());

const LICHESS_IMPORT_ERRORS = Object.freeze({
  'ongoing-game': 'Lichess delays exports of games in progress. Open the completed game and click Elo Pal again.',
  'export-unavailable': 'Lichess could not provide a public PGN export for this game or study chapter. Use its Download PGN option and import the file here.',
  'export-timeout': 'The Lichess PGN export took too long. Try again, or download the PGN and import the file here.',
  'export-too-large': 'This Lichess export is too large for one-click import. Download the game or individual study chapter as PGN and import the file here.',
  'invalid-pgn': 'Lichess did not return a readable PGN. Use its Download PGN option and import the file here.',
  'no-selected-chapter': 'Select a chapter in the Lichess study, wait for it to load, and click Elo Pal again.',
  'page-changed': 'The Lichess game or selected study chapter changed while importing. Open the desired game or chapter and try again.',
  'unsupported-page': 'Open a Lichess game, analysis board, or individual study chapter, then click Elo Pal again. You can also import a PGN file here.',
});

function rejectVariant(value, source) {
  if (value == null || value === '') return;
  if (source === 'lichess.org' && fromPosition(value)) return;
  if (typeof value !== 'string' || !/^(standard|chess|normal|regular|classical)$/i.test(value.trim())) {
    throw new ChesscomImportError('unsupported-variant', 'Elo Pal currently reviews standard chess. This page contains an unsupported chess variant.');
  }
}

function checkHeaders(headers, expectedUrl) {
  const provider = importSource(expectedUrl);
  rejectVariant(headers.Variant, provider?.source);
  const expected = sourceGameReference(expectedUrl);
  if (!expected) return;
  for (const value of [headers.Link, headers.Site]) {
    const actual = sourceGameReference(value);
    if (!actual) continue;
    // An imported study chapter may retain its original game's Site header.
    // Compare chapter links when present, rather than treating that provenance
    // as the study identity. A game page must match every known game reference.
    const mismatch = expected.kind === 'game'
      ? actual.key !== expected.key
      : actual.kind === 'study' && (actual.source !== expected.source || actual.id !== expected.id
        || (expected.chapterId && actual.chapterId && actual.chapterId !== expected.chapterId));
    if (mismatch) throw new ChesscomImportError('game-mismatch', `The game data does not match this ${provider.label} page. Reload the game and try again.`);
  }
}

function checkFromPosition(game, candidate, snapshot) {
  if (![snapshot.variant, game.headers.Variant].some(fromPosition)) return;
  const explicitFen = game.headers.FEN || candidate.startFen;
  if (!explicitFen) throw new Error('A From Position game must include its starting FEN.');
  if (new Chess(explicitFen).fen() !== game.startFen) throw new Error('The custom starting position does not match the move list.');
  // chess.js handles ordinary custom positions. Its editor-style FEN loading
  // does not certify that a castling flag describes standard castling squares.
  const board = new Chess(game.startFen);
  const rights = game.startFen.split(' ')[2];
  for (const [flag, color, king, rook] of [['K', 'w', 'e1', 'h1'], ['Q', 'w', 'e1', 'a1'], ['k', 'b', 'e8', 'h8'], ['q', 'b', 'e8', 'a8']]) {
    if (rights.includes(flag) && (board.get(king)?.type !== 'k' || board.get(king)?.color !== color || board.get(rook)?.type !== 'r' || board.get(rook)?.color !== color)) {
      throw new Error('The custom position does not use standard chess castling.');
    }
  }
}

function cleanSan(value) {
  return value.trim().replace(/[♔♚]/g, 'K').replace(/[♕♛]/g, 'Q').replace(/[♖♜]/g, 'R')
    .replace(/[♗♝]/g, 'B').replace(/[♘♞]/g, 'N').replace(/[♙♟]/g, '')
    .replace(/^\d+\.(?:\.\.)?\s*/, '').replace(/[!?]+$/g, '').replace(/\s+/g, '');
}

function replayMoves(candidate) {
  if (!Array.isArray(candidate.moves) || !candidate.moves.length || candidate.moves.length > MAX_IMPORT_MOVES) {
    throw new Error('Move list is empty or too long.');
  }
  const headers = candidate.headers && typeof candidate.headers === 'object' ? candidate.headers : {};
  const startFen = candidate.startFen || headers.FEN;
  const chess = startFen ? new Chess(startFen) : new Chess();
  for (const key of ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'WhiteElo', 'BlackElo', 'Result', 'Link', 'Variant']) {
    if (typeof headers[key] === 'string' && headers[key].length <= 512 && !/[\r\n]/.test(headers[key])) chess.setHeader(key, headers[key]);
  }
  for (const move of candidate.moves) {
    if (typeof move === 'string' && move.length <= 40) {
      const san = cleanSan(move);
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(san)) chess.move({ from: san.slice(0, 2), to: san.slice(2, 4), promotion: san[4] });
      else chess.move(san);
    } else if (move && typeof move === 'object' && typeof move.from === 'string' && typeof move.to === 'string') {
      if (!/^[a-h][1-8]$/.test(move.from) || !/^[a-h][1-8]$/.test(move.to) || (move.promotion && !/^[qrbn]$/i.test(move.promotion))) throw new Error('Unsupported move coordinates.');
      chess.move({ from: move.from, to: move.to, promotion: move.promotion?.toLowerCase() });
    } else throw new Error('Unsupported move notation.');
  }
  return chess.pgn();
}

/** Independently validate untrusted page data before it enters extension storage. */
export function validateImportedSnapshot(snapshot, expectedUrl) {
  const provider = importSource(expectedUrl);
  if (!provider) throw new ChesscomImportError('wrong-site', 'Open a Chess.com or Lichess game or analysis board, then click Elo Pal again. You can also import a PGN file here.');
  const { source, label, url: sourceUrl } = provider;
  if (!snapshot || importSource(snapshot.sourceUrl)?.url !== sourceUrl || (snapshot.source != null && snapshot.source !== source)) {
    throw new ChesscomImportError('page-changed', `The ${label} page changed while importing. Open the game and try again.`);
  }
  rejectVariant(snapshot.variant, source);
  if (source === 'lichess.org' && Object.hasOwn(LICHESS_IMPORT_ERRORS, snapshot.error)) {
    throw new ChesscomImportError(snapshot.error, LICHESS_IMPORT_ERRORS[snapshot.error]);
  }
  if (snapshot.error === 'ambiguous-board') throw new ChesscomImportError('no-game', 'This page contains multiple boards. Open the individual game or its analysis page and try again.');
  const candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates.slice(0, 10) : [];
  let lastError;
  const valid = [];
  for (const candidate of candidates) {
    try {
      if (!candidate || !['pgn', 'moves'].includes(candidate.format)) continue;
      let text;
      if (candidate.format === 'pgn') {
        if (typeof candidate.text !== 'string' || !candidate.text.trim() || candidate.text.length > MAX_IMPORT_TEXT) continue;
        text = candidate.text;
      } else {
        checkHeaders(candidate.headers || {}, sourceUrl);
        text = replayMoves(candidate);
      }
      const game = parseGame(text);
      checkHeaders(game.headers, sourceUrl);
      checkFromPosition(game, candidate, snapshot);
      if (!game.moves.length) continue;
      if (game.moves.length > MAX_IMPORT_MOVES) throw new Error('Too many moves.');
      if (Number.isInteger(snapshot.minimumPly) && game.moves.length < snapshot.minimumPly) throw new Error('The extracted data omits moves shown in the game.');
      if (Number.isInteger(candidate.expectedPly) && candidate.expectedPly !== game.moves.length) throw new Error('The move list is incomplete.');
      if (typeof candidate.currentFen === 'string') {
        // Some boards retain an en-passant square even when no capture is legal.
        // Chess.js canonicalizes that harmless FEN difference before comparison.
        const position = new Chess(candidate.currentFen).fen().split(' ').slice(0, 4).join(' ');
        if (!game.positions.some(fen => fen.split(' ').slice(0, 4).join(' ') === position)) throw new Error('The moves do not match the displayed board.');
      }
      valid.push({ game, candidate });
    } catch (error) {
      if (error instanceof ChesscomImportError) throw error;
      lastError = error;
    }
  }
  if (valid.length) {
    // getHistory()/getPGN() can describe only the selected prefix or variation.
    // Use the verified main move list as an anchor, then keep the longest
    // compatible source. This also preserves full PGN when a list is virtualized.
    const mainline = valid.find(({ candidate }) => candidate.mainline === true);
    const uci = move => move.from + move.to + (move.promotion || '');
    const sameLine = (first, second) => first.startFen === second.startFen && first.moves.slice(0, Math.min(first.moves.length, second.moves.length)).every((move, index) => uci(move) === uci(second.moves[index]));
    const compatible = mainline ? valid.filter(({ game }) => sameLine(game, mainline.game)) : valid;
    compatible.sort((a, b) => b.game.moves.length - a.game.moves.length || Number(b.candidate.format === 'pgn') - Number(a.candidate.format === 'pgn'));
    const { game, candidate } = compatible[0];
    return { pgn: game.pgn, source, sourceUrl, method: typeof candidate.method === 'string' ? candidate.method.slice(0, 80) : 'page', moveCount: game.moves.length };
  }
  if (lastError) throw new ChesscomImportError('invalid-game', 'Elo Pal found game data but could not verify the complete legal move list. Open the game’s analysis page, or use its Download PGN option and import that file.');
  throw new ChesscomImportError('no-game', `No complete game was found on this page. Wait for the ${label} board to load, or open the game’s analysis page and click Elo Pal again.`);
}
