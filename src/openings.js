import { Chess } from '../vendor/chess.js';
import data from '../vendor/openings/index.js';

export const OPENING_SOURCE = Object.freeze({ name: 'Lichess opening names', license: 'CC0-1.0', revision: data.revision,
  openingCount: data.rows.length, positionCount: data.positions.length, url: 'https://github.com/lichess-org/chess-openings' });
const START_FEN = new Chess().fen();
const key = fen => fen.split(' ').slice(0, 4).join(' ');
const START_KEY = key(START_FEN);
const byPosition = new Map(data.positions.map((node, index) => [node[0], index]));
const moveUci = move => move.from + move.to + (move.promotion || '');
const absolutePly = fen => { const fields = fen.split(' '); return (Number(fields[5]) - 1) * 2 + (fields[1] === 'b' ? 1 : 0); };

function boardContext(board) {
  const chess = typeof board === 'string' ? new Chess(board) : board;
  const fen = chess.fen();
  const moves = typeof chess.history === 'function' ? chess.history({ verbose: true }) : [];
  const startFen = moves[0]?.before || fen;
  const seen = new Set([key(startFen)]);
  let repetition = false;
  for (const move of moves) {
    const position = key(move.after);
    if (seen.has(position)) repetition = true;
    seen.add(position);
  }
  return { chess, fen, moves, startFen, repetition, history: moves.map(moveUci) };
}

function makeRecord(nodeId, { fen, history = [], startFen = START_FEN, ply = history.length, repetition = false, fallbackLabel } = {}) {
  const node = data.positions[nodeId];
  if (!node || node[1] < 0) return null;
  const fromSetup = key(startFen) !== START_KEY;
  let label = !node[2].length && Number.isInteger(fallbackLabel) ? fallbackLabel : node[1];
  if (!fromSetup && node[2].length) {
    const routeMatch = node[2].filter(id => data.rows[id][3].length === history.length && data.rows[id][3].every((move, index) => history[index] === move));
    if (routeMatch.length) label = routeMatch.sort((a, b) => data.rows[b][1].length - data.rows[a][1].length || a - b)[0];
  }
  const [eco, name, pgn, referenceMoves] = data.rows[label];
  const colon = name.indexOf(':');
  const family = colon < 0 ? name : name.slice(0, colon);
  const variation = colon < 0 ? '' : name.slice(colon + 1).trim();
  const canonical = data.rows[node[3]][3].slice(0, node[4]);
  const transposition = !fromSetup && history.length === canonical.length && history.some((move, index) => move !== canonical[index]);
  return { eco, name, family, variation, pgn, openingId: label, matchedPly: ply, currentPly: ply, referencePly: referenceMoves.length,
    exact: true, namedPosition: node[2].length > 0,
    // Repetition and late re-entry must not turn an ordinary middlegame move
    // into a Book move merely because its board happens to match an opening.
    isBookMove: ply > 0 && !repetition && absolutePly(fen) <= node[6],
    transposition, fromSetup, positionKey: node[0],
    aliases: [...new Set(node[2].map(id => data.rows[id][1]))].filter(alias => alias !== name),
    source: OPENING_SOURCE.name, sourceRevision: data.revision };
}

/** Current position only. Imported FENs can be named without claiming a played Book move. */
export function getOpeningForBoard(board) {
  try {
    const context = boardContext(board);
    const id = byPosition.get(key(context.fen));
    // For an intermediate book position, retain the named ancestor actually
    // played instead of borrowing a label from a different canonical route.
    let fallbackLabel;
    const route = [context.startFen, ...context.moves.map(move => move.after)];
    route.forEach((fen, ply) => {
      const routeId = byPosition.get(key(fen));
      if (routeId !== undefined && data.positions[routeId][2].length) {
        fallbackLabel = makeRecord(routeId, { ...context, fen, ply, history: context.history.slice(0, ply) })?.openingId;
      }
    });
    context.fallbackLabel = fallbackLabel;
    return id === undefined ? null : makeRecord(id, context);
  } catch { return null; }
}

/** One record per position, retaining the last known name after leaving the book. */
export function buildOpeningTimeline(game) {
  if (!game || !Array.isArray(game.positions)) return [];
  const history = [], seen = new Set();
  const startFen = game.startFen || game.positions[0] || START_FEN;
  let last = null, repetition = false;
  return game.positions.map((sourceFen, ply) => {
    if (ply && game.moves?.[ply - 1]) history.push(moveUci(game.moves[ply - 1]));
    let fen;
    try { fen = new Chess(sourceFen).fen(); } catch { return null; }
    const position = key(fen);
    if (seen.has(position)) repetition = true;
    seen.add(position);
    const id = byPosition.get(position);
    const found = id === undefined ? null : makeRecord(id, { fen, history, startFen, ply, repetition, fallbackLabel: last?.openingId });
    if (found) { last = found; return found; }
    return last ? { ...last, exact: false, isBookMove: false, namedPosition: false, transposition: false, currentPly: ply, positionKey: position } : null;
  });
}

/** Legal continuations present in the dataset, not engine rankings or win rates. */
export function getOpeningMoves(board, { limit = 6 } = {}) {
  try {
    const context = boardContext(board);
    const id = byPosition.get(key(context.fen));
    if (id === undefined) return [];
    const legal = new Map(context.chess.moves({ verbose: true }).map(move => [moveUci(move), move]));
    const fallbackLabel = getOpeningForBoard(context.chess)?.openingId;
    return data.positions[id][5].filter(edge => legal.has(edge[0])).slice(0, Math.max(1, Math.min(12, Number(limit) || 6))).map(([uci, san, nextId, lineCount]) => {
      const move = legal.get(uci);
      const opening = makeRecord(nextId, { ...context, fen: move.after, history: [...context.history, uci], ply: context.history.length + 1,
        fallbackLabel });
      return { ...opening, uci, san, name: opening?.name || 'Opening development', eco: opening?.eco || null, lineCount };
    });
  } catch { return []; }
}

const plans = (description, whitePlan, blackPlan, watchFor) => ({ description, whitePlan, blackPlan, watchFor });

/** Original instructional notes; recognition and move lines come from the CC0 data. */
export function getOpeningDetails(opening) {
  const name = opening?.name || '';
  if (/King's Gambit.*Falkbeer/i.test(name)) return plans(
    'The Falkbeer Countergambit answers the f-pawn offer with a central pawn challenge, often followed by ...e4.',
    'Finish development and deal with pressure in the center before beginning a kingside attack.',
    'Use central space and rapid development to create threats while White’s king is still unsettled.',
    'Capturing another pawn can lose time. Check the e-file, central pawn breaks, and king safety.');
  if (/King's Gambit Accepted.*Muzio/i.test(name)) return plans(
    'The Muzio Gambit offers a knight for rapid development and attacking chances after Black advances the kingside pawns.',
    'Bring the queen and remaining pieces toward the exposed king and keep the initiative.',
    'Return material if necessary to complete development and neutralize the attack.',
    'This is a concrete piece sacrifice. A familiar opening name does not replace calculation.');
  if (/King's Gambit Accepted.*Kieseritzky/i.test(name)) return plans(
    'The Kieseritzky Gambit features h4 against Black’s ...g5 pawn chain and a knight advance to e5 in its defining line.',
    'Challenge the kingside pawn chain while developing pieces with threats.',
    'Keep the center under control and complete development while defending the extra pawn selectively.',
    'The advanced pawns gain space but create targets. Check forcing moves before moving more pawns.');
  if (/King's Gambit Accepted.*Bishop/i.test(name)) return plans(
    'The Bishop’s Gambit develops Bc4 before Nf3, placing pressure on f7 while leaving the h4–e1 diagonal open.',
    'Develop quickly and prepare a safe response if Black checks with ...Qh4+.',
    'Use development and central counterplay; consider ...Qh4+ only after checking White’s reply.',
    'White may need to move the king. Evaluate the resulting activity rather than assuming castling remains available.');
  if (/^King's Gambit Accepted/i.test(name)) return plans(
    'Black has accepted the f-pawn. White seeks central control, development, and use of the open f-file as compensation.',
    'Develop with moves such as Nf3 and Bc4, prepare d4, and arrange king safety before attacking.',
    'Develop and challenge the center. Keeping the extra pawn is useful only if it does not cost too much time.',
    'The h4–e1 diagonal and pressure on f7 make move order important. Book status does not guarantee equality.');
  if (/^King's Gambit Declined/i.test(name)) return plans(
    'Black declines the f-pawn offer. The variation name describes Black’s chosen developing move or countergambit.',
    'Develop the kingside pieces and build a center, often using c3 and d4 when the position allows.',
    'Develop actively and contest the center instead of spending moves on White’s pawn offer.',
    'In the Classical Variation, ...Bc5 points at f2. Check that square before opening the center.');
  if (/^King's Gambit$/i.test(name)) return plans(
    'After 1.e4 e5 2.f4, White offers the f-pawn to challenge e5 and create attacking chances. This is the King’s Gambit.',
    'Develop quickly, aim for a strong center with d4, and organize king safety before using the f-file.',
    'Choose whether to accept with ...exf4, develop while declining, or counter in the center with ...d5.',
    'Moving the f-pawn weakens White’s king. A book move can still receive a less favorable engine evaluation.');
  if (/Sicilian/i.test(name)) return plans(
    'Black’s ...c5 challenges the center asymmetrically. The named variation identifies the resulting pawn structure and development scheme.',
    'Develop actively and choose pawn breaks that match the variation; in Open Sicilians, d4 opens the center.',
    'Use central and queenside counterplay while completing development.',
    'Opposite-side attacks can make tempo crucial. Check tactical threats before starting another pawn advance.');
  if (/French/i.test(name)) return plans(
    'The French Defense builds on ...e6 and ...d5. Its central pawn chains determine the plans for both sides.',
    'Develop around the central pawns and support the center before committing to a kingside attack.',
    'Challenge White’s center with timely ...c5 or ...f6 and find an active role for the light-squared bishop.',
    'Pawn breaks can leave the center or a king exposed. Calculate captures before releasing the tension.');
  if (/Caro-Kann/i.test(name)) return plans(
    'The Caro-Kann prepares ...d5 with ...c6 and aims for a sound central structure.',
    'Use the space available to develop actively and choose how to resolve the central tension.',
    'Develop the pieces around the pawn structure and seek a timely central break.',
    'The advance and exchange structures require different plans; use the matched variation as your guide.');
  if (/Ruy Lopez|Spanish/i.test(name)) return plans(
    'The Ruy Lopez develops Bb5 and adds pressure to Black’s e5 center through the knight on c6.',
    'Complete development, safeguard e4, and prepare a well-timed d4 break.',
    'Secure the e5 center and develop actively before committing to queenside expansion.',
    'Capturing the c6 knight does not automatically win e5. Check the tactical reply and pawn structure.');
  if (/Italian|Giuoco|Two Knights/i.test(name)) return plans(
    'These open-game lines develop Bc4 toward f7 and often build around central pawn breaks.',
    'Finish development and decide whether to open the center quickly or prepare c3 and d4.',
    'Develop actively, protect the center, and look for a timely ...d5 break.',
    'Pressure on f7 creates tactics, but an attack without enough developed pieces can run out of force.');
  if (/Queen's Gambit|Slav|Semi-Slav/i.test(name)) return plans(
    'White’s c4 pawn challenges Black’s d5 center. The way Black maintains or releases that tension defines the variation.',
    'Develop naturally and use the central tension to create an active pawn break or favorable structure.',
    'Complete development and prepare a freeing ...c5 or ...e5 break when it is tactically sound.',
    'Holding an extra c-pawn can delay development. Compare activity and structure before protecting it.');
  if (/King's Indian|Modern Defense|Pirc/i.test(name)) return plans(
    'Black allows White central space while preparing counterplay with developed pieces and pawn breaks.',
    'Support the center and develop before using the space advantage to attack.',
    'Finish kingside development and challenge the center with a well-timed pawn break.',
    'Space alone does not decide the position; the timing of ...e5 or ...c5 is often critical.');
  if (/Nimzo-Indian|Queen's Indian|Bogo-Indian/i.test(name)) return plans(
    'Black develops pieces to influence White’s center, often using a pin or control of central dark squares.',
    'Complete development and decide which pawn structure or bishop pair tradeoffs suit the position.',
    'Maintain pressure on the center and coordinate a central pawn break.',
    'Trading a bishop for a knight changes the long-term structure; inspect the resulting pawns before exchanging.');
  if (/English|Réti|Reti|Zukertort/i.test(name)) return plans(
    'This flexible flank opening controls central squares with pieces and pawns before fixing the full central structure.',
    'Develop smoothly and choose between d4, e4, or continued flank play as Black reveals the setup.',
    'Occupy or control central squares and develop without assuming a single fixed move order.',
    'Transpositions are common. The current board position, rather than the first move alone, determines the opening name.');
  if (/Scandinavian/i.test(name)) return plans(
    'The Scandinavian immediately challenges e4 with ...d5 and often involves early queen development.',
    'Develop with useful attacks on the queen while maintaining control of the center.',
    'Choose safe queen squares and complete minor-piece development efficiently.',
    'Queen moves should have a purpose; repeated queen retreats can surrender valuable development time.');
  if (/Scotch/i.test(name)) return plans(
    'The Scotch opens the center early with d4, giving both sides direct development and tactical possibilities.',
    'Use the open center to develop actively and avoid letting an advanced piece become a target.',
    'Develop with threats and challenge White’s central pieces.',
    'Central exchanges can expose checks and pins. Calculate the immediate forcing moves.');
  return plans(
    opening ? `This position is associated with ${opening.name} in the offline opening database.` : 'No named opening is recognized in this position.',
    'Develop the remaining pieces, support the center, and put the king in safety.',
    'Contest the center, complete development, and coordinate the pieces before launching an attack.',
    'Opening names describe known theory, not an engine verdict. Check threats and the local evaluation before choosing a move.');
}
