import { importSource } from './import-sources.js';

const PREFIX = 'rook.import.';
const MAX_AGE = 15 * 60 * 1000;

/** Consume a one-time handoff from the toolbar worker, never a PGN in the URL. */
export async function consumeImportSession(token, { storage = globalThis.chrome?.storage?.session, now = Date.now() } = {}) {
  if (!token) return null;
  const failure = message => ({ status: 'error', message });
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(token)) {
    return failure('This import link is invalid. Return to your Chess.com or Lichess game and click Elo Pal again.');
  }
  if (!storage) return failure('Automatic import is available in the installed Chrome extension. You can still paste a PGN here.');
  const key = PREFIX + token;
  let payload;
  try {
    payload = (await storage.get(key))?.[key];
    await storage.remove(key);
  } catch {
    return failure('The game could not be transferred to this tab. Return to Chess.com or Lichess and click Elo Pal again.');
  }
  if (!payload || payload.version !== 1 || !Number.isFinite(payload.createdAt) || now - payload.createdAt > MAX_AGE || payload.createdAt > now + 60_000) {
    return failure('This game import has expired. Return to Chess.com or Lichess and click Elo Pal again.');
  }
  if (payload.status === 'error') return failure(typeof payload.message === 'string' ? payload.message.slice(0,600) : 'No game was detected. Open a Chess.com or Lichess game and click Elo Pal again.');
  const source = importSource(payload.sourceUrl);
  if (payload.status !== 'success' || !source || payload.source !== source.source) {
    return failure('The imported game did not come from a supported Chess.com or Lichess page.');
  }
  if (typeof payload.pgn !== 'string' || !payload.pgn.trim() || payload.pgn.length > 2 * 1024 * 1024) return failure('The page did not supply a readable game. Try importing its PGN manually.');
  return {status:'success',pgn:payload.pgn,source:source.source,sourceLabel:source.label,sourceUrl:source.url,method:payload.method};
}
