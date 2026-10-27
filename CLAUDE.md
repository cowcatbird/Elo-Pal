# CLAUDE.md — Elo Pal

Elo Pal is a free, offline Chrome extension (Manifest V3) for reviewing chess games with
local Stockfish, custom move grades, an opening explorer, and "Coach Cat" explanations.
It exists because Chess.com puts game review behind a subscription; cowcatbird wanted the
same workflow for free, running entirely on the user's machine. GPL-3.0-only.
This file is the orientation layer; README.md, CONTRIBUTING.md, SOURCES.md, PRIVACY.md,
and CHANGELOG.md are thorough and are the source of truth for anything they cover.

## Orientation

- No build step and no runtime dependencies. The browser loads `index.html`, `src/*.js`,
  `background.js`, and `vendor/` directly. `npm ci` is only for refreshing vendored files.
- `src/app.js` (~3k lines across `src/`) is the review UI and state; `src/model.js` parses
  games and classifies moves; `src/engine.js` wraps the Stockfish worker; `src/coach.js`
  and `src/position-advice.js` generate coaching from rules plus engine output, never
  cloud AI; `src/*extractor.js` and `src/*import*.js` handle one-click Chess.com/Lichess
  import through `activeTab` + `scripting` + `storage`; `src/openings.js` matches against
  `vendor/openings/index.js` (3,865 lines, all 500 ECO codes, rebuilt by
  `scripts/build-openings.mjs` from pinned TSVs).
- Vendored and pinned with SHA-256s in `vendor/versions.json`: Stockfish.js 19.0.1 Lite
  single-threaded WASM (plus its full corresponding source archive and NNUE network for GPL
  compliance) and chess.js 1.4.0. Cburnett piece SVGs with attribution. Never edit upstream
  files to work around app bugs; bump versions through `scripts/vendor.mjs` and update the
  version checks, notices, and tests together.

## Commands

```sh
npm test               # node --test tests/*.test.js tests/*.test.mjs
npm run test:smoke     # exercises the bundled WASM engine
npm start              # preview at http://127.0.0.1:4173 (PORT to change)
npm run package        # dist/elo-pal.zip, reproducible, no external deps
node .github/scripts/validate-release.mjs   # version/metadata/bundle checks (CI runs it)
```

Load the repo folder as an unpacked extension at `chrome://extensions` to test the toolbar
import; reload the extension and refresh the review tab after edits.

## Release

- Versions must match in `manifest.json`, `package.json`, and `package-lock.json`, with a
  CHANGELOG entry. Pushing a `vX.Y.Z` tag on a `main` commit runs `.github/workflows/release.yml`,
  which publishes `elo-pal.zip` and `SHA256SUMS` as release assets. CI runs on Ubuntu and
  Windows with Node 24.
- Current: v1.8.1 (Oct 26, 2026), a packaging fix so the ZIP has a single root
  `manifest.json`; it was rejected by the Chrome Web Store uploader before that. Whether the
  Web Store listing has gone live since is unknown; until it has, documentation and the
  cowcatbird.com card must say "Load unpacked" and link the GitHub release, not "Add to Chrome".

## Rules that shape changes

- Everything stays local: no accounts, analysis servers, CDNs, analytics, or broad host
  permissions. Lichess import may make one public same-origin PGN request; nothing else
  leaves the machine. Any change to permissions or data handling must update PRIVACY.md
  and the README.
- Imports are validated and fail with a specific message; manual PGN/FEN import always
  remains available. Variants (Chess960 etc.) are unsupported by the Lite engine.
- Grades and accuracy are this project's own estimates. Never describe them as Chess.com's
  formula, and never present a legal candidate move as an engine recommendation.
- Keep keyboard navigation, readable text, and room for the board. Interface PRs include
  a screenshot checked at narrow and wide widths.
- Tests use minimal legal positions and cover edge cases (Black to move, checks,
  promotions, stale engine results).

## cowcatbird context

Branding is lowercase "cowcatbird" with the pink Coach Cat portrait, which is a generated
raster derived from the owner's logo (no vector source exists). The project card on
cowcatbird.com shows `docs/images/coach-advice.png` (Opera Game demo, 1280×720) and links
to the latest release. Keep public screenshots free of real user games.
