import { Chess } from '../vendor/chess.js';
import { normalizeOpening, scoreText } from './model.js';
import { getPositionAdvice } from './position-advice.js';

const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const sideName = color => color === 'w' ? 'White' : 'Black';
const other = color => color === 'w' ? 'b' : 'w';

function position(fen) {
  try { return typeof fen === 'string' ? new Chess(fen) : null; } catch { return null; }
}

function analysisFor(fen, analysis) {
  if (!analysis || typeof analysis !== 'object') return null;
  if (analysis.fen == null) return analysis;
  const expected = position(fen)?.fen().split(' ').slice(0, 4).join(' ');
  const source = position(analysis.fen)?.fen().split(' ').slice(0, 4).join(' ');
  return expected && source === expected ? analysis : null;
}

const join = (...parts) => parts.filter(part => typeof part === 'string' && part.trim()).join(' ');
const bounded = (text, max = 650) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
const adviceTip = (advice, fallback = '') => bounded(advice.line ? `Try this continuation: ${advice.line}` : advice.plan || fallback, 480);

// Move quality and the overall position are different: a best move may still
// leave its player losing. Do not explain an exact score using a bound or mate.
function outcomeContext(analysis, move, review) {
  if (!move || !['best', 'excellent', 'good'].includes(review?.key)
    || !Number.isFinite(analysis?.cp) || Number.isFinite(analysis?.mate)
    || analysis.lowerbound || analysis.upperbound
    || (analysis.bound != null && analysis.bound !== 'exact')) return '';
  const relative = analysis.cp * (move.color === 'w' ? 1 : -1);
  if (relative > -180) return '';
  return `${sideName(other(move.color))} still has ${relative <= -400 ? 'a large' : 'an'} advantage in this search. The move grade measures your choice, not who is ahead.`;
}

function bestAlternative(move, before) {
  const token = before?.pv?.[0];
  if (typeof token !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) return null;
  if (token === `${move.from}${move.to}${move.promotion || ''}`) return null;
  try {
    return new Chess(move.before).move({ from: token.slice(0, 2), to: token.slice(2, 4), promotion: token[4] })?.san || null;
  } catch { return null; }
}

/** Describe attacks, never infer a won piece from geometric attack maps alone. */
function doubleAttack(board, move) {
  if (!board || board.get(move.to)?.color !== move.color) return null;
  // Ask whether each non-king capture would be legal with the same board and
  // the mover to play. This excludes pinned pieces and illegal king captures.
  // The opponent still has a reply: this is an attack, not a promise of a win.
  const fields = board.fen().split(' ');
  fields[1] = move.color;
  fields[3] = '-';
  const hypothetical = position(fields.join(' '));
  if (!hypothetical) return null;
  let legal;
  try { legal = hypothetical.moves({ square: move.to, verbose: true }); } catch { return null; }
  const targets = [];
  for (const row of board.board()) for (const piece of row) {
    if (!piece || piece.color === move.color || VALUES[piece.type] < 3) continue;
    if (!board.attackers(piece.square, move.color).includes(move.to)) continue;
    if (piece.type === 'k') {
      if (board.isCheck()) targets.push({ piece: 'king', square: piece.square, king: true });
    } else if (legal.some(candidate => candidate.to === piece.square && candidate.captured)) {
      targets.push({ piece: NAMES[piece.type], square: piece.square, king: false });
    }
  }
  if (targets.length < 2) return null;
  targets.sort((a, b) => Number(b.king) - Number(a.king));
  const describe = target => target.king ? `${sideName(other(move.color))}’s king` : `the ${target.piece} on ${target.square}`;
  return `${move.san} attacks ${describe(targets[0])} and ${describe(targets[1])} at the same time.`;
}

function moveFact(board, move, previous) {
  const side = sideName(move.color), opponent = sideName(other(move.color));
  if (move.flags?.includes('k') || move.flags?.includes('q')) {
    const rank = move.color === 'w' ? '1' : '8';
    return `${move.san} brings ${side}’s king to ${move.to} and the rook to ${move.flags.includes('k') ? 'f' : 'd'}${rank}.`;
  }
  const fork = doubleAttack(board, move);
  if (fork) return fork;
  if (move.promotion) return `${move.san} promotes ${side}’s pawn to a ${NAMES[move.promotion]}${board?.isCheck() ? ' with check' : ''}.`;
  if (move.captured) {
    if (move.flags?.includes('e')) return `${move.san} captures the pawn on ${move.to[0]}${move.from[1]} en passant.`;
    const verb = previous?.captured && previous.to === move.to ? 'recaptures' : 'captures';
    return `${move.san} ${verb} ${opponent}’s ${NAMES[move.captured]} on ${move.to}${board?.isCheck() ? ' and gives check' : ''}.`;
  }
  if (board?.isCheck()) return `${move.san} puts ${opponent}’s king in check. ${opponent} must answer the check.`;
  const home = move.color === 'w' ? '1' : '8';
  if (['n', 'b'].includes(move.piece) && move.from[1] === home && move.to[1] !== home) {
    return `${move.san} develops ${side}’s ${NAMES[move.piece]} from ${move.from} to ${move.to}.`;
  }
  if (move.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(move.to)) return `${move.san} places ${side}’s pawn in the center.`;
  return `${move.san} moves ${side}’s ${NAMES[move.piece] || 'piece'} from ${move.from} to ${move.to}.`;
}

function evaluationLoss(before, after, color) {
  if (!Number.isFinite(before?.cp) || !Number.isFinite(after?.cp)
    || Number.isFinite(before?.mate) || Number.isFinite(after?.mate)
    || before?.lowerbound || before?.upperbound || after?.lowerbound || after?.upperbound
    || (before?.bound != null && before.bound !== 'exact')
    || (after?.bound != null && after.bound !== 'exact')) return null;
  const loss = Math.max(0, (before.cp - after.cp) * (color === 'w' ? 1 : -1));
  return loss >= 20 ? (loss / 100).toFixed(1) : null;
}

function positionEstimate(after) {
  if (Number.isFinite(after?.mate) && after.mate !== 0) {
    return `Stockfish reports mate in ${Math.abs(after.mate)} for ${after.mate > 0 ? 'White' : 'Black'}.`;
  }
  if (Number.isFinite(after?.cp)) {
    if (Math.abs(after.cp) <= 30) return 'Stockfish still sees a roughly balanced position.';
    return `Stockfish still favors ${after.cp > 0 ? 'White' : 'Black'}.`;
  }
  return 'The local review rates this material offer favorably.';
}

function playedLine(game, index) {
  const moves = game.moves.slice(Math.max(0, index - 8), index);
  return moves.map((move, offset) => {
    const number = move.before.split(' ')[5];
    return `${move.color === 'w' ? `${number}. ` : offset === 0 ? `${number}... ` : ''}${move.san}`;
  }).join(' ').slice(0, 240);
}

function openingMessage(book, game, index, move, board, fact) {
  const branch = book.variation && !book.name.toLowerCase().includes(book.variation.toLowerCase())
    ? `: ${book.variation}` : '';
  const name = `${book.name}${branch}${book.eco ? ` (${book.eco})` : ''}`;
  const prefix = game.moves.slice(0, 3).map((played) => `${played.from}${played.to}`).join(' ');
  const kingsGambit = /king[’']?s gambit/i.test(`${book.name} ${book.family}`)
    && game.startFen === new Chess().fen() && index >= 3 && prefix === 'e2e4 e7e5 f2f4';
  let explanation = book.details.description;
  if (kingsGambit && index === 3 && board?.moves({ verbose: true }).some((reply) => reply.from === 'e5' && reply.to === 'f4')) {
    explanation = 'White offers the f-pawn to draw Black’s e-pawn away from the center and seek active piece play. Black can accept with exf4 or decline the gambit.';
  } else if (kingsGambit && index === 4 && move.from === 'e5' && move.to === 'f4' && move.captured === 'p') {
    explanation = 'Black accepts the gambit and takes White’s f-pawn. White now seeks active development in return for the pawn.';
  }
  return {
    title: `${move.san} is a book move`,
    text: `${name}. ${fact}${explanation ? ` ${explanation}` : ''} This is recognized opening theory; the engine’s numerical evaluation is separate.`,
    tip: `${book.details.watchFor ? `${book.details.watchFor} ` : ''}Your line: ${playedLine(game, index)}`,
    mood: 'friendly',
  };
}

function greatMessage(review, move, before, fact) {
  const great = review.great;
  if (!great || !Number.isFinite(great.gap) || great.gap < 200) return null;
  const token = great.alternative?.uci;
  if (typeof token !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)
    || token === `${move.from}${move.to}${move.promotion || ''}`) return null;
  let alternative;
  try {
    alternative = new Chess(move.before).move({ from: token.slice(0, 2), to: token.slice(2, 4), promotion: token[4] });
  } catch { return null; }
  if (!alternative || !['only-winning-move', 'only-nonlosing-move'].includes(great.reason)) return null;
  const outcome = great.reason === 'only-winning-move' ? 'keeps a clear advantage' : 'avoids a clear disadvantage';
  const score = scoreText(great.alternative);
  const gap = !Number.isFinite(before?.mate) && !Number.isFinite(great.alternative.mate)
    ? `, about ${(great.gap / 100).toFixed(1)} pawns worse for ${sideName(move.color)}` : '';
  return {
    title: `${move.san} is a great move`,
    text: `${fact} At this search depth, it ${outcome}. The next-best engine candidate is ${alternative.san}${score !== '—' ? ` (${score} from White’s perspective)` : ''}${gap}. Great is a conservative local review label.`,
    tip: `Replay ${alternative.san} from the previous position and compare the replies. The two engine lines explain why this move matters.`,
    mood: 'celebrate',
  };
}

/** Local, deterministic commentary: board facts plus qualified engine estimates. */
export function getCoachMessage({ game, ply = 0, review, before, after, opening, variation = false, positionFen, positionAnalysis } = {}) {
  const book = normalizeOpening(opening ?? review?.opening);
  const index = Math.max(0, Math.min(game?.moves?.length || 0, Math.floor(Number(ply) || 0)));
  const move = variation ? null : game?.moves?.[index - 1];
  // Variations must never borrow facts or scores from the selected game move.
  const fen = variation ? positionFen : move?.after || game?.positions?.[index] || game?.startFen;
  const board = position(fen);
  before = analysisFor(move?.before, before);
  after = variation ? null : analysisFor(fen, after);
  const analysis = analysisFor(fen, positionAnalysis ?? after);
  if (board?.isCheckmate()) return {
    title: 'Checkmate. A complete finish.',
    text: `${move ? `${move.san} ends the game. ` : ''}${sideName(other(board.turn()))} wins: the king is in check and there is no legal escape.`,
    tip: 'Look back one move to see how the mating net came together.', mood: 'celebrate',
  };
  if (board?.isStalemate()) return {
    title: 'No moves, but no check.',
    text: `This is stalemate. ${sideName(board.turn())} has no legal move, but the king is not in check, so the game is drawn.`,
    tip: 'When ahead, leave your opponent a legal move unless you are delivering mate.', mood: 'thinking',
  };
  if (board?.isInsufficientMaterial()) return {
    title: 'This position is a draw.',
    text: 'There is insufficient material for either side to deliver checkmate.', mood: 'friendly',
  };
  if (board?.isDrawByFiftyMoves()) return {
    title: 'The fifty-move limit is reached.',
    text: 'Neither side has moved a pawn or made a capture for at least fifty moves. This review treats the position as a draw.', mood: 'thinking',
  };
  if ((variation ? analysis : after)?.terminal === 'threefold repetition') return {
    title: 'The position has repeated.',
    text: 'The game history reaches the same position three times, so this review treats it as a draw by repetition.', mood: 'thinking',
  };
  const advice = getPositionAdvice({fen, move, analysis});
  if (variation) return {
    title: 'Let’s follow your idea.',
    text: bounded(join('You’re exploring a different continuation.', advice.reason,
      book ? `Opening reference: ${book.name}.` : '', 'This continuation has no game-review grade.')),
    tip: adviceTip(advice, 'Analyze this position to find a concrete continuation.'), mood: 'thinking',
  };
  if (!move) return {
    title: 'Hi, I’m Coach Cat.',
    text: bounded(join(game?.moves?.length ? 'Review the game for move grades, then choose a move to understand the idea.' : 'Let’s explore this position with the local engine.', advice.reason)),
    tip: adviceTip(advice, 'Import a game or analyze a position to get specific advice.'), mood: 'friendly',
  };

  const fact = moveFact(board, move, game.moves[index - 2]);
  const explanation = advice.reason || fact;
  if (book?.isBookMove) return openingMessage(book, game, index, move, board, fact);
  if (!review) return {
    title: `${move.san} · let’s take a look.`,
    text: bounded(join(explanation, book ? `The last recognized opening was ${book.name}. This move is not marked as a book move.` : '')),
    tip: bounded(join(adviceTip(advice), 'Run a game review for a move grade.'), 520), mood: 'thinking',
  };

  const sacrifice = review.sacrifice;
  if (review.key === 'brilliant' && sacrifice && board?.get(sacrifice.square)?.color === move.color
    && board.get(sacrifice.square).type === sacrifice.piece && NAMES[sacrifice.piece]) {
    let acceptance = null;
    try {
      const token = sacrifice.acceptance?.uci;
      if (typeof token === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) {
        acceptance = new Chess(board.fen()).move({ from: token.slice(0, 2), to: token.slice(2, 4), promotion: token[4] })?.san;
      }
    } catch { /* Invalid optional metadata should not produce a suggested move. */ }
    return {
      title: `${move.san} is a brilliant move`,
      text: bounded(join(`${move.san} offers the ${NAMES[sacrifice.piece]} on ${sacrifice.square}. ${positionEstimate(after)} This is a sound sacrifice by the local review’s estimate.`, advice.reason)),
      tip: bounded(join(acceptance ? `Try ${acceptance} to examine the compensation.` : '', adviceTip(advice)), 520),
      mood: 'celebrate',
    };
  }

  if (review.key === 'great') {
    const message = greatMessage(review, move, before, explanation);
    if (message) return {...message, text: bounded(message.text, 800), tip: bounded(join(message.tip, advice.line), 520)};
  }

  if (['inaccuracy', 'mistake', 'blunder'].includes(review.key)) {
    const alternative = bestAlternative(move, before);
    const loss = evaluationLoss(before, after, move.color);
    const better = alternative ? getPositionAdvice({fen:move.before, analysis:before}) : null;
    return {
      title: `${move.san} is ${review.key === 'inaccuracy' ? 'an' : 'a'} ${review.key}`,
      text: bounded(join(explanation, loss ? `Stockfish’s estimate worsens by about ${loss} pawns for ${sideName(move.color)} at this search depth.` : `The local review rates this as ${review.key === 'inaccuracy' ? 'an' : 'a'} ${review.key}.`, alternative ? `Stockfish preferred ${alternative}.` : '')),
      tip: alternative ? bounded(join(`Replay ${alternative} from the previous position.`, better.line || better.plan), 520) : adviceTip(advice, 'Analyze the previous position to compare the engine’s alternatives.'),
      mood: 'encourage',
    };
  }

  if (review.key === 'forced' && position(move.before)?.moves().length === 1) return {
    title: `${move.san} is forced`, text: `${move.san} was the only legal move in this position.`,
    tip: adviceTip(advice), mood: 'friendly',
  };
  return {
    title: review.key === 'best' ? `${move.san} is the best move`
      : review.key === 'excellent' ? `${move.san} is an excellent move`
        : review.key === 'good' ? `${move.san} is a good move` : `${move.san} · let’s understand this move.`,
    text: bounded(join(explanation, outcomeContext(analysis, move, review))),
    tip: adviceTip(advice, 'Analyze this position for a concrete continuation.'),
    mood: review.key === 'best' ? 'celebrate' : 'friendly',
  };
}
