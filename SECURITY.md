# Security policy

## Supported versions

Security fixes target the latest public release and the current default branch. Older releases may remain available for reference but do not have a separate maintenance commitment. Update to the latest release before checking whether an issue still occurs.

## Report a vulnerability privately

Use GitHub's [Report a vulnerability](https://github.com/cowcatbird/elo-pal/security/advisories/new) form for this repository. Do not put exploit details, credentials, or private game data in a public issue.

Include the affected version, a concise description, reproduction steps, expected impact, and a minimal proof of concept when available. Sanitize screenshots, PGN headers, console output, and URLs. There is no guaranteed response time or bug bounty.

If private reporting is unavailable, open a public issue saying only that you need a private security contact, without vulnerability details, and wait for a maintainer to provide a private channel.

## Areas of interest

- Imported PGN, FEN, website content, and engine output are untrusted input.
- Website import should be limited to the clicked supported tab, with no ongoing monitoring or broader host permissions.
- Lichess exports should remain same-origin requests without account credentials or redirects.
- Imported games should pass through short-lived extension session storage, not URL parameters containing PGN.
- The review page should render imported text safely, load bundled assets, and retain its extension content security policy.
- Dependency updates should preserve pinned versions, source provenance, and license notices.

Avoid testing against other people's accounts or disrupting Chess.com, Lichess, GitHub, or other services. Use local fixtures and your own test data whenever possible.

For ordinary incorrect move grades, import compatibility problems, or coaching inaccuracies without a security impact, use the public [issue tracker](https://github.com/cowcatbird/elo-pal/issues).
