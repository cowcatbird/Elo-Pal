import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, parseInfo } from '../src/engine.js';

const WHITE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const tick = () => new Promise(resolve => setImmediate(resolve));

class FakeWorker {
  commands = [];
  terminated = false;
  postMessage(command) {
    this.commands.push(command);
    if (command === 'uci') queueMicrotask(() => this.emit('uciok'));
    if (command === 'isready') queueMicrotask(() => this.emit('readyok'));
  }
  emit(message) { this.onmessage?.({ data: message }); }
  terminate() { this.terminated = true; }
}
function setup() {
  const worker = new FakeWorker();
  return { worker, engine: new Engine({ workerFactory: () => worker }) };
}

test('UCI centipawns and mate are converted to White perspective', () => {
  assert.equal(parseInfo('info depth 12 score cp 56 pv e7e5 g1f3', 'b').cp, -56);
  assert.equal(parseInfo('info depth 12 score mate -3 pv e7e5', 'b').mate, 3);
  assert.equal(parseInfo('info depth 12 score cp 56 lowerbound pv e7e5', 'b'), null);
  assert.equal(parseInfo('info depth 12 currmove e7e5', 'b'), null);
});

test('initialization is shared and final result returns sorted multipv lines', async () => {
  const { worker, engine } = setup();
  await Promise.all([engine.init(), engine.init()]);
  assert.equal(worker.commands.filter(command => command === 'uci').length, 1);
  const updates = [];
  const analysis = engine.analyze(BLACK, { onInfo: line => updates.push(line), depth: 10 });
  await tick();
  worker.emit('info depth 8 multipv 2 score cp -30 nodes 100 pv c7c5 g1f3');
  worker.emit('info depth 10 multipv 1 score cp 25 nodes 1000 pv e7e5 g1f3');
  worker.emit('bestmove e7e5 ponder g1f3');
  const result = await analysis;
  assert.equal(result.bestmove, 'e7e5');
  assert.equal(result.depth, 10);
  assert.deepEqual(result.lines.map(line => line.multipv), [1, 2]);
  assert.equal(result.lines[0].cp, -25);
  assert.equal(updates.length, 2);
  engine.destroy();
});

test('cancel rejects promptly but drains old bestmove before a new search', async () => {
  const { worker, engine } = setup();
  const first = engine.analyze(WHITE);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await tick();
  engine.cancel();
  await rejected;
  const second = engine.analyze(BLACK);
  await tick();
  assert.equal(worker.commands.filter(command => command.startsWith('go ')).length, 1);
  assert.equal(worker.commands.at(-1), 'stop');
  worker.emit('info depth 99 score cp 999 pv a2a4');
  worker.emit('bestmove a2a4');
  await tick();
  assert.equal(worker.commands.filter(command => command.startsWith('go ')).length, 2);
  worker.emit('info depth 9 score cp 31 pv e7e5');
  worker.emit('bestmove e7e5');
  const result = await second;
  assert.equal(result.bestmove, 'e7e5');
  assert.equal(result.lines[0].cp, -31);
  engine.destroy();
});

test('cancel also rejects queued searches and later requests still work', async () => {
  const { worker, engine } = setup();
  const first = engine.analyze(WHITE);
  const second = engine.analyze(BLACK);
  const rejected = Promise.all([assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })]);
  await tick();
  engine.cancel();
  await rejected;
  worker.emit('bestmove e2e4');
  await tick();
  assert.equal(worker.commands.filter(command => command.startsWith('go ')).length, 1);
  engine.destroy();
});

test('history is sent in UCI notation and malformed commands are rejected', async () => {
  const { worker, engine } = setup();
  await assert.rejects(engine.analyze(`${WHITE}\nquit`), /FEN/);
  await assert.rejects(engine.analyze(WHITE, { moves: ['e2e4\nquit'] }), /UCI/);
  const result = engine.analyze(BLACK, { startFen: WHITE, moves: ['e2e4'], multiPV: 3 });
  await tick();
  assert.ok(worker.commands.includes(`position fen ${WHITE} moves e2e4`));
  worker.emit('bestmove (none)');
  assert.equal((await result).bestmove, null);
  engine.destroy();
});

test('worker errors reject analysis and a fresh worker can be initialized', async () => {
  const workers = [];
  const engine = new Engine({ workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  const first = engine.analyze(WHITE);
  const rejected = assert.rejects(first, /worker failed/);
  await tick();
  workers[0].onerror({ message: 'worker failed' });
  await rejected;
  const second = engine.analyze(WHITE);
  await tick();
  assert.equal(workers.length, 2);
  workers[1].emit('bestmove e2e4');
  assert.equal((await second).bestmove, 'e2e4');
  engine.destroy();
});

test('destroy rejects in-flight work and prevents reuse', async () => {
  const { worker, engine } = setup();
  const result = engine.analyze(WHITE);
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await tick();
  engine.destroy();
  await rejected;
  assert.equal(worker.terminated, true);
  await assert.rejects(engine.analyze(WHITE), /closed/);
});
