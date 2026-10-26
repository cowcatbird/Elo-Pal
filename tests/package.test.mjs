import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { collectPackageFiles, assertSingleExtensionManifest } from '../scripts/package-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'elo-pal-package-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('elo-pal-package-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function copyInto(directory, filenames) {
  for (const filename of filenames) {
    const target = path.join(directory, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, filename), target);
  }
}

function packageFixture(directory) {
  return spawnSync(process.execPath, [path.join(directory, 'scripts/package.mjs')], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function zipFilenames(bytes) {
  // The packager writes an ordinary ZIP with no archive comment.
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const names = [];
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, end);
  return names;
}

test('packaging requires a single correctly named root extension manifest', () => {
  assert.doesNotThrow(() => assertSingleExtensionManifest(['manifest.json', 'vendor/pieces/provenance.json']));
  for (const files of [
    [],
    ['vendor/manifest.json'],
    ['Manifest.json'],
    ['manifest.json', 'manifest.json'],
    ['manifest.json', 'vendor/pieces/manifest.json'],
    ['manifest.json', 'vendor\\pieces\\MANIFEST.JSON'],
  ]) {
    assert.throws(() => assertSingleExtensionManifest(files), /expected exactly one manifest\.json at the archive root/);
  }
});

test('real packager rejects a nested case-insensitive manifest before producing a ZIP', async t => {
  const directory = await fixture(t);
  await copyInto(directory, ['scripts/package.mjs', 'scripts/package-files.mjs']);
  await mkdir(path.join(directory, 'vendor', 'pieces'), { recursive: true });
  await writeFile(path.join(directory, 'manifest.json'), '{}');
  await writeFile(path.join(directory, 'vendor', 'pieces', 'Manifest.JSON'), '{}');

  const result = packageFixture(directory);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected exactly one manifest\.json at the archive root/);
  assert.match(result.stderr, /vendor\/pieces\/Manifest\.JSON/);
  await assert.rejects(stat(path.join(directory, 'dist', 'elo-pal.zip')), { code: 'ENOENT' });
});

test('current distributable ZIP includes only the extension manifest and preserves provenance and licenses', async t => {
  const directory = await fixture(t);
  const files = await collectPackageFiles(root);
  await copyInto(directory, files);
  const result = packageFixture(directory);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);

  const names = zipFilenames(await readFile(path.join(directory, 'dist', 'elo-pal.zip')));
  assert.deepEqual(names.filter(name => path.posix.basename(name).toLowerCase() === 'manifest.json'), ['manifest.json']);
  assert.deepEqual(names, files);
  for (const required of [
    'vendor/pieces/provenance.json',
    'vendor/pieces/GPL-2.0.txt',
    'vendor/pieces/UPSTREAM_COPYING.md',
    'vendor/stockfish-source/provenance.json',
    'vendor/stockfish-source/stockfish.js-v19.0.1.tar.gz',
    'vendor/stockfish-source/nn-61e7af4bb97d.nnue',
    'vendor/STOCKFISH_LICENSE.txt',
    'LICENSE',
  ]) {
    assert.ok(names.includes(required), `The distributable must retain ${required}`);
  }
});
