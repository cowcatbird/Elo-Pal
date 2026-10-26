// Exercise the exact bundled JS/WASM using the same Engine UCI adapter as the UI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Engine } from '../src/engine.js';
import { Chess } from '../vendor/chess.js';
import { evaluateMove } from '../src/model.js';

const dir = await mkdtemp(path.join(tmpdir(), 'rook-engine-smoke-'));
const filename = 'stockfish-19-lite-single';
const files = [`${filename}.js`, `${filename}.wasm`, 'package.json'];
const source = fileURLToPath(new URL('../vendor/stockfish/', import.meta.url));
let engine;
try {
  await Promise.all(files.slice(0, 2).map(file => copyFile(path.join(source, file), path.join(dir, file))));
  await writeFile(path.join(dir, 'package.json'), '{"type":"commonjs"}');
  const workerFactory = () => {
    const child = spawn(process.execPath, [path.join(dir, `${filename}.js`)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const worker = { postMessage(command) { child.stdin.write(`${command}\n`); }, terminate() { child.kill(); } };
    createInterface({ input: child.stdout }).on('line', line => worker.onmessage?.({ data: line }));
    child.on('error', error => worker.onerror?.({ message: error.message }));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    return worker;
  };
  engine = new Engine({ workerFactory, timeoutMs: 20_000 });
  await engine.init();
  const chess = new Chess();
  const opening = await engine.analyze(chess.fen(), { depth: 10, movetime: 700, multiPV: 2 });
  assert.equal(opening.lines.length, 2);
  assert.ok(opening.depth >= 5);
  assert.ok(Number.isFinite(opening.lines[0].cp));
  assert.ok(chess.move({ from: opening.bestmove.slice(0, 2), to: opening.bestmove.slice(2, 4), promotion: opening.bestmove[4] }));
  console.log(`Start position: ${opening.bestmove}, depth ${opening.depth}, White cp ${opening.lines[0].cp}; 2 principal variations.`);

  const mating = new Chess('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
  const mate = await engine.analyze(mating.fen(), { depth: 10, movetime: 500, multiPV: 1 });
  assert.equal(mate.lines[0].mate, 1);
  mating.move({ from: mate.bestmove.slice(0, 2), to: mate.bestmove.slice(2, 4), promotion: mate.bestmove[4] });
  assert.ok(mating.isCheckmate());
  console.log(`Mate-in-one: ${mate.bestmove}, White mate +1; verified legal checkmate.`);

  const critical = new Chess('7k/8/8/8/8/8/3q4/K2R4 w - - 0 1');
  const candidates = await engine.analyze(critical.fen(), { depth: 16, movetime: 2000, multiPV: 2 });
  assert.equal(candidates.bestmove, 'd1d2');
  const played = critical.move('Rxd2');
  const continuation = await engine.analyze(critical.fen(), { depth: 16, movetime: 2000, multiPV: 2 });
  const grade = evaluateMove({ ...candidates.lines[0], lines: candidates.lines }, continuation.lines[0], played, candidates.bestmove);
  assert.equal(grade.key, 'great');
  assert.ok(grade.great.gap >= 200);
  console.log(`Great-move review: Rxd2, ${grade.great.alternative.san} is the next engine candidate; gap ${grade.great.gap} cp.`);

  const running = engine.analyze(new Chess().fen(), { depth: 30, movetime: 4000 });
  const rejected = assert.rejects(running, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 100));
  engine.cancel();
  await rejected;
  const afterCancel = await engine.analyze(chess.fen(), { depth: 8, movetime: 300, multiPV: 1 });
  assert.ok(afterCancel.bestmove);
  console.log(`Cancellation and restart: ${afterCancel.bestmove}, depth ${afterCancel.depth}.`);
} finally {
  engine?.destroy();
  // Remove only the three known temporary files, then the empty folder.
  await new Promise(resolve => setTimeout(resolve, 100));
  for (const file of files) await unlink(path.join(dir, file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(dir);
}
