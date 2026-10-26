import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const json = async filename => JSON.parse(await readFile(new URL(filename, root), 'utf8'));
const [pkg, lock, manifest] = await Promise.all([
  json('package.json'), json('package-lock.json'), json('manifest.json'),
]);

assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Use a three-part release version.');
assert.equal(manifest.version, pkg.version, 'Manifest and package versions must match.');
assert.equal(lock.version, pkg.version, 'Lockfile and package versions must match.');
assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root version must match.');
assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies, 'Lockfile dependencies must match.');

const tag = process.argv[2];
if (tag !== undefined) {
  assert.equal(tag, `v${pkg.version}`, 'The release tag must match the packaged version.');
}

const source = await json('vendor/stockfish-source/provenance.json');
assert.equal(source.version, pkg.dependencies.stockfish, 'Stockfish source and dependency versions must match.');
for (const filename of [`stockfish.js-v${source.version}.tar.gz`, 'CC0-1.0.txt']) {
  assert.ok(source.files.some(file => file.path === filename), `Missing source manifest entry: ${filename}`);
}
assert.ok(source.files.some(file => /^nn-[0-9a-f]+\.nnue$/.test(file.path)), 'The required neural network must be supplied.');
for (const filename of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  assert.ok(source.distributedBinaries.some(file => file.path === `vendor/stockfish/${filename}`), `Missing binary manifest entry: ${filename}`);
}

async function verifyFile(relative, expected) {
  assert.match(relative, /^[a-zA-Z0-9_./-]+$/, 'Manifest paths must be local relative paths.');
  assert.ok(!relative.startsWith('/') && !relative.split('/').includes('..'), 'Manifest paths must stay inside the repository.');
  const bytes = await readFile(new URL(relative, root));
  if (expected.bytes !== undefined) assert.equal(bytes.length, expected.bytes, `Size mismatch: ${relative}`);
  assert.match(expected.sha256, /^[0-9a-f]{64}$/, `Invalid SHA-256: ${relative}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, `SHA-256 mismatch: ${relative}`);
}

await Promise.all([
  ...source.files.map(file => verifyFile(`vendor/stockfish-source/${file.path}`, file)),
  ...source.distributedBinaries.map(file => verifyFile(file.path, file)),
]);

console.log(`Validated Elo Pal ${pkg.version}${tag ? ` (${tag})` : ''}, corresponding source, and bundled engine checksums.`);
