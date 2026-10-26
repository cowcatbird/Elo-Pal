import { Chess } from '../vendor/chess.js';

const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const CENTER = ['d4', 'e4', 'd5', 'e5'];
const EMPTY = () => ({ reason: '', plan: '', line: '' });
const side = color => color === 'w' ? 'White' : 'Black';
const other = color => color === 'w' ? 'b' : 'w';
const coordinates = move => ({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });

function position(fen) {
  if (typeof fen !== 'string' || fen.length > 200) return null;
  try { return new Chess(fen); } catch { return null; }
}

function signature(fen) {
  return position(fen)?.fen().split(' ').slice(0, 4).join(' ') || '';
}

function pieces(board) {
  return board.board().flat().filter(Boolean);
}

function numbered(move) {
  return `${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '...'} ${move.san}`;
}

function material(board) {
  return pieces(board).reduce((sum, piece) => sum + (piece.color === 'w' ? 1 : -1) * VALUES[piece.type], 0);
}

function limit(text, length) {
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

function verifiedLastMove(board, move) {
  if (!move || !position(move.before)) return null;
  if (move.after != null && signature(move.after) !== signature(board.fen())) return null;
  try {
    const previous = new Chess(move.before);
    const played = previous.move(coordinates(move));
    return signature(previous.fen()) === signature(board.fen()) ? played : null;
  } catch { return null; }
}

/** Only the legal prefix is usable. Neither SAN nor evaluation metadata is trusted. */
function engineLine(board, analysis) {
  if (!analysis || typeof analysis !== 'object') return [];
  if (analysis.fen != null && signature(analysis.fen) !== signature(board.fen())) return [];
  const source = analysis.pv;
  const tokens = typeof source === 'string' && source.length <= 4096 ? source.trim().split(/\s+/)
    : Array.isArray(source) ? source : [];
  const replay = new Chess(board.fen());
  const moves = [];
  for (const token of tokens.slice(0, 6)) {
    if (typeof token !== 'string' || !UCI.test(token) || replay.isGameOver()) break;
    try {
      moves.push(replay.move({ from: token.slice(0, 2), to: token.slice(2, 4), promotion: token[4] }));
    } catch { break; }
  }
  return moves;
}

function notation(moves) {
  let result = '';
  for (const [index, move] of moves.entries()) {
    const token = move.color === 'w' || index === 0 ? numbered(move) : move.san;
    const next = `${result}${result ? ' ' : ''}${token}`;
    if (next.length > 140) break;
    result = next;
  }
  return result;
}

function simpleRecaptures(move) {
  const after = position(move.after);
  if (!after) return [];
  return after.moves({ verbose: true }).filter(reply => reply.captured && reply.to === move.to);
}

function kingSquare(board, color) {
  return pieces(board).find(piece => piece.type === 'k' && piece.color === color)?.square;
}

function kingPin(board, attacker) {
  if (!attacker || !['b', 'r', 'q'].includes(attacker.type)) return '';
  const king = kingSquare(board, other(attacker.color));
  if (!king) return '';
  const file = square => square.charCodeAt(0) - 97;
  const rank = square => Number(square[1]) - 1;
  const dx = file(king) - file(attacker.square), dy = rank(king) - rank(attacker.square);
  const diagonal = Math.abs(dx) === Math.abs(dy);
  const straight = dx === 0 || dy === 0;
  if ((!diagonal && !straight) || (attacker.type === 'b' && !diagonal) || (attacker.type === 'r' && !straight)) return '';
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const between = [];
  for (let x = file(attacker.square) + sx, y = rank(attacker.square) + sy; x !== file(king) || y !== rank(king); x += sx, y += sy) {
    const square = `${String.fromCharCode(97 + x)}${y + 1}`;
    const found = board.get(square);
    if (found) between.push({ ...found, square });
  }
  if (between.length !== 1 || between[0].color === attacker.color) return '';
  const pinned = between[0];
  return `The ${NAMES[attacker.type]} on ${attacker.square} pins the ${NAMES[pinned.type]} on ${pinned.square} to the king on ${king}. That piece cannot leave the line if doing so exposes its king.`;
}

/** Geometric attacks alone are not enough: pinned-piece captures are excluded. */
function attackedTargets(board, attacker) {
  if (!attacker) return [];
  const fields = board.fen().split(' ');
  fields[1] = attacker.color;
  fields[3] = '-';
  const hypothetical = position(fields.join(' '));
  if (!hypothetical) return [];
  const captures = hypothetical.moves({ square: attacker.square, verbose: true }).filter(move => move.captured);
  return pieces(board).filter(target => {
    if (target.color === attacker.color || (target.type !== 'k' && VALUES[target.type] < 3)) return false;
    if (target.type === 'k') return board.turn() !== attacker.color && board.isCheck() && board.attackers(target.square, attacker.color).includes(attacker.square);
    return captures.some(capture => capture.to === target.square);
  }).sort((a, b) => (b.type === 'k' ? 100 : VALUES[b.type]) - (a.type === 'k' ? 100 : VALUES[a.type]));
}

function passedPawn(board, square) {
  const pawn = board.get(square);
  if (!pawn || pawn.type !== 'p') return false;
  return !pieces(board).some(piece => piece.type === 'p' && piece.color !== pawn.color
    && Math.abs(piece.square.charCodeAt(0) - square.charCodeAt(0)) <= 1
    && (Number(piece.square[1]) - Number(square[1])) * (pawn.color === 'w' ? 1 : -1) > 0);
}

function centerAttacks(board, color, square) {
  return CENTER.filter(target => board.attackers(target, color).includes(square));
}

function moveIdea(move) {
  const after = position(move.after);
  if (!after) return '';
  const piece = { ...after.get(move.to), square: move.to };
  if (after.isCheckmate()) return `${move.san} delivers checkmate: ${side(other(move.color))} has no legal answer to the check.`;
  const pin = kingPin(after, piece);
  const targets = attackedTargets(after, piece);
  if (targets.length > 1) {
    const names = targets.slice(0, 2).map(target => `the ${NAMES[target.type]} on ${target.square}`);
    return `${move.san} attacks ${names.join(' and ')} at once. This double attack still needs to survive the opponent’s reply.`;
  }
  if (pin) return pin;
  if (move.promotion) return `${move.san} turns the pawn into a ${NAMES[move.promotion]}${after.isCheck() ? ' with check' : ''}. Account for any immediate capture of the promoted piece.`;
  if (move.captured) {
    const replies = simpleRecaptures(move);
    const target = move.flags.includes('e') ? `${move.to[0]}${move.from[1]}` : move.to;
    const fact = `${move.san} takes the ${NAMES[move.captured]} on ${target}${move.flags.includes('e') ? ' en passant' : ''}`;
    if (replies.length) return `${fact}, but ${side(other(move.color))} can recapture with ${replies.slice(0, 2).map(reply => reply.san).join(' or ')}. Count the exchange before committing.`;
    return `${fact}. There is no immediate legal recapture on ${move.to}; check the opponent’s counterplay before treating it as a lasting material gain.`;
  }
  if (after.isCheck()) return `${move.san} gives check, so ${side(other(move.color))} must answer the king attack before carrying out another plan.`;
  const home = move.color === 'w' ? '1' : '8';
  if (['n', 'b'].includes(move.piece) && [`b${home}`, `c${home}`, `f${home}`, `g${home}`].includes(move.from) && move.to[1] !== home) {
    const centers = centerAttacks(after, move.color, move.to);
    return `${move.san} develops the ${NAMES[move.piece]} from ${move.from}${centers.length ? ` and adds its attack on ${centers.join(' and ')}` : ` to ${move.to}`}.`;
  }
  if (move.piece === 'r' && !pieces(after).some(found => found.type === 'p' && found.square[0] === move.to[0])) {
    return `${move.san} puts the rook on the open ${move.to[0]}-file: neither side has a pawn on that file. Look for an entry square before exchanging the rook.`;
  }
  if (move.piece === 'p' && passedPawn(after, move.to)) {
    const ahead = `${move.to[0]}${Number(move.to[1]) + (move.color === 'w' ? 1 : -1)}`;
    const blocker = /^[a-h][1-8]$/.test(ahead) ? after.get(ahead) : null;
    return `The pawn on ${move.to} is passed: no enemy pawn is ahead on its file or a neighboring file.${blocker ? ` The ${NAMES[blocker.type]} on ${ahead} blocks its next push.` : ' Coordinate support before advancing it further.'}`;
  }
  if (move.piece === 'p' && CENTER.includes(move.to)) {
    const centers = centerAttacks(after, move.color, move.to);
    return `${move.san} stakes out ${move.to}${centers.length ? ` and attacks ${centers.join(' and ')}` : ''}. That central pawn can become a target, so compare the opponent’s pawn breaks.`;
  }
  if (targets.length) return `${move.san} attacks the ${NAMES[targets[0].type]} on ${targets[0].square}. ${side(other(move.color))} can still move it, defend it, or create a stronger threat.`;
  if (move.flags.includes('k') || move.flags.includes('q')) {
    const rookSquare = `${move.flags.includes('k') ? 'f' : 'd'}${home}`;
    return `${move.san} brings the rook to ${rookSquare}. Examine open lines near the king on ${move.to}; castling alone does not establish king safety.`;
  }
  const centers = centerAttacks(after, move.color, move.to);
  if (centers.length && ['n', 'b'].includes(move.piece)) return `${move.san} places the ${NAMES[move.piece]} on ${move.to}, where it attacks ${centers.join(' and ')}. Compare whether the opponent can challenge that post.`;
  return '';
}

function checkingIdea(move, another = false) {
  const check = another ? 'another check' : 'check';
  const home = move.color === 'w' ? '1' : '8';
  if (move.flags.includes('k') || move.flags.includes('q')) {
    return `${move.san} activates ${side(move.color)}’s rook on ${move.flags.includes('k') ? 'f' : 'd'}${home} with ${check}`;
  }
  if (move.captured) return `${move.san} takes the ${NAMES[move.captured]} with ${check}`;
  if (['n', 'b'].includes(move.piece) && move.from[1] === home && move.to[1] !== home) {
    return `${move.san} develops the ${NAMES[move.piece]} from ${move.from} with ${check}`;
  }
  return `${move.san} gives ${check}`;
}

/** Prefer a verifiable tempo or forcing move over counting a single pawn. */
function forcingLineIdea(moves) {
  const checkingIndex = moves.slice(0, 3).findIndex(move => move.san.endsWith('+'));
  if (checkingIndex !== -1) {
    const first = moves[checkingIndex];
    const nextIndex = moves.findIndex((move, index) => index > checkingIndex && index <= checkingIndex + 2
      && move.color === first.color && move.san.endsWith('+'));
    const prefix = checkingIndex > 0 ? `after ${moves[checkingIndex - 1].san}, ` : '';
    if (nextIndex !== -1) {
      return `In the engine continuation, ${prefix}${checkingIdea(first)}. After ${moves[nextIndex - 1].san}, ${checkingIdea(moves[nextIndex], true)}. ${side(other(first.color))} must answer both checks.`;
    }
    const reply = moves[checkingIndex + 1];
    return `In the engine continuation, ${prefix}${checkingIdea(first)}. ${side(other(first.color))} must address the king attack${reply ? `; the line answers with ${reply.san}` : ' before pursuing another plan'}.`;
  }
  for (const [index, move] of moves.slice(0, 3).entries()) {
    const home = move.color === 'w' ? '1' : '8';
    if (!['n', 'b'].includes(move.piece) || move.from[1] !== home || move.to[1] === home) continue;
    const after = position(move.after);
    if (!after) continue;
    const target = attackedTargets(after, { ...after.get(move.to), square: move.to }).find(piece => ['q', 'r'].includes(piece.type));
    if (!target) continue;
    const prefix = index > 0 ? `after ${moves[index - 1].san}, ` : '';
    const reply = moves[index + 1];
    const response = reply?.from === target.square ? ` ${reply.san} responds by moving that ${NAMES[target.type]}.` : '';
    return `In the engine continuation, ${prefix}${move.san} develops ${side(move.color)}’s ${NAMES[move.piece]} and attacks the ${NAMES[target.type]} on ${target.square} at once.${response}`;
  }
  return '';
}

function lineReason(board, moves) {
  if (!moves.length) return '';
  const last = moves.at(-1), end = position(last.after);
  if (end?.isCheckmate()) return `The engine continuation ends with ${side(last.color)}’s ${numbered(last)}, delivering checkmate. Replay the intervening replies to see how the king runs out of escapes.`;
  const delta = end ? material(end) - material(board) : 0;
  const captures = moves.filter(move => move.captured);
  const forcing = forcingLineIdea(moves);
  if (forcing) {
    const accounting = delta ? ` Over these ${moves.length} plies, material shifts ${Math.abs(delta)} pawn${Math.abs(delta) === 1 ? '' : 's'} toward ${side(delta > 0 ? 'w' : 'b')}.`
      : captures.length >= 2 ? ` The line includes ${captures[0].san} and ${captures[1].san} and leaves the material balance unchanged.` : '';
    // Reserve room for accounting rather than silently clipping its conclusion.
    return `${limit(forcing, 300 - accounting.length)}${accounting}`;
  }
  if (delta !== 0 && (captures.length || moves.some(move => move.promotion))) {
    const gaining = delta > 0 ? 'w' : 'b';
    const capture = captures.filter(move => move.color === gaining).sort((a, b) => VALUES[b.captured] - VALUES[a.captured])[0];
    const example = capture ? `In the engine continuation, ${side(capture.color)}’s ${capture.san} takes the ${NAMES[capture.captured]}. ` : '';
    return `${example}Across this ${moves.length}-ply engine line, the material balance shifts about ${Math.abs(delta)} pawn${Math.abs(delta) === 1 ? '' : 's'} toward ${side(gaining)}.`;
  }
  if (captures.length >= 2 && captures[1].to === captures[0].to && captures[0].color !== captures[1].color) {
    return `The engine line includes ${side(captures[0].color)}’s ${captures[0].san} and ${side(captures[1].color)}’s ${captures[1].san}. The ${moves.length}-ply line leaves the material balance unchanged; the capture is part of an exchange, not a free piece.`;
  }
  const firstIdea = moveIdea(moves[0]);
  if (firstIdea) return `In the engine continuation, ${firstIdea}`;
  if (moves[1]) {
    const replyIdea = moveIdea(moves[1]);
    if (replyIdea) return `In the engine continuation after ${side(moves[0].color)}’s ${moves[0].san}, ${side(moves[1].color)}’s reply matters: ${replyIdea}`;
  }
  return '';
}

function loosePiece(board, legal) {
  const candidates = legal.filter(move => move.captured && VALUES[move.captured] >= 3)
    .sort((a, b) => VALUES[b.captured] - VALUES[a.captured]);
  for (const move of candidates.slice(0, 12)) {
    if (simpleRecaptures(move).length === 0) return {
      move,
      reason: `${side(board.turn())} can capture the ${NAMES[move.captured]} on ${move.to} with ${move.san}, with no immediate legal recapture on ${move.to}. This is a concrete threat to examine, not proof of a forced win.`,
    };
  }
  return null;
}

function candidateScore(move) {
  if (move.san.endsWith('#')) return 1000;
  if (move.promotion) return 150;
  if (move.captured) return 80 + VALUES[move.captured] * 4 - VALUES[move.piece];
  if (move.san.endsWith('+')) return 60;
  const home = move.color === 'w' ? '1' : '8';
  if (['n', 'b'].includes(move.piece) && move.from[1] === home && move.to[1] !== home) {
    const board = position(move.after);
    return 50 + (board ? centerAttacks(board, move.color, move.to).length * 5 : 0);
  }
  if (move.piece === 'p' && CENTER.includes(move.to)) return 45;
  if (move.flags.includes('k') || move.flags.includes('q')) return 35;
  return 0;
}

function strategicCandidate(board, legal) {
  const ordered = [...legal].sort((a, b) => candidateScore(b) - candidateScore(a));
  for (const move of ordered.slice(0, 32)) {
    const idea = moveIdea(move);
    if (idea) return { move, idea };
  }
  return ordered[0] ? { move: ordered[0], idea: '' } : null;
}

/**
 * Position-specific coaching from the current board and a legal engine PV.
 * No future moves from the played game, network service, or invented SAN.
 */
export function getPositionAdvice(input = {}) {
  try {
    const { fen, move = null, analysis = null } = input && typeof input === 'object' ? input : {};
    const board = position(fen);
    if (!board) return EMPTY();
    const legal = board.moves({ verbose: true });
    if (!legal.length) return {
      reason: board.isCheckmate() ? `${side(board.turn())} is checkmated: there is no legal escape from check.` : `${side(board.turn())} has no legal move, but is not in check: this is stalemate.`,
      plan: '', line: '',
    };
    const played = verifiedLastMove(board, move);
    const pv = engineLine(board, analysis);
    const mate = legal.find(candidate => candidate.san.endsWith('#'));
    const loose = loosePiece(board, legal);
    let reason = '';
    let plan = '';
    if (board.isCheck()) {
      const options = legal.slice(0, 3).map(candidate => candidate.san).join(', ');
      const attacker = played ? { ...board.get(played.to), square: played.to } : null;
      const targets = attackedTargets(board, attacker);
      if (played && targets.length > 1) {
        const names = targets.slice(0, 2).map(target => `the ${NAMES[target.type]} on ${target.square}`);
        reason = `${played.san} attacks ${names.join(' and ')} at once. ${side(board.turn())} must answer check${legal.length === 1 ? ` with ${legal[0].san}, the only legal reply` : `; legal replies include ${options}`}. The fork still needs to survive that reply.`;
      } else {
        reason = `${side(board.turn())} is in check. ${legal.length === 1 ? `${legal[0].san} is the only legal reply.` : `Legal escapes include ${options}. Respond to the check before pursuing a material or positional idea.`}`;
      }
    } else if (mate) {
      reason = `${side(board.turn())} has mate in one with ${mate.san}: the resulting check leaves the king no legal escape.`;
    } else {
      reason = lineReason(board, pv) || loose?.reason || (played ? moveIdea(played) : '');
    }
    if (pv.length) {
      plan = `${side(board.turn())} to move: Stockfish’s continuation starts ${numbered(pv[0])}${pv[1] ? `, then ${side(pv[1].color)}’s ${numbered(pv[1])}` : ''}.`;
      if (!reason) {
        const balance = material(board);
        reason = balance ? `${side(balance > 0 ? 'w' : 'b')} has about ${Math.abs(balance)} pawn${Math.abs(balance) === 1 ? '' : 's'} more material. The engine continuation shows how ${side(board.turn())} can proceed; activity and king threats still affect the evaluation.`
          : `Material is balanced. Compare ${pv[0].san}${pv[1] ? ` with the reply ${pv[1].san}` : ''} by following the engine continuation and checking which pieces change their activity.`;
      }
    } else {
      const candidate = mate ? { move: mate, idea: moveIdea(mate) } : loose ? { move: loose.move, idea: loose.reason } : strategicCandidate(board, legal);
      if (candidate) {
        reason ||= candidate.idea ? `One idea for ${side(board.turn())}: ${candidate.idea}` : '';
        plan = `${side(board.turn())} to move: ${numbered(candidate.move)} ${mate ? 'delivers checkmate' : 'is a legal candidate to examine'}.`;
      }
      if (!reason) {
        const homes = pieces(board).filter(piece => piece.color === board.turn() && ['n', 'b'].includes(piece.type)
          && piece.square[1] === (piece.color === 'w' ? '1' : '8'));
        if (homes.length) reason = `${side(board.turn())} has ${homes.map(piece => `a ${NAMES[piece.type]} on ${piece.square}`).slice(0, 2).join(' and ')} on the back rank. Look for a legal route that brings these pieces into play.`;
      }
    }
    return { reason: limit(reason, 300), plan: limit(plan, 330), line: notation(pv) };
  } catch { return EMPTY(); }
}
