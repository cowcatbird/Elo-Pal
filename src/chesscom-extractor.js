/**
 * Runs once in the clicked tab's MAIN world. Keep self-contained: Chrome copies
 * the function, not its module closure. It reads only the current board/game.
 */
export async function extractChesscomGame() {
  const result = { sourceUrl: location.href, candidates: [] };
  if (location.protocol !== 'https:' || !['chess.com', 'www.chess.com'].includes(location.hostname)) return result;
  const MAX_TEXT = 262144, MAX_MOVES = 1000;
  const safe = fn => { try { return fn(); } catch { return undefined; } };
  const text = value => typeof value === 'string' && value.length <= MAX_TEXT ? value : null;
  const visible = element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
  const boards = [...document.querySelectorAll('wc-chess-board, chess-board')].filter(visible);
  if (boards.length > 1) { result.error = 'ambiguous-board'; return result; }
  const board = boards[0];
  const game = safe(() => board?.game);
  const read = async name => {
    if (typeof safe(() => game?.[name]) !== 'function') return undefined;
    let timer;
    try { return await Promise.race([Promise.resolve(game[name]()), new Promise(resolve => { timer = setTimeout(() => resolve(undefined), 350); })]); }
    catch { return undefined; }
    finally { clearTimeout(timer); }
  };
  const variant = await read('getVariant');
  if (typeof variant === 'string') result.variant = variant.slice(0, 80);
  else if (typeof board?.dataset?.variant === 'string') result.variant = board.dataset.variant.slice(0, 80);
  const currentFen = text(await read('getFEN')) || text(await read('getFen'));
  const startFen = text(await read('getStartingFEN')) || text(await read('getInitialFEN'));
  const rawHeaders = await read('getHeaders');
  const headers = {};
  if (rawHeaders && typeof rawHeaders === 'object') {
    for (const key of ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'FEN', 'SetUp', 'Link', 'Variant']) {
      const value = safe(() => rawHeaders[key]);
      if (typeof value === 'string' && value.length <= 512) headers[key] = value;
    }
  }
  for (const method of ['getPGN', 'getPgn']) {
    const value = await read(method);
    const pgn = text(value) || text(safe(() => value?.pgn));
    if (pgn) result.candidates.push({ format: 'pgn', text: pgn, method: `board.game.${method}`, currentFen });
  }
  const history = await read('getHistory');
  if (Array.isArray(history) && history.length && history.length <= MAX_MOVES) {
    const moves = history.map(item => {
      if (typeof item === 'string') return item.slice(0, 40);
      if (!item || typeof item !== 'object') return null;
      for (const key of ['san', 'notation', 'move']) if (typeof item[key] === 'string') return item[key].slice(0, 40);
      const move = item.move && typeof item.move === 'object' ? item.move : item;
      if (typeof move.from === 'string' && typeof move.to === 'string') {
        return { from: move.from.slice(0, 2), to: move.to.slice(0, 2), promotion: typeof move.promotion === 'string' ? move.promotion.slice(0, 1) : undefined };
      }
      return null;
    });
    if (moves.every(Boolean)) result.candidates.push({ format: 'moves', moves, headers, startFen: startFen || text(history[0]?.before), currentFen, method: 'board.game.getHistory' });
  }
  for (const area of [...document.querySelectorAll('textarea[name*="pgn" i], textarea[id*="pgn" i], textarea[class*="pgn" i], textarea[aria-label*="pgn" i], textarea[placeholder*="pgn" i], [data-cy="pgn-textarea"]')].slice(0, 4)) {
    const pgn = text(area.value) || text(area.textContent);
    if (pgn?.trim()) result.candidates.push({ format: 'pgn', text: pgn, currentFen, method: 'PGN field' });
  }
  const lists = [...document.querySelectorAll('wc-move-list, vertical-move-list, .vertical-move-list')].filter(visible);
  const list = lists.find(element => board?.id && element.getAttribute('board-id') === board.id) || (lists.length === 1 ? lists[0] : null);
  if (list) {
    // Current Chess.com main line uses data-node="0-N". Variation nodes have
    // another prefix; never join them into the played game's move sequence.
    const nodes = [...list.querySelectorAll('.main-line-ply[data-node]')];
    const indices = nodes.map(node => /^0-(\d+)$/.exec(node.getAttribute('data-node'))?.[1]).map(value => value == null ? NaN : Number(value));
    if (indices.length && indices.every(Number.isInteger)) result.minimumPly = Math.max(...indices) + 1;
    const contiguous = nodes.length && nodes.length <= MAX_MOVES && indices.every((value, index) => value === index);
    if (contiguous) {
      const moves = nodes.map(node => {
        const content = node.querySelector('.node-highlight-content') || node;
        let san = (content.textContent || '').trim().replace(/\s+/g, '');
        const figurine = content.querySelector('[data-figurine], [data-piece], .icon-font-chess');
        if (figurine && !/^[KQRBN♔♕♖♗♘♚♛♜♝♞O0]/.test(san)) {
          const type = figurine.getAttribute('data-figurine') || figurine.getAttribute('data-piece') || '';
          const piece = /^[KQRBN]$/i.test(type) ? type.toUpperCase() : /knight/i.test(figurine.className) ? 'N' : /bishop/i.test(figurine.className) ? 'B' : /rook/i.test(figurine.className) ? 'R' : /queen/i.test(figurine.className) ? 'Q' : /king/i.test(figurine.className) ? 'K' : /^(P|pawn)$/i.test(type) || /pawn/i.test(figurine.className) ? '' : null;
          if (piece === null) return null;
          san = piece + san;
        }
        return san.slice(0, 40);
      });
      // The analysis title lists White then Black. Top/bottom board player cards
      // reverse when the board flips, so they must never supply this ordering.
      const title = document.querySelector('.analysis-game-title-component');
      const names = [...(title?.querySelectorAll('[data-test-element="user-tagline-username"]') || [])].slice(0, 2).map(node => (node.textContent || '').trim().slice(0, 128));
      const resultText = (title?.querySelector('.analysis-game-title-result')?.textContent || '').trim();
      const domHeaders = { ...headers, Site: 'Chess.com' };
      if (names.length === 2) { domHeaders.White ||= names[0]; domHeaders.Black ||= names[1]; }
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(resultText)) domHeaders.Result = resultText;
      if (moves.every(Boolean)) result.candidates.push({ format: 'moves', moves, startFen, headers: domHeaders, currentFen, expectedPly: nodes.length, mainline: true, method: 'Chess.com main move list' });
    }
  }
  result.sourceUrl = location.href;
  return result;
}
