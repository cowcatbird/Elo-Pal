// A dependency-free, deterministic ZIP builder for the unpacked Chrome extension.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { collectPackageFiles, assertSingleExtensionManifest } from './package-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

const filenames = await collectPackageFiles(root);
assertSingleExtensionManifest(filenames);
for (const required of ['manifest.json', 'background.js', 'index.html', 'styles.css', 'review-features.css', 'src/app.js', 'src/line-session.js', 'src/move-icons.js', 'src/move-sounds.js', 'src/engine.js', 'src/model.js', 'src/coach.js', 'src/openings.js', 'src/import-session.js', 'src/chesscom-extractor.js', 'src/chesscom-import.js', 'assets/coach-cat.png', 'vendor/chess.js', 'vendor/openings/index.js', 'vendor/openings/provenance.json', 'vendor/openings/source/COPYING.txt']) {
  if (!filenames.includes(required)) throw new Error(`Cannot package an incomplete extension: missing ${required}`);
}
for (const required of ['src/lichess-extractor.js', 'src/import-sources.js', 'src/position-advice.js', 'assets/cowcatbird-logo.png', 'SOURCES.md', 'PRIVACY.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'vendor/stockfish-source/provenance.json', 'vendor/stockfish-source/README.md']) {
  if (!filenames.includes(required)) throw new Error(`Cannot package an incomplete extension: missing ${required}`);
}
if (!filenames.some(filename => filename.startsWith('vendor/') && filename.endsWith('.wasm'))) {
  throw new Error('Cannot package an incomplete extension: the bundled Stockfish WebAssembly file is missing.');
}
for (const side of ['w', 'b']) {
  for (const piece of ['k', 'q', 'r', 'b', 'n', 'p']) {
    const filename = `assets/pieces/${side}${piece}.svg`;
    if (!filenames.includes(filename)) throw new Error(`Cannot package an incomplete extension: missing ${filename}`);
  }
}
for (const filename of ['vendor/pieces/README.md', 'vendor/pieces/provenance.json', 'vendor/pieces/UPSTREAM_COPYING.md', 'vendor/pieces/GPL-2.0.txt']) {
  if (!filenames.includes(filename)) throw new Error(`Cannot package without the chess piece attribution: missing ${filename}`);
}
const bodies = [];
const directoryRecords = [];
let offset = 0;
for (const filename of filenames) {
  const name = Buffer.from(filename);
  const bytes = await readFile(path.join(root, filename));
  const compressed = deflateRawSync(bytes);
  const checksum = crc32(bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 filenames.
  local.writeUInt16LE(8, 8); // Deflate.
  local.writeUInt16LE(0x0021, 12); // Stable 1980-01-01 timestamp.
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(name.length, 26);
  bodies.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0x0021, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  directoryRecords.push(central, name);
  offset += local.length + name.length + compressed.length;
}

const directory = Buffer.concat(directoryRecords);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(filenames.length, 8);
end.writeUInt16LE(filenames.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const output = path.join(root, 'dist', 'elo-pal.zip');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, Buffer.concat([...bodies, directory, end]));
console.log(`Packaged ${filenames.length} files into ${output}`);
