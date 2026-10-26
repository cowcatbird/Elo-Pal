import { extractChesscomGame } from './src/chesscom-extractor.js';
import { extractLichessGame } from './src/lichess-extractor.js';
import { importSource } from './src/import-sources.js';
import { validateImportedSnapshot, ChesscomImportError, IMPORT_PREFIX, IMPORT_TTL_MS } from './src/chesscom-import.js';

/** The toolbar gesture grants temporary activeTab access to this tab only. */
export async function importFromTab(tab, api = globalThis.chrome, { now = Date.now, token = () => crypto.randomUUID() } = {}) {
  const createdAt = now();
  const source = importSource(tab?.url);
  let payload;
  try {
    if (!source) throw new ChesscomImportError('wrong-site', 'Open a Chess.com or Lichess game or analysis board, then click Elo Pal again. You can also import a PGN file here.');
    if (!Number.isInteger(tab.id)) throw new Error('The active tab is unavailable.');
    const extractor = source.source === 'lichess.org' ? extractLichessGame : extractChesscomGame;
    const frames = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: extractor });
    const snapshot = frames.find(frame => frame.frameId === 0)?.result;
    const game = validateImportedSnapshot(snapshot, tab.url);
    payload = { version: 1, status: 'success', source: source.source, createdAt, ...game };
  } catch (error) {
    payload = { version: 1, status: 'error', source: source?.source, sourceUrl: source?.url, createdAt,
      code: error instanceof ChesscomImportError ? error.code : 'extraction-failed',
      message: error instanceof ChesscomImportError ? error.message : `Elo Pal could not read this ${source?.label || 'game'} tab. Reload the game page and click Elo Pal again, or import its PGN file.` };
  }
  const id = token();
  const key = IMPORT_PREFIX + id;
  try {
    const stored = await api.storage.session.get(null);
    const imports = Object.entries(stored).filter(([name]) => name.startsWith(IMPORT_PREFIX)).sort((a, b) => (b[1]?.createdAt || 0) - (a[1]?.createdAt || 0));
    const stale = imports.filter(([, value], index) => index >= 19 || !Number.isFinite(value?.createdAt) || createdAt - value.createdAt > IMPORT_TTL_MS).map(([name]) => name);
    if (stale.length) await api.storage.session.remove(stale);
    await api.storage.session.set({ [key]: payload });
  } catch {
    await api.tabs.create({ url: api.runtime.getURL('index.html?importError=storage-unavailable') });
    return { status: 'error', code: 'storage-unavailable' };
  }
  await api.tabs.create({ url: api.runtime.getURL(`index.html?import=${encodeURIComponent(id)}`) });
  return payload;
}

if (globalThis.chrome?.action?.onClicked) {
  chrome.action.onClicked.addListener(tab => { importFromTab(tab).catch(error => console.error('Could not open Elo Pal:', error)); });
}
