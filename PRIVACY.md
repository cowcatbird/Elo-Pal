# Privacy

Elo Pal analyzes chess positions on your device. It has no Elo Pal account system, analytics, advertising, telemetry, cloud AI, or remote analysis service. This document describes the extension distributed from this repository; the websites you visit and GitHub have their own privacy practices.

## Data used by the extension

| Data | Purpose | Storage |
| --- | --- | --- |
| Imported PGN, including its player names and other headers | Reconstruct and display your game | Latest game saved in extension-page local storage |
| Analysis depth, board orientation, and sound preference | Restore your settings | Extension-page local storage |
| Import result, source URL, and import method | Transfer a toolbar import to its new review tab | Extension session storage |
| Engine evaluations and explored lines | Show the current review and variations | Application memory during the session |

The saved workspace uses the local-storage key `rook.workspace`, retained from the project's earlier internal name. It is not sent through Chrome Sync or uploaded by Elo Pal. Loading another game replaces the saved game's PGN. PGN headers can contain personal information, so review them before sharing exported files or bug reports.

Toolbar handoffs are consumed once and removed when the review tab reads them. Handoffs older than 15 minutes are rejected; later imports also prune stale or excess records. This is a validity limit, not a promise of deletion exactly 15 minutes after creation. Session storage is temporary browser-session data. The review-tab URL contains a random handoff identifier, not your PGN.

## Website access and network requests

Clicking the extension button grants temporary access to the selected tab through `activeTab`. `scripting` runs the appropriate importer once on a supported Chess.com or Lichess page. The extension does not continuously watch the board, request browsing history, or hold persistent website permissions.

- **Chess.com:** the importer reads the current game's available PGN/history and main move list from the clicked page. It does not send the game to an analysis service.
- **Lichess games and public study chapters:** the importer may request that game's or chapter's public PGN from the same Lichess origin. The request omits account credentials, rejects redirects, and does not send the game to a third-party analysis provider. Lichess still receives normal network request information, such as an IP address and the requested resource.
- **Lichess standalone analysis boards:** the importer reads the page's displayed PGN field when available.
- **Manual import:** pasted PGN/FEN and selected local PGN files are processed locally.

The `storage` permission supports the import handoff. The extension requests no account credentials. Private Lichess studies may require you to download the PGN yourself and import it manually.

Stockfish, chess rules, opening data, graphics, styles, and generated move sounds are bundled or produced locally. Analysis works without a network connection after installation. Website import needs the source page and may need its export endpoint. External links you choose to open are handled by the browser under the destination site's policies.

## Delete your data

The extension keeps its latest game and preferences in the current browser profile until overwritten or cleared. To clear them, open an Elo Pal review tab, open Chrome DevTools, go to **Application → Storage**, and clear the extension page's local storage/site data. Removing the extension from `chrome://extensions` also removes its extension storage. Close open review tabs when clearing data so their in-memory state is not saved again.

Exported PGN files and downloaded release archives are ordinary files on your computer; delete them separately if desired. Copies you share elsewhere are outside the extension's control.

## Development and feedback

The optional development preview uses its own `http://127.0.0.1` browser storage, separate from the installed extension. Clear that site's data separately if you used it. Installing npm dependencies or downloading releases uses the relevant package registry or GitHub; those operations are separate from local game analysis.

GitHub issues and pull requests are public. Share only the information you intend to publish. For privacy-related vulnerabilities, follow [SECURITY.md](SECURITY.md); for other questions, use the [issue tracker](https://github.com/cowcatbird/elo-pal/issues).
