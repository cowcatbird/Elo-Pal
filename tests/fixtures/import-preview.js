import { DEMO_PGN } from '../../src/model.js';

// This is a normal browser page fixture, never part of production startup.
// It simulates only chrome.storage.session; the importer, app, and engine are real.
const banner = document.getElementById('fixture-status');
const launch = document.getElementById('fixture-launch');
const url = new URL(location.href);
const token = url.searchParams.get('import');
const source = url.searchParams.get('source') === 'lichess' ? 'lichess.org' : 'chess.com';
const sourceLabel = source === 'lichess.org' ? 'Lichess' : 'Chess.com';
const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);

if (!local) {
  document.body.classList.add('fixture-idle');
  banner.textContent = 'Fixture blocked: open this page on the local preview server.';
  launch.hidden = true;
} else if (!token) {
  document.body.classList.add('fixture-idle');
  const start = new URL(location.href);
  start.searchParams.set('import', crypto.randomUUID());
  launch.href = start.href;
  launch.hidden = false;
  banner.textContent = 'Waiting for a click. No handoff or app startup has run yet.';
} else {
  launch.hidden = true;
  const key = `rook.import.${token}`;
  const entries = {
    [key]: {
      version: 1,
      status: 'success',
      source,
      sourceUrl: source === 'lichess.org' ? 'https://lichess.org/game/AbCd1234' : 'https://www.chess.com/game/live/1',
      createdAt: Date.now(),
      method: 'explicit-local-test-fixture',
      pgn: DEMO_PGN.replace('[Event "Opera Game"]', '[Event "Simulated toolbar handoff"]'),
    },
  };
  let reads = 0, removals = 0;
  const session = {
    async get(name) {
      reads++;
      banner.textContent = `Mock session read ${reads} time(s); starting the real importer.`;
      return Object.hasOwn(entries, name) ? { [name]: entries[name] } : {};
    },
    async remove(name) {
      delete entries[name];
      removals++;
      banner.textContent = `Mock session consumed: ${reads} read, ${removals} removal. Real local review starting.`;
    },
  };
  // Extension pages are excluded above, so this cannot replace real extension storage.
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true, writable: true, value: { storage: { session } },
  });
  try {
    await import('../../src/app.js');
    banner.textContent = `Actual app running. Mock ${sourceLabel} handoff: ${reads} read, ${removals} removal. No ${sourceLabel} page was accessed.`;
  } catch (error) {
    banner.textContent = `Fixture startup failed: ${error.message}`;
    console.error(error);
  }
}
