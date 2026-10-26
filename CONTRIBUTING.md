# Contributing to Elo Pal

Bug reports, accessibility improvements, chess-analysis fixes, and focused pull requests are welcome. For a substantial feature, open an issue first so its behavior and scope can be discussed.

## Report a bug

Use the [issue tracker](https://github.com/cowcatbird/elo-pal/issues). Include:

- Your Elo Pal version, Chrome version, and operating system.
- The steps to reproduce, expected result, and actual result.
- A minimal PGN or FEN when the problem depends on a position.
- A screenshot or console error if it helps explain the issue.

Remove personal information from PGN headers, screenshots, logs, and URLs before sharing them. Never include account credentials or private game/study links. Use the private process in [SECURITY.md](SECURITY.md) for vulnerabilities.

## Work locally

Clone the repository and use Node.js 20 or later; CI uses Node.js 24 on Linux and Windows. All runtime files needed for preview and tests are included in `vendor/`; normal development does not require a network dependency install.

```sh
npm test
npm run test:smoke
npm start
```

The preview is at `http://127.0.0.1:4173`. For toolbar import changes, load the repository as an unpacked extension using the [README instructions](README.md#install-in-google-chrome). Reload the extension and refresh its review tab after changing files.

## Project layout

| Location | Responsibility |
| --- | --- |
| `background.js`, `manifest.json` | Toolbar action, permissions, and extension configuration |
| `src/app.js`, `index.html`, CSS files | Review interface and application state |
| `src/model.js` | Game parsing and review classification |
| `src/engine.js` | Local Stockfish worker integration |
| `src/coach.js`, `src/position-advice.js` | Coach explanations and position-specific advice |
| `src/*extractor.js`, `src/*import*.js` | Website extraction, validation, and import handoff |
| `src/openings.js`, `vendor/openings/` | Opening matching, guidance, and pinned data |
| `assets/`, `vendor/pieces/` | Bundled artwork, chess pieces, and attribution |
| `tests/`, `scripts/` | Automated checks, preview, vendoring, and packaging |
| `.github/` | Issue templates, continuous integration, and release automation |

## Prepare a pull request

1. Keep the change focused and describe the user-visible problem it fixes.
2. Add or adjust meaningful tests for behavior changes. Use legal, minimal chess positions; include edge cases such as Black to move, checks, promotions, or stale engine results when relevant.
3. Run `npm test` and `npm run test:smoke`. Run `npm run package` to verify distributable files remain complete.
4. For interface changes, check narrow and wide desktop windows, readable text, keyboard access, move navigation, and visible playback controls. Include a screenshot in the pull request.
5. For import changes, test supported pages and rejection paths. Preserve one-time, user-initiated access and manual-import fallback.
6. Update user-facing documentation when behavior, permissions, data handling, or installation changes.

Do not commit `node_modules/`, generated release ZIPs, local browser state, private PGNs, credentials, or machine-specific paths. Keep public screenshots free of personal data. Vendored runtime files are intentional; retain their attribution and provenance.

## Dependencies and generated data

Dependency versions are pinned. To refresh the existing vendored runtime intentionally:

```sh
npm ci --ignore-scripts
npm run vendor
```

Review changes to `vendor/versions.json`, license notices, runtime files, and tests together. A version upgrade also requires updating version checks in the vendoring script and relevant documentation. Do not edit upstream engine or chess.js files to work around application bugs. Preserve the engine's corresponding source and network files in public distributions.

Rebuild the opening index from the included pinned TSV files with:

```sh
node scripts/build-openings.mjs
```

Keep source data, generated data, hashes, and upstream attribution consistent. New third-party assets must have a compatible license and a recorded source.

## Release process

Maintainers update the versions in `manifest.json`, `package.json`, and `package-lock.json` together, refresh visible version labels, and document changes in [CHANGELOG.md](CHANGELOG.md). Before release, run:

```sh
node .github/scripts/validate-release.mjs
npm test
npm run test:smoke
npm run package
```

Test the resulting archive as an unpacked extension. A pushed `vX.Y.Z` tag triggers the release workflow; the tag must match the metadata version and point to a commit on `main`. The workflow publishes `elo-pal.zip` and `SHA256SUMS` as GitHub Release assets. The ZIP includes the engine's corresponding source archive and network file. A local packaging command alone does not publish anything.

## Design principles

- Keep analysis local and usable without accounts or paid services.
- Validate imported content and engine continuations before using them.
- Keep advice tied to the displayed position; do not invent tactical certainty or imply a legal candidate is an engine recommendation.
- Explain the limits of custom move grades and accuracy estimates.
- Preserve keyboard navigation, clear text, and room for the board and moves.

Contributions to original project files are submitted under the project's [GPL-3.0-only license](LICENSE). Preserve the licenses and notices of third-party material. Be constructive and respectful in issues and reviews.
