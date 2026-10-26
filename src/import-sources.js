/** Recognize a supported HTTPS origin without accepting credentials or ports. */
export function importSource(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  const authority = value.match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i)?.[1]?.toLowerCase();
  // Inspect the raw authority too: URL normalizes an explicit :443 to no port.
  if (!['chess.com', 'www.chess.com', 'lichess.org', 'www.lichess.org'].includes(authority)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
    const isChesscom = parsed.hostname === 'chess.com' || parsed.hostname === 'www.chess.com';
    const source = isChesscom ? 'chess.com' : 'lichess.org';
    const host = isChesscom ? 'www.chess.com' : 'lichess.org';
    return { source, label: isChesscom ? 'Chess.com' : 'Lichess', url: `https://${host}${parsed.pathname.replace(/\/+$/, '') || '/'}` };
  } catch { return null; }
}

/** Provider-scoped identity. Lichess private player tokens never enter the key. */
export function sourceGameReference(value) {
  const provider = importSource(value);
  if (!provider) return null;
  const path = new URL(provider.url).pathname;
  if (provider.source === 'chess.com') {
    const match = path.match(/^\/(?:analysis\/)?game\/(live|daily)\/(\d+)(?:\/|$)/);
    if (!match) return null;
    return { source: provider.source, kind: 'game', gameType: match[1], id: match[2], key: `${provider.source}:${match[1]}:${match[2]}` };
  }
  const study = path.match(/^\/study\/([A-Za-z0-9]{8})(?:\/([A-Za-z0-9]{8}))?$/);
  if (study) {
    return { source: provider.source, kind: 'study', id: study[1], chapterId: study[2] || null, key: `${provider.source}:study:${study[1]}${study[2] ? `:${study[2]}` : ''}` };
  }
  const game = path.match(/^\/(?:game\/)?([A-Za-z0-9]{8}(?:[A-Za-z0-9]{4})?)(?:\/(?:white|black)(?:\/analysis)?)?$/);
  // The bare /analysis route is an eight-letter word, not a game identifier.
  if (!game || (!path.startsWith('/game/') && ['analysis', 'training', 'practice', 'features', 'insights', 'bookmark', 'timeline'].includes(game[1].toLowerCase()))) return null;
  const id = game[1].slice(0, 8);
  return { source: provider.source, kind: 'game', id, key: `${provider.source}:game:${id}` };
}
