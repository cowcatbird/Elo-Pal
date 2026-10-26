/**
 * Read the open Lichess game without interacting with its board. This function
 * is intentionally self-contained: Chrome serializes it into the page's MAIN
 * world, without this module's lexical scope.
 *
 * Public export contracts: lichess.org/api#tag/Games/operation/gamePgn and
 * lichess.org/api#tag/Studies/operation/studyChapterPgn.
 * DOM anchors follow lila's analyse treeView, studyChapters and round replay.
 */
export async function extractLichessGame() {
  const result = { sourceUrl: location.href, candidates: [] };
  const MAX_BYTES = 262144;
  const MAX_MOVES = 1000;
  const safe = fn => { try { return fn(); } catch { return undefined; } };
  const nodes = (root, selector) => safe(() => Array.from(root.querySelectorAll(selector))) || [];
  const visible = node => safe(() => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const hasClass = (node, name) => safe(() => node.classList.contains(name)) || false;
  const fail = code => { result.error = code; return result; };
  const finish = () => { result.sourceUrl = safe(() => location.href) || result.sourceUrl; };
  let timer, controller, reader;
  try {
    const original = new URL(result.sourceUrl);
    const authority = result.sourceUrl.match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i)?.[1]?.toLowerCase();
    if (!['lichess.org', 'www.lichess.org'].includes(authority) || original.protocol !== 'https:' || original.username || original.password || original.port) return fail('unsupported-page');
    const path = original.pathname.replace(/\/+$/, '') || '/';
    const isAnalysis = path === '/analysis' || (path.startsWith('/analysis/') && path !== '/analysis/help');
    const study = path.match(/^\/study\/([A-Za-z0-9]{8})(?:\/([A-Za-z0-9]{8}))?$/);
    const reserved = new Set(['analysis', 'training', 'practice', 'features', 'insights', 'bookmark', 'timeline', 'openings', 'settings', 'password']);
    const game = !isAnalysis && path.match(/^\/(?:game\/)?([A-Za-z0-9]{8}(?:[A-Za-z0-9]{4})?)(?:\/(?:white|black)(?:\/analysis)?)?$/);
    const gameId = game && (path.startsWith('/game/') || !reserved.has(game[1].toLowerCase())) ? game[1].slice(0, 8) : null;
    if (!study && !isAnalysis && !gameId) return fail('unsupported-page');

    // A named game route must still show its own board, not a 404, profile or
    // page containing unrelated mini boards. Never inspect application state.
    const roots = nodes(document, 'main.analyse, .round__app').filter(visible);
    if (roots.length > 1) return fail('ambiguous-board');
    if (roots.length !== 1) return fail('no-game');
    const root = roots[0];
    const variant = String(safe(() => root.className) || '').match(/(?:^|\s)variant-([A-Za-z0-9_-]+)(?:\s|$)/)?.[1];
    if (variant) result.variant = variant;

    function displayedCount() {
      const trees = nodes(root, '.analyse__moves .tview2').filter(visible);
      if (trees.length === 1) {
        const column = hasClass(trees[0], 'tview2-column');
        const moves = nodes(trees[0], column ? ':scope > move[p]' : ':scope > move.mainline[p]');
        let previous = '', count = 0;
        for (const move of moves) {
          if (hasClass(move, 'nongame')) break;
          const p = safe(() => move.getAttribute('p'));
          if (typeof p !== 'string' || p.length !== previous.length + 2 || !p.startsWith(previous) || p.length > MAX_MOVES * 2) break;
          previous = p;
          count++;
        }
        if (count) return count;
      }
      // Round replay's custom element names are intentionally scoped. Count
      // non-empty SAN slots, not absolute move numbers (From Position games
      // can start with Black or at a later full-move number).
      const lists = nodes(root, 'i5d app').filter(visible);
      if (lists.length !== 1) return undefined;
      const children = safe(() => Array.from(lists[0].children)) || [];
      let count = 0, index, slots = 0;
      for (const node of children) {
        const tag = String(node.tagName).toLowerCase();
        if (tag === 'qzm') {
          const next = Number(String(node.textContent).trim());
          if (!Number.isInteger(next) || next < 1 || (index != null && (next !== index + 1 || slots !== 2))) return undefined;
          index = next; slots = 0;
        } else if (tag === 'z7yx') {
          if (index == null || ++slots > 2) return undefined;
          if (!/^\s*(?:…|\.{3})\s*$/.test(String(node.textContent)) && String(node.textContent).trim()) count++;
          if (count > MAX_MOVES) return undefined;
        }
      }
      return count || undefined;
    }
    const minimum = displayedCount();
    if (minimum) result.minimumPly = minimum;

    const selectedChapter = () => {
      const selected = nodes(document, '.study__chapters .study-list > button.active[data-id]');
      if (selected.length !== 1) return undefined;
      const id = safe(() => selected[0].getAttribute('data-id'));
      return /^[A-Za-z0-9]{8}$/.test(id || '') ? id : undefined;
    };
    const initialChapter = study ? selectedChapter() : undefined;
    if (study && study[2] && initialChapter && study[2] !== initialChapter) return fail('page-changed');
    const chapterId = study && (study[2] || initialChapter);
    if (study && !chapterId) return fail('no-selected-chapter');

    const plausiblePgn = text => typeof text === 'string' && text.trim() && !/\u0000/.test(text)
      && new TextEncoder().encode(text).byteLength <= MAX_BYTES
      && /^(?:\s*\[[A-Za-z][A-Za-z0-9_]*\s+"|\s*\d+\.(?:\.\.)?\s*[KQRBNPa-hO0])/u.test(text);
    const currentFen = () => {
      const inputs = nodes(root, '.copyables input.copyable');
      if (inputs.length !== 1) return undefined;
      const value = safe(() => inputs[0].value);
      return typeof value === 'string' && value.length <= 128 && value.trim().split(/\s+/).length === 6 ? value.trim() : undefined;
    };
    const candidate = (text, method) => {
      const entry = { format: 'pgn', text: text.trim(), method, mainline: true };
      const fen = currentFen();
      if (fen) entry.currentFen = fen;
      const startFen = text.match(/^\s*\[FEN\s+"([^"\r\n]+)"\]\s*$/m)?.[1];
      if (startFen) entry.startFen = startFen;
      return entry;
    };

    if (isAnalysis) {
      const fields = nodes(root, '.copyables .pgn textarea.copyable');
      if (fields.length !== 1 || hasClass(fields[0], 'is-error')) return fail('no-game');
      const text = safe(() => fields[0].value);
      if (!plausiblePgn(text)) return fail('invalid-pgn');
      result.candidates.push(candidate(text, 'Lichess analysis PGN field'));
      return result;
    }

    const endpoint = new URL(study ? `/api/study/${study[1]}/${chapterId}.pgn` : `/game/export/${gameId}`, original.origin);
    endpoint.search = study ? 'clocks=false&comments=false&variations=false' : 'moves=true&tags=true&clocks=false&evals=false&opening=false&literate=false';
    controller = new AbortController();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('export-timeout')); }, 4000);
    });
    const download = async () => {
      const response = await fetch(endpoint.href, {
        method: 'GET', mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/x-chess-pgn' }, signal: controller.signal,
      });
      const returned = new URL(response.url);
      if (!response.ok || response.redirected || returned.origin !== endpoint.origin || returned.pathname !== endpoint.pathname
        || returned.username || returned.password || returned.hash) throw new Error('export-unavailable');
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['application/x-chess-pgn', 'application/vnd.chess-pgn', 'text/plain'].includes(type)) throw new Error('invalid-pgn');
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('export-too-large');
      if (!response.body?.getReader) throw new Error('export-unavailable');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0, text = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error('export-too-large');
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return text;
    };
    const text = await Promise.race([download(), timeout]);
    if (!plausiblePgn(text) || !/^\s*\[[A-Za-z]/.test(text)) return fail('invalid-pgn');
    if (study && selectedChapter() !== initialChapter) return fail('page-changed');
    const latestMinimum = displayedCount();
    if (latestMinimum) result.minimumPly = Math.max(result.minimumPly || 0, latestMinimum);
    // Lichess intentionally withholds the latest three moves of live games.
    // A collapsed or hidden move tree cannot certify that export is complete.
    if (gameId && !/^\s*\[Result\s+"(?:1-0|0-1|1\/2-1\/2)"\]\s*$/m.test(text)) return fail('ongoing-game');
    result.candidates.push(candidate(text, study ? 'Lichess public study chapter export' : 'Lichess public game export'));
    return result;
  } catch (error) {
    const known = ['export-unavailable', 'export-timeout', 'export-too-large', 'invalid-pgn'];
    return fail(known.includes(error?.message) ? error.message : 'export-unavailable');
  } finally {
    if (timer) clearTimeout(timer);
    safe(() => controller?.abort());
    safe(() => reader?.cancel()?.catch(() => {}));
    safe(() => reader?.releaseLock());
    finish();
  }
}
