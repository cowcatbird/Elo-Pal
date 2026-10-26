# Third-party notices

Elo Pal bundles a chess engine and chess rules library so that analysis can run without a network connection. Dependency versions and SHA-256 hashes are recorded in [vendor/versions.json](vendor/versions.json). These dependencies retain their original licenses.

## Stockfish.js 19.0.1 — Stockfish 19 Lite, single-threaded

Stockfish.js is maintained by Nathan Rugg and incorporates work by the Stockfish authors and contributors. The engine distribution is licensed under the GNU General Public License, version 3. The full license text is preserved in [vendor/STOCKFISH_LICENSE.txt](vendor/STOCKFISH_LICENSE.txt).

Elo Pal includes these unmodified files from the pinned npm package `stockfish@19.0.1`:

- `vendor/stockfish/stockfish-19-lite-single.js`
- `vendor/stockfish/stockfish-19-lite-single.wasm`

The Lite build has a smaller neural network than full Stockfish and does not require WebAssembly threads or shared memory.

- [Exact upstream release v19.0.1](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1), commit `0d5dd79`.
- [Source tree for v19.0.1](https://github.com/nmrugg/stockfish.js/tree/v19.0.1).
- [Download the upstream source archive for v19.0.1](https://github.com/nmrugg/stockfish.js/archive/refs/tags/v19.0.1.tar.gz).
- [Build instructions for v19.0.1](https://github.com/nmrugg/stockfish.js/blob/v19.0.1/README.md#how-do-i-compile-the-engine).
- [Build script for v19.0.1](https://github.com/nmrugg/stockfish.js/blob/v19.0.1/build.js).
- [Exact npm distribution archive](https://registry.npmjs.org/stockfish/-/stockfish-19.0.1.tgz).

The complete upstream source archive at commit `0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6` and the required `nn-61e7af4bb97d.nnue` Lite network are included in [vendor/stockfish-source/](vendor/stockfish-source/README.md), together with build instructions and SHA-256 hashes. The source archive retains upstream authors and license notices, including GPL version 3-or-later notices in engine source files and the upstream README's MIT notice for non-engine code. These permissions are not narrowed by Elo Pal's license.

The upstream command for this variant is `node build.js --single-threaded --lite -f`, using Emscripten 6.0.9 and the pinned npm build dependency. A copy of the installed package's [README and build instructions](vendor/STOCKFISH_README.md) is also included. Elo Pal uses the published prebuilt files; it has not independently recompiled them. The Lite network comes from Stockfish's official network endpoint under [Fishtest's CC0 upload terms](https://github.com/official-stockfish/fishtest/blob/5a8a229a521b4eaab2ecf19b92f0d2fd6c3be13b/server/fishtest/templates/nn_upload.html.j2); the [CC0 dedication](vendor/stockfish-source/CC0-1.0.txt) is included. See [SOURCES.md](SOURCES.md) before redistributing the engine.

## chess.js 1.4.0

Copyright (c) 2025, Jeff Hlywa. All rights reserved.

The rules, legal move generation, PGN parsing, and FEN handling use the unmodified ESM distribution from `chess.js@1.4.0`, copied to `vendor/chess.js`. chess.js is licensed under the BSD 2-Clause License; the full copyright notice, conditions, and disclaimer are preserved in [vendor/CHESS_JS_LICENSE.txt](vendor/CHESS_JS_LICENSE.txt).

- [Source tree for v1.4.0](https://github.com/jhlywa/chess.js/tree/v1.4.0).
- [Exact npm distribution archive](https://registry.npmjs.org/chess.js/-/chess.js-1.4.0.tgz).

## Lichess chess opening names

The offline opening book is derived from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings/tree/a6189a30dc273ccb21fc2536a9a2fefd5592a67a), pinned at commit `a6189a30dc273ccb21fc2536a9a2fefd5592a67a`. The upstream A–E TSV files, README, and CC0 dedication are included in `vendor/openings/source/`. The dataset is a collection of public-domain facts, with any applicable rights dedicated under CC0. Elo Pal's builder legally replays the reference lines to create an offline position index. Opening plan explanations are original Elo Pal text.

## Graphics

The twelve chess-piece SVGs in `assets/pieces/` are the established **Cburnett** set by **Colin M. L. Burnett**, taken unmodified from [Lichess's source repository](https://github.com/lichess-org/lila/tree/5b44d719ec5913dd62aa965f4b8d21e60a00c2c1/public/piece/cburnett) at commit `5b44d719ec5913dd62aa965f4b8d21e60a00c2c1`. Only filenames are mapped to lowercase. The [upstream license notice](vendor/pieces/UPSTREAM_COPYING.md) assigns this artwork **GPL-2.0-or-later**. The [GPL version 2 text](vendor/pieces/GPL-2.0.txt), [provenance and attribution](vendor/pieces/README.md), and [per-file source URLs and SHA-256 hashes](vendor/pieces/provenance.json) are bundled. These pieces retain their upstream license options and may be distributed with this GPL version 3 project under the later-version option.

The Elo Pal logo, application icons, move badges, and original Coach Rowan SVG were created for this project. The cowcatbird logo in `assets/cowcatbird-logo.png` was supplied by the project owner. Coach Cat in `assets/coach-cat.png` is an AI-generated illustration created for this project from that owner-provided logo reference. Elo Pal's original code, documentation, and project artwork are distributed under GPL-3.0-only; see [LICENSE](LICENSE). The application does not use Chess.com's logos, coach portrait, or piece artwork.

Elo Pal is not affiliated with or endorsed by Chess.com or Lichess. Third-party names and trademarks belong to their respective owners. The software license does not grant trademark rights.
