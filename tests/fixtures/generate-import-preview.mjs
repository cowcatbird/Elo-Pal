import { readFile, writeFile } from 'node:fs/promises';

// Refresh the fixture from the current production HTML without changing it.
const source = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const entry = '<script type="module" src="src/app.js"></script>';
if (!source.includes(entry)) throw new Error('App entry point changed; update this test fixture generator.');
const banner = `<section class="fixture-banner" aria-label="Test fixture status"><strong>Test fixture · simulated toolbar handoff</strong><span id="fixture-status">Preparing the test page…</span><a id="fixture-launch" hidden>Launch simulated handoff →</a></section>
  <section class="fixture-intro"><h1>Test the toolbar handoff locally.</h1><p>The launch link supplies one simulated Chrome session-storage payload containing the Opera Game. The actual import consumer, Elo Pal interface, and bundled Stockfish engine then run normally.</p><p>This does not access Chess.com or Lichess or test extraction from a live page. Add ?source=lichess to test a Lichess handoff. Like a normal import, it replaces the locally saved game in this preview browser profile.</p><p>Click <strong>Launch simulated handoff</strong> in the banner to begin.</p></section>`;
const fixture = source
  .replace('<head>', '<head>\n  <!-- Test-only snapshot; regenerate with node tests/fixtures/generate-import-preview.mjs -->\n  <base href="/">')
  .replace(/<title>[^<]*<\/title>/, '<title>Elo Pal · Simulated toolbar handoff fixture</title>')
  .replace(entry, '<link rel="stylesheet" href="tests/fixtures/import-preview.css">\n  <script type="module" src="tests/fixtures/import-preview.js"></script>')
  .replace('<body>', `<body>\n  ${banner}`);
await writeFile(new URL('import-preview.html', import.meta.url), fixture);
console.log('Generated tests/fixtures/import-preview.html from the current index.html.');
