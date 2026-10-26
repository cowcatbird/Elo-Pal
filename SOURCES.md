# Source and build materials

Elo Pal's release ZIP includes its editable application source and the materials below. The public repository also contains tests, release workflows, documentation, and these same vendored materials. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and license terms, and [README.md](README.md) for installation and development.

| Component | Included source and build materials |
| --- | --- |
| Elo Pal | `src/`, `background.js`, HTML/CSS, `assets/`, `scripts/`, `package.json`, and `package-lock.json`. The browser loads these application files directly; no app bundler or remote script is required. |
| Stockfish.js 19.0.1 Lite single-threaded | [Complete pinned source archive, required NNUE network, build instructions, and hashes](vendor/stockfish-source/README.md). The source archive includes the C++ engine, WebAssembly glue, Makefiles, upstream build script, author list, and license notices. |
| chess.js 1.4.0 | The unmodified readable ESM distribution is `vendor/chess.js`. Its [upstream TypeScript source](https://github.com/jhlywa/chess.js/tree/v1.4.0) is available under the bundled BSD-2-Clause license. `npm ci` and `npm run vendor` restore the pinned distribution. |
| Cburnett pieces | `assets/pieces/*.svg` are the original editable SVG sources. [Provenance, attribution, hashes, and license](vendor/pieces/README.md) are included. |
| Opening book | The original A–E TSV files are in `vendor/openings/source/`. Run `node scripts/build-openings.mjs` to regenerate the offline index from them. The [provenance record](vendor/openings/provenance.json) pins the upstream revision and source hashes. |
| Project artwork | SVG artwork and original supplied/generated PNG assets are included in `assets/`. Coach Cat is a generated raster asset based on the owner-provided cowcatbird logo; no separate vector or layered source exists in this project. |

## Stockfish source availability

The exact engine source is shipped alongside the engine in every official extension ZIP. It is not necessary to rely on a moving upstream branch or obtain source through a written-offer process. The source archive is pinned to commit `0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6`, the commit behind `v19.0.1`; its matching Lite neural network is also included. [The manifest](vendor/stockfish-source/manifest.json) records source and binary hashes.

If you redistribute Elo Pal or its engine, keep the applicable license notices, complete corresponding source/build materials, and your changes available in accordance with the component licenses. Do not remove the source archive or required network from a binary-only redistribution without arranging another compliant source distribution.

The ordinary application build reuses the unmodified published engine files. Recompiling Stockfish is optional for application development and is documented separately in [the engine source guide](vendor/stockfish-source/README.md).
