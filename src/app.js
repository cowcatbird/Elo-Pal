import { Chess } from '../vendor/chess.js';
import { Engine } from './engine.js';
import { DEMO_PGN, parseGame, evaluateMove, summarizeReview, pvToSan, scoreText } from './model.js';
import { getCoachMessage } from './coach.js';
import { consumeImportSession } from './import-session.js';
import { buildOpeningTimeline, getOpeningForBoard, getOpeningDetails, getOpeningMoves } from './openings.js';
import { createMoveIcon } from './move-icons.js';
import { MoveSounds } from './move-sounds.js';
import { createLineSession } from './line-session.js';

const $ = id => document.getElementById(id);
const presets = { quick: { depth: 12, movetime: 350 }, balanced: { depth: 16, movetime: 1000 }, deep: { depth: 20, movetime: 2500 } };
const pieceNames = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
let engine = new Engine();
let ready = false, game, ply = 0, flipped = false, selected = null, variation = null;
let evaluations = [], reviews = [], positionAnalyses = [], currentLines = [], liveEvaluation = null;
let lastBarEvaluation = null;
let openingTimeline = [], variationOpening = null, openingContinuations = [];
let playbackTimer = null, explanationOpen = false;
let overviewVisible = false, lineSession = null, lineCursor = 0, lineTitle = 'Best line';
let reviewing = false, generation = 0, searchTimer, toastTimer, promotionMove;
const stored = readStorage();
const moveSounds = new MoveSounds({ enabled: stored.soundEnabled !== false });
$('depth-select').value = presets[stored.depth] ? stored.depth : 'balanced';
flipped = Boolean(stored.flipped);
renderSoundControl();

function readStorage() { try { const value = JSON.parse(localStorage.getItem('rook.workspace') || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } }
function save() {
  try { localStorage.setItem('rook.workspace', JSON.stringify({ pgn: game.pgn, depth: $('depth-select').value, flipped, soundEnabled: moveSounds.enabled })); }
  catch { toast('This game is open, but browser storage is full. Export it to keep a copy.'); }
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4000); }
function renderSoundControl() {
  $('sound-toggle').setAttribute('aria-pressed', String(moveSounds.enabled));
  $('sound-toggle').classList.toggle('toggled', moveSounds.enabled);
  $('sound-toggle').title = `${moveSounds.enabled ? 'Mute' : 'Enable'} move sounds (M)`;
}
function playMoveSound(move) {
  if (!moveSounds.enabled) return;
  void moveSounds.unlock();
  void moveSounds.play(move || { san: '' });
}
function uci(move) { return `${move.from}${move.to}${move.promotion || ''}`; }
function currentFen() { return variation?.fen() || game.positions[ply]; }
function currentOpening() { return variation ? variationOpening : openingTimeline[ply]; }
function reviewAt(index) {
  if (reviews[index]) return reviews[index];
  const opening = openingTimeline[index+1];
  return opening?.isBookMove ? {key:'book',label:'Book',opening} : null;
}
function updateVariationOpening() {
  if (!variation) { variationOpening = null; return; }
  const moves = variation.history({verbose:true});
  variationOpening = buildOpeningTimeline({startFen:game.startFen,moves,positions:[game.startFen,...moves.map(move=>move.after)]}).at(-1)
    || getOpeningForBoard(variation);
}
function stopPlayback() {
  clearInterval(playbackTimer); playbackTimer = null;
  if ($('play-button')) { $('play-button').textContent='▶'; $('play-button').setAttribute('aria-label','Play moves'); $('play-button').setAttribute('aria-pressed','false'); }
}
function boardAt(index) {
  const board = new Chess(game.startFen);
  for (const move of game.moves.slice(0, index)) board.move({ from: move.from, to: move.to, promotion: move.promotion });
  return board;
}
function terminalEvaluation(board) {
  if (board.isCheckmate()) return { cp: board.turn() === 'w' ? -10000 : 10000, mate: board.turn() === 'w' ? -0.0 : 0, terminal: 'checkmate', winner: board.turn() === 'w' ? 'Black' : 'White', depth: 0, pv: [] };
  if (board.isDraw()) return { cp: 0, mate: null, terminal: board.isStalemate() ? 'stalemate' : board.isThreefoldRepetition() ? 'threefold repetition' : board.isInsufficientMaterial() ? 'insufficient material' : 'draw', depth: 0, pv: [] };
  return null;
}
function displayScore(value) { return value?.terminal === 'checkmate' ? (value.winner === 'White' ? '1–0' : '0–1') : scoreText(value); }
function gameStatus() { return game.moves.length ? `${game.moves.length} half-moves · ${game.headers.Event || 'Imported game'}` : 'Position study · FEN'; }

function openGame(text, { demo = false } = {}) {
  const parsed = parseGame(text);
  if (parsed.moves.length > 1000) throw new Error('This game has more than 1,000 half-moves. Please import a shorter game.');
  stopWork();
  game = parsed; ply = 0; variation = null; selected = null; variationOpening = null; lineSession = null; lineCursor = 0; lastBarEvaluation = null;
  openingTimeline = buildOpeningTimeline(game);
  $('import-notice').hidden = true;
  for (const option of $('depth-select').options) {
    const preset = presets[option.value]; option.textContent = `${option.value[0].toUpperCase() + option.value.slice(1)} · ~${Math.ceil(game.positions.length * preset.movetime / 1000)} seconds`;
    Array.from($('overview-depth-select').options).find(item=>item.value === option.value).textContent = option.textContent;
  }
  evaluations = []; reviews = []; positionAnalyses = []; currentLines = []; liveEvaluation = null;
  $('game-type').textContent = demo || game.headers.Event === 'Opera Game' ? 'THE OPERA GAME · PARIS, 1858' : gameStatus().toUpperCase();
  $('game-result').textContent = (game.headers.Result || '*').replaceAll('-', '–');
  $('review-status').textContent = ready ? 'Free, private, and powered by Stockfish.' : 'Starting local engine…';
  $('review-intro').hidden = false; $('review-summary').hidden = true;
  $('review-progress').hidden = true;
  $('review-button').innerHTML = '<span>✦</span> Review game';
  $('review-button').disabled = !ready || !game.moves.length;
  if (!game.moves.length) { $('review-status').textContent = 'Position loaded. Open Analysis to explore it.'; setTab('analysis'); }
  else setTab('review');
  setOverview(Boolean(game.moves.length));
  render(); save();
  scheduleAnalysis();
}
function stopWork() { stopPlayback(); moveSounds.stop(); clearTimeout(searchTimer); generation++; engine.cancel(); reviewing = false; $('depth-select').disabled = false; $('analyze-button').disabled = !ready; $('engine-status').textContent = ready ? 'Stockfish · ready' : 'Loading Stockfish'; }
function stopReview() { stopWork(); $('review-button').innerHTML = '<span>✦</span> Review again'; $('review-status').textContent = `Paused · ${reviews.filter(Boolean).length} of ${game.moves.length} moves reviewed`; $('review-button').disabled = !ready || !game.moves.length; render(); }

function render() {
  renderBoard(); renderPlayers(); renderMoves(); renderEvaluation(); renderChart(); renderInsight(); renderSummary(); renderOpening(); renderOverview(); renderLine();
  $('move-counter').textContent = lineSession ? `Line · ${lineCursor} / ${lineSession.length}` : ply === 0 ? 'Starting position' : `${game.moves[ply - 1].san} · ${ply} / ${game.moves.length}`;
  $('first-button').disabled = $('prev-button').disabled = lineSession ? lineCursor === 0 : ply === 0 && !variation;
  $('last-button').disabled = $('next-button').disabled = lineSession ? lineCursor === lineSession.length : ply === game.moves.length && !variation;
  $('play-button').disabled = lineSession ? !lineSession.length : !game.moves.length;
  $('play-button').title = lineSession ? 'Play through this engine line' : 'Play through the game';
  $('variation-bar').hidden = !variation;
  $('variation-label').textContent = lineSession ? lineTitle : 'Exploring';
  if (variation) $('variation-moves').textContent = lineSession ? `${lineCursor} / ${lineSession.length} · ${lineSession.notationAt(lineCursor) || 'Starting position'}` : variation.history().slice(ply).join(' ');
}
function renderPlayers() {
  const summary = summarizeReview(game, reviews);
  for (const [place, color] of [['top', flipped ? 'white' : 'black'], ['bottom', flipped ? 'black' : 'white']]) {
    const name = color === 'white' ? 'White' : 'Black';
    $(place + '-player').textContent = game.headers[name] && game.headers[name] !== '?' ? game.headers[name] : name;
    $(place + '-detail').textContent = `${name} pieces${game.headers[name + 'Elo'] ? ' · ' + game.headers[name + 'Elo'] : ''}`;
    $(place + '-accuracy').textContent = summary[color].accuracy == null ? '—' : summary[color].accuracy.toFixed(1);
    $(place + '-accuracy').title = 'Custom accuracy estimate for reviewed moves';
    const avatar = $(place + '-player').closest('.player-row').querySelector('.avatar');
    avatar.className = `avatar ${color}-avatar`;
  }
}
function renderBoard() {
  const board = new Chess(currentFen());
  const legal = selected ? board.moves({ square: selected, verbose: true }).map(m => m.to) : [];
  const last = variation ? variation.history({ verbose: true }).at(-1) : game.moves[ply - 1];
  const lastReview = !variation && reviewAt(ply - 1);
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const file = flipped ? 7 - col : col, rank = flipped ? row + 1 : 8 - row;
    const square = `${'abcdefgh'[file]}${rank}`, piece = board.get(square);
    const button = document.createElement('button'); button.type = 'button';
    button.className = `square${(file + rank) % 2 !== 0 ? ' dark' : ''}${last && [last.from, last.to].includes(square) ? ' last' : ''}${selected === square ? ' selected' : ''}${legal.includes(square) ? ' legal' : ''}`;
    button.dataset.square = square;
    button.setAttribute('aria-label', `${square}${piece ? ` ${piece.color === 'w' ? 'White' : 'Black'} ${pieceNames[piece.type]}` : ' empty'}${legal.includes(square) ? ', legal destination' : ''}`);
    if (piece) { const img = document.createElement('img'); img.src = `assets/pieces/${piece.color}${piece.type}.svg`; img.alt = ''; img.draggable = false; button.append(img); }
    if (lastReview && last?.to === square && piece) {
      const badge = document.createElement('span');
      badge.className = `board-move-badge grade-${lastReview.key}`;
      badge.append(createMoveIcon(lastReview.key));
      badge.title = `${last.san}: ${lastReview.label}`;
      badge.setAttribute('aria-hidden','true');
      button.setAttribute('aria-label', `${button.getAttribute('aria-label')}, ${lastReview.label} move`);
      button.append(badge);
    }
    if (col === 0) { const span = document.createElement('span'); span.className = 'coord rank-coord'; span.textContent = rank; button.append(span); }
    if (row === 7) { const span = document.createElement('span'); span.className = 'coord file-coord'; span.textContent = 'abcdefgh'[file]; button.append(span); }
    fragment.append(button);
  }
  $('board').replaceChildren(fragment); renderArrow();
}
function renderArrow() {
  const best = lineSession ? lineSession.steps[lineCursor]?.uci : currentLines[0]?.pv?.[0] || (!variation && evaluations[ply]?.pv?.[0]);
  const line = $('best-arrow');
  line.style.display = best && !selected && $('arrow-toggle').getAttribute('aria-pressed') === 'true' ? 'block' : 'none';
  if (!best) return;
  const point = sq => { const file = 'abcdefgh'.indexOf(sq[0]), rank = Number(sq[1]); return [(flipped ? 7 - file : file) * 100 + 50, (flipped ? rank - 1 : 8 - rank) * 100 + 50]; };
  const [x1,y1] = point(best.slice(0,2)), [x2,y2] = point(best.slice(2,4));
  const length = Math.hypot(x2-x1,y2-y1), trim = 15 / length;
  for (const [attr,value] of Object.entries({x1,y1,x2:x2-(x2-x1)*trim,y2:y2-(y2-y1)*trim})) line.setAttribute(attr,value);
}
function renderMoves() {
  const fragment = document.createDocumentFragment();
  let row;
  game.moves.forEach((move,index) => {
    const review = reviewAt(index);
    const number = move.before.split(' ')[5];
    if (!row || move.color === 'w') {
      row = document.createElement('div'); row.className = 'move-row';
      const label = document.createElement('span'); label.className = 'move-number'; label.textContent = `${number}.`; row.append(label);
      if (move.color === 'b') row.append(document.createElement('span'));
      fragment.append(row);
    }
    const button = document.createElement('button'); button.className = `move-cell${ply === index + 1 && !variation ? ' current' : ''}`;
    button.dataset.ply = index + 1; button.setAttribute('aria-label', `${number}${move.color === 'b' ? '... ' : '. '}${move.san}${review ? ', ' + review.label : ''}`);
    button.setAttribute('aria-current', ply === index + 1 && !variation ? 'step' : 'false');
    const san = document.createElement('span'); san.textContent = move.san; button.append(san);
    if (review) {
      const grade = document.createElement('span'); grade.className = `move-grade grade-${review.key}`;
      grade.append(createMoveIcon(review.key)); grade.title = review.label; grade.setAttribute('aria-hidden', 'true');
      button.append(grade);
    }
    row.append(button);
  });
  const scroll = $('move-list').scrollTop; $('move-list').replaceChildren(fragment); $('move-list').scrollTop = scroll;
  if (!game.moves.length) { const p = document.createElement('p'); p.className = 'analysis-note'; p.textContent = 'Position study. Click pieces to explore a continuation.'; $('move-list').append(p); }
}
function renderEvaluation() {
  const value = liveEvaluation || (!variation && (positionAnalyses[ply] || evaluations[ply]));
  let cp = value?.terminal === 'checkmate' ? value.cp : Number.isFinite(value?.mate) ? (value.mate < 0 ? -10000 : 10000) : value?.cp ?? 0;
  // Keep the bar steady between positions; an absent score is not equality.
  // This is display state only, never evidence for grades or the new position.
  if (value) lastBarEvaluation = value;
  const barValue = lastBarEvaluation;
  const barCp = barValue?.terminal === 'checkmate' ? barValue.cp : Number.isFinite(barValue?.mate) ? (barValue.mate < 0 ? -10000 : 10000) : barValue?.cp ?? 0;
  const percent = 50 + 49 * Math.tanh(barCp / 650);
  $('eval-white').style.height = `${percent}%`;
  $('eval-white').style.top = flipped ? '0' : 'auto'; $('eval-white').style.bottom = flipped ? 'auto' : '0';
  $('eval-label').textContent = barValue ? displayScore(barValue) : '—';
  $('coach-score').textContent = value ? displayScore(value) : '—';
  $('coach-score').title = 'Stockfish evaluation from White’s perspective';
  $('eval-label').style.color = percent < 13 && !flipped || percent < 87 && flipped ? '#e8e5d5' : '#344033';
  const barDescription = value ? `White perspective evaluation ${displayScore(value)}` : barValue ? `Previous evaluation ${displayScore(barValue)} · current position not yet evaluated` : 'Position not yet evaluated';
  $('eval-white').parentElement.setAttribute('aria-label', barDescription);
  $('eval-white').parentElement.title = barDescription;
  $('depth-badge').textContent = value?.depth ? `Depth ${value.depth}` : 'Depth —';
  let verdict = 'Select Analyze this position for engine insights.';
  if (value?.terminal) verdict = value.terminal === 'checkmate' ? `Checkmate. ${value.winner} wins.` : `Draw by ${value.terminal}.`;
  else if (Number.isFinite(value?.mate)) verdict = `${value.mate >= 0 ? 'White' : 'Black'} has mate in ${Math.abs(value.mate)}.`;
  else if (value) verdict = `${displayScore(value)} · ${Math.abs(cp) < 30 ? 'The position is balanced.' : `${cp > 0 ? 'White' : 'Black'} ${Math.abs(cp) > 250 ? 'has a winning advantage' : Math.abs(cp) > 100 ? 'has the advantage' : 'has a slight edge'}.`}`;
  $('position-verdict').textContent = verdict;
  const fragment = document.createDocumentFragment();
  currentLines.slice(0,3).forEach((info,index) => {
    if (!info?.pv?.length) return;
    const button = document.createElement('button'); button.className = 'engine-line'; button.dataset.line = index; button.title = 'Walk through this line with Previous, Next, or Play';
    const score = document.createElement('strong'); score.textContent = displayScore(info);
    const moves = document.createElement('span'); moves.textContent = pvToSan(currentFen(),info.pv,8);
    const detail = document.createElement('small'); detail.textContent = `LINE ${index+1} · DEPTH ${info.depth} · CLICK TO EXPLORE`; moves.append(detail);
    button.append(score,moves); fragment.append(button);
  });
  $('engine-lines').replaceChildren(fragment); renderArrow();
}
function renderChart() {
  const known = evaluations.map((ev,index) => ev ? {ev,index} : null).filter(Boolean);
  $('chart-empty').hidden = known.length > 1;
  const points = known.map(({ev,index}) => { const cp = ev.terminal === 'checkmate' ? ev.cp : Number.isFinite(ev.mate) ? Math.sign(ev.mate || 1)*10000 : ev.cp || 0; return [index / Math.max(1,game.moves.length)*640,58-54*Math.tanh(cp/500)]; });
  const path = points.map(([x,y],i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  $('chart-line').setAttribute('d',path);
  $('chart-fill').setAttribute('d',points.length ? `${path} L${points.at(-1)[0]},116 L${points[0][0]},116 Z` : '');
  const x = ply / Math.max(1,game.moves.length)*640;
  $('chart-cursor').setAttribute('x1',x); $('chart-cursor').setAttribute('x2',x);
  $('chart-cursor').style.display = known.length ? 'block' : 'none';
  const marks=document.createDocumentFragment();
  for (let i=0;i<known.length;i++) {
    const index=known[i].index, review=reviews[index-1];
    if (!review || !['brilliant','great','inaccuracy','mistake','blunder'].includes(review.key)) continue;
    const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('cx',points[i][0]); circle.setAttribute('cy',points[i][1]); circle.setAttribute('r',index===ply?'5':'3.5');
    circle.setAttribute('class',`chart-marker marker-${review.key}`);
    const title=document.createElementNS('http://www.w3.org/2000/svg','title'); title.textContent=`${game.moves[index-1].san}: ${review.label}`; circle.append(title); marks.append(circle);
  }
  $('chart-marks').replaceChildren(marks);
}
function renderInsight() {
  const review = !variation && reviewAt(ply-1);
  $('best-line-button').hidden = Boolean(lineSession) || !bestPositionLine()?.pv?.length;
  $('best-line-button').title = 'Walk through the best continuation from the displayed position';
  $('insight-marker').className = 'insight-marker' + (review ? ` grade-${review.key}` : '');
  $('insight-marker').replaceChildren(createMoveIcon(variation ? 'variation' : review?.key || 'neutral'));
  $('insight-marker').setAttribute('aria-hidden', 'true');
  const opening = currentOpening();
  const positionAnalysis = liveEvaluation || bestPositionLine();
  const message = getCoachMessage({
    game, ply, review, variation:Boolean(variation), positionFen:currentFen(),
    // Completed review scores explain the played move's grade. Fresh analysis
    // belongs to the displayed board, including any explored continuation.
    before:variation ? null : evaluations[ply-1], after:variation ? null : evaluations[ply],
    positionAnalysis:positionAnalysis ? {...positionAnalysis,lines:currentLines.length ? currentLines.filter(Boolean) : positionAnalysis.lines || []} : null,
    opening:opening ? {...opening,details:getOpeningDetails(opening)} : null,
  });
  $('insight-title').textContent = message.title;
  $('insight-description').textContent = message.text;
  $('coach-tip').textContent = message.tip || '';
  $('coach-tip').hidden = !message.tip;
  $('move-insight').dataset.mood = message.mood || 'friendly';
  $('key-moment-button').hidden = !reviews.some(item => item && ['brilliant','great','inaccuracy','mistake','blunder'].includes(item.key));
  $('coach-details').hidden = !explanationOpen;
  $('explain-button').setAttribute('aria-expanded',String(explanationOpen));
}
function renderOpening() {
  const opening = currentOpening();
  const initialBoard = game.startFen.split(' ').slice(0,4).join(' ') === new Chess().fen().split(' ').slice(0,4).join(' ');
  const fallbackName = ply === 0 && !variation ? (initialBoard ? 'Starting position' : 'Imported starting position') : 'No named opening found';
  $('opening-name').textContent = opening?.family || opening?.name || fallbackName;
  $('opening-eco').textContent = opening?.eco || '—';
  $('opening-variation').textContent = opening?.variation || (opening?.name !== opening?.family ? opening?.name : '') || '';
  const details = getOpeningDetails(opening);
  $('opening-description').textContent = typeof details === 'string' ? details : details?.description || 'Explore the opening moves to identify a named line from the offline opening book.';
  for (const [id,key] of [['opening-white-plan','whitePlan'],['opening-black-plan','blackPlan'],['opening-watch-for','watchFor']]) {
    const text=details?.[key]; $(id).textContent=text || ''; $(id).parentElement.hidden=!text;
  }
  $('opening-line').textContent = opening?.pgn || '';
  $('opening-line').hidden = !opening?.pgn;
  $('opening-status').textContent = opening ? (opening.exact ? 'Book position · matched on the board' : 'Last recognized opening · now outside the named line') : 'Offline opening book';
  openingContinuations = getOpeningMoves(variation || boardAt(ply));
  const fragment = document.createDocumentFragment();
  for (const [index,move] of openingContinuations.entries()) {
    const button=document.createElement('button'); button.type='button'; button.className='opening-continuation'; button.dataset.openingMove=index;
    button.textContent=move.san; button.title=move.name || 'Explore this book continuation'; button.setAttribute('aria-label',`Explore book move ${move.san}${move.name ? ': '+move.name : ''}`); fragment.append(button);
  }
  $('opening-continuations').replaceChildren(fragment);
}
function renderSummary() {
  const summary = summarizeReview(game,reviews);
  $('review-intro').hidden = Boolean(summary.reviewed); $('review-summary').hidden = !summary.reviewed;
  $('white-accuracy').textContent = summary.white.accuracy?.toFixed(1) ?? '—';
  $('black-accuracy').textContent = summary.black.accuracy?.toFixed(1) ?? '—';
  $('summary-footnote').textContent = `${summary.reviewed} / ${summary.total} moves reviewed · Custom estimate`;
  const fragment = document.createDocumentFragment();
  for (const [key,label] of [['brilliant','Brilliant'],['great','Great'],['book','Book'],['best','Best'],['excellent','Excellent'],['good','Good'],['inaccuracy','Inaccuracies'],['mistake','Mistakes'],['blunder','Blunders'],['forced','Forced']]) {
    if (key === 'forced' && !summary.white.categories[key] && !summary.black.categories[key]) continue;
    const row = document.createElement('div'); row.className = `category-row ${key}`;
    for (const value of [summary.white.categories[key],label,summary.black.categories[key]]) {
      const span = document.createElement('span');
      if (value === label) {
        const badge = document.createElement('span'); badge.className = `move-grade grade-${key}`;
        badge.setAttribute('aria-hidden', 'true'); badge.append(createMoveIcon(key)); span.append(badge);
      }
      span.append(document.createTextNode(String(value))); row.append(span);
    }
    fragment.append(row);
  }
  $('category-breakdown').replaceChildren(fragment);
}

function setOverview(visible) {
  overviewVisible = Boolean(visible && game.moves.length);
  if (overviewVisible) {
    stopPlayback();
    if (!reviewing) {
      clearTimeout(searchTimer); generation++; engine.cancel();
      $('analyze-button').disabled = !ready;
      $('engine-status').textContent = ready ? 'Stockfish · ready' : 'Loading Stockfish';
    }
  }
  $('game-overview').hidden = !overviewVisible;
  for (const id of ['review-context','move-section','review-timeline']) $(id).hidden = overviewVisible;
  $('overview-button').disabled = !game.moves.length;
  $('overview-button').setAttribute('aria-pressed',String(overviewVisible));
  $('overview-button').classList.toggle('active',overviewVisible);
  for (const name of ['review','analysis']) {
    $(name+'-tab').setAttribute('aria-selected',String(!overviewVisible && !$(name+'-pane').hidden));
    $(name+'-tab').classList.toggle('active',!overviewVisible && !$(name+'-pane').hidden);
  }
  renderOverview();
}
function renderOverview() {
  const summary = summarizeReview(game,reviews);
  const complete = summary.total > 0 && summary.reviewed === summary.total;
  for (const color of ['white','black']) {
    const name = color === 'white' ? 'White' : 'Black';
    $('overview-'+color+'-name').textContent = game.headers[name] && game.headers[name] !== '?' ? game.headers[name] : name;
    $('overview-'+color+'-accuracy').textContent = summary[color].accuracy?.toFixed(1) ?? '—';
    $('overview-'+color+'-accuracy').title = complete ? 'Elo Pal accuracy estimate' : 'Partial accuracy for analyzed moves';
  }
  $('overview-result').textContent = (game.headers.Result || '*') === '*' ? 'Game in progress' : `Result ${(game.headers.Result || '*').replaceAll('-','–')}`;
  $('overview-title').textContent = complete ? 'Let’s review the key moments from your game.' : 'Let’s discover the story of your game.';
  $('overview-status').textContent = reviewing ? `Analyzing locally · ${summary.reviewed} of ${summary.total} moves` : complete ? 'Your summary is ready. Let’s find your next improvement.' : $('review-status').textContent;
  $('overview-progress').hidden = !reviewing;
  $('overview-progress-fill').style.width = `${summary.total ? summary.reviewed / summary.total * 100 : 0}%`;
  $('start-review-button').disabled = !complete || reviewing;
  $('overview-analyze-button').disabled = !ready || !game.moves.length;
  $('overview-analyze-button').textContent = reviewing ? 'Stop analysis' : complete ? 'Analyze again' : summary.reviewed ? 'Restart analysis' : 'Analyze game';
  $('overview-depth-select').disabled = reviewing;
  $('overview-depth-select').value = $('depth-select').value;
  const rows = $('category-breakdown').cloneNode(true);
  if (!summary.reviewed) for (const row of rows.children) { row.firstElementChild.textContent = '—'; row.lastElementChild.textContent = '—'; }
  $('overview-categories').replaceChildren(...rows.childNodes);
  const opening = openingTimeline.filter(Boolean).at(-1);
  $('overview-opening').textContent = opening ? `${opening.name || opening.family}${opening.eco ? ' · '+opening.eco : ''}` : 'No named opening recognized';
  $('overview-footnote').textContent = `${summary.reviewed} / ${summary.total} moves analyzed${complete ? '' : ' · Totals update during analysis'}. Accuracy and move grades are Elo Pal’s local estimates.`;
  for (const part of ['line','fill']) $('overview-chart-'+part).setAttribute('d',$('chart-'+part).getAttribute('d') || '');
  $('overview-chart-marks').replaceChildren(...Array.from($('chart-marks').children,node=>node.cloneNode(true)));
  $('overview-chart-empty').hidden = evaluations.filter(Boolean).length > 1;
}
function bestPositionLine() {
  return currentLines[0] || (!variation && (positionAnalyses[ply] || evaluations[ply])) || null;
}
function startLine(info, title = 'Best line') {
  if (!info?.pv?.length) return;
  const origin = variation || boardAt(ply);
  const moves = origin.history({verbose:true});
  const session = createLineSession({startFen:game.startFen,moves,originPly:moves.length,pv:info.pv});
  if (!session.length) { toast('No legal continuation is available for this position. Analyze it again.'); return; }
  if (reviewing) stopReview();
  lineSession = session; lineCursor = 0; lineTitle = title;
  setTab('analysis');
  selectLinePly(0,{sound:false});
  $('next-button').focus({preventScroll:true});
}
function selectLinePly(next, {playback=false,sound=true}={}) {
  if (!lineSession) return;
  if (!playback) stopPlayback();
  const previous = lineCursor;
  lineCursor = Math.max(0,Math.min(lineSession.length,next));
  variation = lineSession.boardAt(lineCursor);
  selected = null; currentLines = []; liveEvaluation = null;
  updateVariationOpening(); render(); scheduleAnalysis();
  const active = $('line-steps').querySelector('[aria-current="step"]');
  if (active) {
    const list = $('line-steps'), bounds=list.getBoundingClientRect(), item=active.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop += item.top-bounds.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom-bounds.bottom;
  }
  if (sound && previous !== lineCursor) playMoveSound(lineCursor > previous ? lineSession.moveAt(lineCursor) : null);
}
function renderLine() {
  $('line-walkthrough').hidden = !lineSession;
  if (!lineSession) return;
  $('line-label').textContent = `${lineTitle} · saved continuation`;
  $('line-progress').textContent = `${lineCursor} / ${lineSession.length}`;
  const fragment = document.createDocumentFragment();
  for (let index=0;index<=lineSession.length;index++) {
    const button = document.createElement('button'); button.type='button'; button.className='line-step'; button.dataset.linePly=index;
    button.textContent = index ? lineSession.notationAt(index) : 'Start';
    button.setAttribute('aria-current',index === lineCursor ? 'step' : 'false');
    button.setAttribute('aria-label',index ? `Line move ${lineSession.notationAt(index)}` : 'Line starting position');
    fragment.append(button);
  }
  const scroll = $('line-steps').scrollTop; $('line-steps').replaceChildren(fragment); $('line-steps').scrollTop=scroll;
}

function selectPly(next, {playback = false, sound = true} = {}) {
  const previousFen = currentFen(), previousPly = ply, wasVariation = Boolean(variation);
  if (!playback) stopPlayback();
  ply = Math.max(0,Math.min(game.moves.length,next)); variation = null; selected = null; variationOpening = null; lineSession = null; lineCursor = 0;
  if (overviewVisible) setOverview(false);
  const cached=positionAnalyses[ply] || evaluations[ply];
  currentLines = cached?.lines || (cached ? [cached] : []); liveEvaluation = positionAnalyses[ply] || null;
  render();
  revealCurrentMove();
  scheduleAnalysis();
  if (sound && currentFen() !== previousFen) playMoveSound(ply > previousPly && !wasVariation ? game.moves[ply - 1] : null);
}
function revealCurrentMove() {
  const list = $('move-list'), active = list.querySelector('.current');
  if (!active || !list.clientHeight) return;
  const bounds = list.getBoundingClientRect(), move = active.getBoundingClientRect();
  if (move.top < bounds.top) list.scrollTop += move.top - bounds.top;
  else if (move.bottom > bounds.bottom) list.scrollTop += move.bottom - bounds.bottom;
}
new ResizeObserver(revealCurrentMove).observe($('move-list'));
function setTab(name, {keepOverview = false} = {}) {
  if (!keepOverview && overviewVisible) setOverview(false);
  for (const tab of ['review','analysis']) { $(tab+'-pane').hidden = tab !== name; $(tab+'-tab').classList.toggle('active',!overviewVisible && tab === name); $(tab+'-tab').setAttribute('aria-selected',String(!overviewVisible && tab === name)); }
  const context = $('review-context');
  if (context) context.scrollTop = 0;
}
function scheduleAnalysis() {
  if (reviewing || overviewVisible) return;
  clearTimeout(searchTimer); generation++; engine.cancel();
  $('analyze-button').disabled = !ready;
  $('engine-status').textContent = ready ? 'Stockfish · ready' : 'Loading Stockfish';
  if (ready && $('auto-analyze').checked) searchTimer = setTimeout(analyzePosition,220);
}
async function analyzePosition() {
  if (!ready || reviewing || overviewVisible) return;
  clearTimeout(searchTimer); engine.cancel(); const token = ++generation;
  const board = variation || boardAt(ply), terminal = terminalEvaluation(board);
  const searchFen = board.fen(), searchPly = ply, searchVariation = Boolean(variation);
  if (terminal) { liveEvaluation = terminal; currentLines = []; if (!variation) evaluations[ply] = terminal; $('analyze-button').disabled = false; $('engine-status').textContent = 'Stockfish · ready'; renderEvaluation(); renderChart(); renderInsight(); return; }
  $('analyze-button').disabled = true; $('engine-status').textContent = 'Analyzing position…';
  currentLines = []; liveEvaluation = null;
  try {
    const result = await engine.analyze(searchFen, { ...presets[$('depth-select').value], multiPV:3, startFen:game.startFen, moves:board.history({verbose:true}).map(uci), onInfo: info => {
      if (token !== generation || currentFen() !== searchFen) return;
      currentLines[info.multipv-1] = info; if (info.multipv === 1) liveEvaluation = info; renderEvaluation();
    } });
    if (token !== generation || currentFen() !== searchFen) return;
    currentLines = result.lines; liveEvaluation = result.lines[0];
    if (!searchVariation && !variation && ply === searchPly && liveEvaluation) {
      positionAnalyses[searchPly] = {...liveEvaluation,lines:result.lines};
      // A later exploration can deepen its own cache without changing the
      // before/after evidence used to explain completed game-review grades.
      if (!reviews[searchPly-1] && !reviews[searchPly]) evaluations[searchPly] = positionAnalyses[searchPly];
    }
    renderEvaluation(); renderChart(); renderInsight();
  } catch(error) { if (error.name !== 'AbortError' && token === generation) engineError(error); }
  finally { if (token === generation) { $('analyze-button').disabled = false; $('engine-status').textContent = ready ? 'Stockfish · ready' : 'Engine unavailable'; } }
}
async function reviewGame() {
  if (reviewing) { stopReview(); return; }
  if (!ready || !game.moves.length) return;
  stopWork(); const token = ++generation; reviewing = true; variation = null; selected = null; lineSession = null; lineCursor = 0;
  evaluations = []; reviews = []; positionAnalyses = []; currentLines = []; liveEvaluation = null;
  setTab('review', {keepOverview:true}); $('review-intro').hidden = false; $('review-summary').hidden = true;
  $('review-button').textContent = 'Stop review'; $('depth-select').disabled = true; $('analyze-button').disabled = true;
  $('review-progress').hidden = false; $('review-progress-fill').style.width = '0%';
  const settings = presets[$('depth-select').value], board = new Chess(game.startFen);
  const start = performance.now();
  render();
  try {
    for (let index=0; index<game.positions.length; index++) {
      if (token !== generation) return;
      if (index) { const move = game.moves[index-1]; board.move({from:move.from,to:move.to,promotion:move.promotion}); }
      $('review-status').textContent = `Reviewing position ${index+1} of ${game.positions.length}…`;
      renderOverview();
      $('engine-status').textContent = 'Review in progress';
      let value = terminalEvaluation(board);
      if (!value) {
        const result = await engine.analyze(board.fen(),{...settings,multiPV:2,startFen:game.startFen,moves:board.history({verbose:true}).map(uci)});
        if (token !== generation) return;
        if (!result.lines[0]) throw new Error('The engine did not return a scored line. Try reviewing again.');
        value = {...result.lines[0],lines:result.lines};
      }
      evaluations[index] = value;
      if (index) { reviews[index-1] = evaluateMove(evaluations[index-1],value,game.moves[index-1],evaluations[index-1].pv?.[0],{opening:openingTimeline[index]}); }
      if (ply === index && !variation) { currentLines = value.lines || (value.pv?.length ? [value] : []); liveEvaluation = value; }
      $('review-progress-fill').style.width = `${(index+1)/game.positions.length*100}%`;
      render();
    }
    $('review-status').textContent = `Review complete · ${Math.round((performance.now()-start)/1000)} seconds · Analyzed on your device`;
    $('review-button').innerHTML = '<span>✦</span> Review again';
    toast(overviewVisible ? 'Your summary is ready. Select Start Review to explore the game.' : 'Your review is ready. Select a move to explore the details.');
  } catch(error) { if (error.name !== 'AbortError' && token === generation) { $('review-status').textContent = error.message; $('review-button').textContent = 'Try review again'; engineError(error); } }
  finally { if (token === generation) { reviewing = false; $('depth-select').disabled = false; $('analyze-button').disabled = false; $('engine-status').textContent = ready ? 'Stockfish · ready' : 'Engine unavailable'; render(); } }
}
function engineError(error) { console.error(error); toast(error.message || 'Analysis failed. Please reload to restart the engine.'); $('engine-status').textContent = 'Analysis error'; $('engine-status-dot').classList.add('error'); }

function selectSquare(square) {
  stopPlayback();
  const board = variation || boardAt(ply);
  if (selected) {
    const moves = board.moves({square:selected,verbose:true}).filter(move => move.to === square);
    if (moves.length) {
      if (moves.some(move => move.promotion)) { promotionMove = {from:selected,to:square}; const fragment=document.createDocumentFragment(); for (const piece of ['q','r','b','n']) { const b=document.createElement('button'); b.dataset.piece=piece; b.setAttribute('aria-label',`Promote to ${pieceNames[piece]}`); const img=document.createElement('img');img.src=`assets/pieces/${board.turn()}${piece}.svg`;img.alt=pieceNames[piece];b.append(img);fragment.append(b); } $('promotion-options').replaceChildren(fragment); $('promotion-dialog').showModal(); return; }
      playMove({from:selected,to:square}); return;
    }
  }
  selected = board.get(square)?.color === board.turn() && selected !== square ? square : null; renderBoard();
}
function playMove(move) {
  stopPlayback();
  if (reviewing) stopReview();
  const board = variation || boardAt(ply);
  let played;
  try { played = board.move(move); } catch { toast('That move is not legal in this position.'); return; }
  variation = board; lineSession = null; lineCursor = 0; updateVariationOpening(); selected = null; currentLines = []; liveEvaluation = null;
  setTab('analysis'); render(); scheduleAnalysis();
  playMoveSound(played);
}

$('board').addEventListener('click',event => { const button = event.target.closest('[data-square]'); if (button) selectSquare(button.dataset.square); });
$('move-list').addEventListener('click',event => { const button=event.target.closest('[data-ply]'); if(button) selectPly(Number(button.dataset.ply)); });
$('engine-lines').addEventListener('click',event => { const button=event.target.closest('[data-line]'); if(button) { const index=Number(button.dataset.line); startLine(currentLines[index],index ? `Engine line ${index+1}` : 'Best line'); } });
$('promotion-options').addEventListener('click',event => { const button=event.target.closest('[data-piece]'); if(button && promotionMove) { $('promotion-dialog').close();playMove({...promotionMove,promotion:button.dataset.piece});promotionMove=null; } });
$('review-tab').onclick = () => { setTab('review'); scheduleAnalysis(); }; $('analysis-tab').onclick = () => { setTab('analysis'); scheduleAnalysis(); };
$('review-button').onclick = reviewGame; $('analyze-button').onclick = analyzePosition;
$('overview-button').onclick = () => setOverview(true);
$('overview-analyze-button').onclick = reviewGame;
$('overview-depth-select').onchange = () => { $('depth-select').value=$('overview-depth-select').value; save(); };
$('start-review-button').onclick = () => { setTab('review'); selectPly(Math.min(1,game.moves.length)); };
$('line-steps').onclick = event => { const button=event.target.closest('[data-line-ply]'); if(button) selectLinePly(Number(button.dataset.linePly)); };
$('leave-line-button').onclick = () => selectPly(ply,{sound:false});
$('explain-button').onclick = () => { explanationOpen=!explanationOpen; renderInsight(); };
$('play-button').onclick = () => {
  if (playbackTimer) { stopPlayback(); return; }
  if (!lineSession && !game.moves.length) return;
  void moveSounds.unlock();
  if (lineSession) { if (lineCursor === lineSession.length) selectLinePly(0,{sound:false}); }
  else if (variation || ply === game.moves.length) selectPly(variation ? ply : 0, {sound:false});
  $('play-button').textContent='Ⅱ'; $('play-button').setAttribute('aria-label','Pause playback'); $('play-button').setAttribute('aria-pressed','true');
  playbackTimer=setInterval(()=>{
    if (lineSession) { selectLinePly(lineCursor+1,{playback:true}); if(lineCursor === lineSession.length) stopPlayback(); }
    else { if(ply >= game.moves.length) { stopPlayback(); return; } selectPly(ply+1,{playback:true}); if(ply === game.moves.length) stopPlayback(); }
  },1600);
};
$('opening-continuations').onclick = event => {
  const button=event.target.closest('[data-opening-move]');
  const move=button && openingContinuations[Number(button.dataset.openingMove)];
  if (move?.uci) playMove({from:move.uci.slice(0,2),to:move.uci.slice(2,4),promotion:move.uci[4]});
};
$('first-button').onclick = () => lineSession ? selectLinePly(0) : selectPly(0); $('last-button').onclick = () => lineSession ? selectLinePly(lineSession.length) : selectPly(game.moves.length);
$('prev-button').onclick = () => {
  stopPlayback();
  if (lineSession) { selectLinePly(lineCursor-1); return; }
  if (!variation) { selectPly(ply-1); return; }
  if (!variation.undo()) return;
  if (variation.history().length === ply) { selectPly(ply,{sound:false}); playMoveSound(null); return; }
  updateVariationOpening(); selected=null; currentLines=[]; liveEvaluation=null; render(); scheduleAnalysis();
  playMoveSound(null);
};
$('next-button').onclick = () => lineSession ? selectLinePly(lineCursor+1) : selectPly(ply+1);
$('return-button').onclick = () => selectPly(ply,{sound:false});
$('flip-button').onclick = () => { flipped=!flipped;renderBoard();renderPlayers();renderEvaluation();save(); };
$('arrow-toggle').onclick = () => { const show=$('arrow-toggle').getAttribute('aria-pressed')!=='true';$('arrow-toggle').setAttribute('aria-pressed',String(show));$('arrow-toggle').classList.toggle('toggled',show);renderArrow(); };
$('sound-toggle').onclick = () => { moveSounds.setEnabled(!moveSounds.enabled); renderSoundControl(); save(); if (moveSounds.enabled) void moveSounds.unlock(); };
$('chart-container').onclick = event => { const rect=$('chart-container').getBoundingClientRect();selectPly(Math.round((event.clientX-rect.left)/rect.width*game.moves.length)); };
$('depth-select').onchange = () => { save();scheduleAnalysis(); };
$('auto-analyze').onchange = () => { if($('auto-analyze').checked) scheduleAnalysis();else if(!reviewing){clearTimeout(searchTimer);generation++;engine.cancel();$('analyze-button').disabled=false;$('engine-status').textContent='Stockfish · ready';} };
$('best-line-button').onclick = () => startLine(bestPositionLine());
$('key-moment-button').onclick = () => {
  const moments = reviews.flatMap((item,index) => item && ['brilliant','great','inaccuracy','mistake','blunder'].includes(item.key) ? [index+1] : []);
  if (moments.length) selectPly(moments.find(index => index > ply) ?? moments[0]);
};
function importDialog() { stopPlayback(); $('import-error').textContent='';$('import-dialog').showModal(); }
for(const id of ['import-button','nav-import','notice-import-button']) $(id).onclick=importDialog;
$('notice-close').onclick = () => $('import-notice').hidden = true;
$('nav-review').onclick=()=>{if(game.moves.length)setOverview(true);else setTab('analysis');};
$('nav-demo').onclick=()=>openGame(DEMO_PGN,{demo:true});
$('dialog-demo').onclick=()=>{openGame(DEMO_PGN,{demo:true});$('import-dialog').close();};
for(const id of ['help-button','method-button']) $(id).onclick=()=>$('help-dialog').showModal();
for(const id of ['cowcatbird-button','about-menu-button']) $(id).onclick=()=>{stopPlayback();document.querySelector('.workspace-menu').open=false;$('about-dialog').showModal();};
$('about-help-button').onclick=()=>{$('about-dialog').close();$('help-dialog').showModal();};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
$('file-input').onchange=async()=>{const file=$('file-input').files[0];if(!file)return;if(file.size>2*1024*1024){$('import-error').textContent='Please choose a PGN or FEN file smaller than 2 MB.';return;}try{$('game-input').value=await file.text();$('file-name').textContent=file.name;$('import-error').textContent='';}catch{$('import-error').textContent='Could not read that file. Try pasting the game instead.'}};
$('import-form').onsubmit=event=>{event.preventDefault();try{const text=$('game-input').value;if(text.length>2*1024*1024)throw new Error('Please import a game smaller than 2 MB.');openGame(text);$('import-dialog').close();$('game-input').value='';$('file-input').value='';$('file-name').textContent='Everything stays on this device.';}catch(error){$('import-error').textContent=error.message;}};
$('export-button').onclick=()=>{const blob=new Blob([game.pgn+'\n'],{type:'application/x-chess-pgn'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='elo-pal-game.pgn';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Original game exported as PGN.');};
document.addEventListener('keydown',event=>{
  if(document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||event.ctrlKey||event.metaKey||event.altKey)return;
  const previous=()=>$('prev-button').click();
  const next=()=>$('next-button').click();
  const actions={ArrowLeft:previous,a:previous,A:previous,ArrowRight:next,d:next,D:next,Home:()=>$('first-button').click(),End:()=>$('last-button').click(),f:()=>$('flip-button').click(),F:()=>$('flip-button').click(),m:()=>$('sound-toggle').click(),M:()=>$('sound-toggle').click(),Escape:()=>variation?selectPly(ply):(selected=null,renderBoard())};
  if(actions[event.key]){event.preventDefault();actions[event.key]();}
});
window.addEventListener('beforeunload',()=>{engine.destroy();void moveSounds.destroy();});
document.addEventListener('visibilitychange',()=>{ if(document.hidden) { stopPlayback(); moveSounds.stop(); } });
function showImportNotice(success, message, sourceLabel = 'Chess.com or Lichess') {
  $('import-notice').hidden = false;
  $('import-notice').classList.toggle('import-warning',!success);
  $('import-notice-symbol').textContent = success ? '✓' : 'ⓘ';
  $('import-notice-title').textContent = success ? `Game imported from ${sourceLabel}` : 'Automatic import needs a hand';
  $('import-notice-text').textContent = message;
  $('notice-import-button').hidden = success;
}
const launchUrl = new URL(location.href);
const importToken = launchUrl.searchParams.get('import');
let incoming = await consumeImportSession(importToken);
if (launchUrl.searchParams.has('importError')) incoming = {status:'error',message:'Chrome could not transfer the game to this tab. Try clicking Elo Pal again, or paste the PGN.'};
if (importToken || launchUrl.searchParams.has('importError')) { launchUrl.searchParams.delete('import'); launchUrl.searchParams.delete('importError'); history.replaceState(null,'',launchUrl.href); }
let autoReviewGame = null;
if (incoming?.status === 'success') {
  try {
    openGame(incoming.pgn);
    autoReviewGame = game;
    showImportNotice(true,`${game.moves.length} half-moves loaded. Your local review starts automatically.`,incoming.sourceLabel);
  } catch(error) { incoming = {status:'error',message:`The detected game could not be loaded: ${error.message}`}; }
}
if (!autoReviewGame) {
  try{openGame(stored.pgn || DEMO_PGN,{demo:!stored.pgn});}catch{openGame(DEMO_PGN,{demo:true});}
  if (incoming?.status === 'error') showImportNotice(false,`${incoming.message} ${stored.pgn ? 'Your saved game' : 'The sample game'} is currently shown.`);
}
try{await engine.init();ready=true;$('engine-status').textContent='Stockfish 19 Lite · ready';$('review-button').disabled=!game.moves.length;$('review-status').textContent=game.moves.length?'Analyze this game to reveal your accuracy and key moments.':'Position loaded. Open Analysis to explore it.';renderOverview();if(autoReviewGame === game && game.moves.length) { void reviewGame(); } else { scheduleAnalysis(); }}
catch(error){ready=false;$('review-status').textContent='The engine could not start. Reload the extension to try again.';$('engine-status').textContent='Engine unavailable';$('engine-status-dot').classList.add('error');$('analyze-button').disabled=true;renderOverview();console.error(error);}
