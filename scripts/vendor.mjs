import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'vendor');
const stockfish = path.join(root, 'node_modules', 'stockfish');
const chess = path.join(root, 'node_modules', 'chess.js');

async function findFile(folder, name) {
  const entries = await readdir(folder, { withFileTypes: true });
  const file = entries.find(entry => entry.isFile() && entry.name === name);
  if (file) return path.join(folder, file.name);
  for (const entry of entries.filter(entry => entry.isDirectory() && entry.name !== 'node_modules')) {
    const found = await findFile(path.join(folder, entry.name), name);
    if (found) return found;
  }
  return null;
}

async function copyNamed(folder, name, destination) {
  const source = await findFile(folder, name);
  if (!source) throw new Error(`Required dependency file ${name} was not found. Run npm install first.`);
  await copyFile(source, path.join(vendor, destination));
}

await mkdir(path.join(vendor, 'stockfish'), { recursive: true });
const sfPackage = JSON.parse(await readFile(path.join(stockfish, 'package.json'), 'utf8'));
const chessPackage = JSON.parse(await readFile(path.join(chess, 'package.json'), 'utf8'));
if (sfPackage.version !== '19.0.1' || chessPackage.version !== '1.4.0') {
  throw new Error('Dependency versions do not match the reviewed pinned versions. Run npm ci.');
}
await copyFile(path.join(chess, 'dist', 'esm', 'chess.js'), path.join(vendor, 'chess.js'));
await copyNamed(chess, 'LICENSE', 'CHESS_JS_LICENSE.txt');
await copyNamed(stockfish, 'stockfish-19-lite-single.js', 'stockfish/stockfish-19-lite-single.js');
await copyNamed(stockfish, 'stockfish-19-lite-single.wasm', 'stockfish/stockfish-19-lite-single.wasm');
await copyNamed(stockfish, 'Copying.txt', 'STOCKFISH_LICENSE.txt');
await copyFile(path.join(stockfish, 'README.md'), path.join(vendor, 'STOCKFISH_README.md'));

const files = ['chess.js', 'CHESS_JS_LICENSE.txt', 'STOCKFISH_LICENSE.txt', 'STOCKFISH_README.md',
  'stockfish/stockfish-19-lite-single.js', 'stockfish/stockfish-19-lite-single.wasm'];
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(path.join(vendor, file))).digest('hex');
await writeFile(path.join(vendor, 'versions.json'), JSON.stringify({
  stockfish: { version: sfPackage.version, license: sfPackage.license, source: 'https://github.com/nmrugg/stockfish.js',
    variant: 'Stockfish 19 lite single-threaded', gitHead: sfPackage.gitHead || null },
  chessjs: { version: chessPackage.version, license: chessPackage.license, source: 'https://github.com/jhlywa/chess.js' },
  sha256: hashes,
}, null, 2) + '\n');
console.log('Bundled chess.js 1.4.0 and Stockfish 19.0.1 lite single-threaded with licenses.');
