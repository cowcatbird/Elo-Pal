import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { MoveSounds, classifyMoveSound } from '../src/move-sounds.js';

function lastMove(moves, fen) {
  const board = fen ? new Chess(fen) : new Chess();
  if (fen) {
    const previous = fen.split(' ');
    previous[1] = previous[1] === 'w' ? 'b' : 'w';
    previous[3] = '-';
    assert.equal(new Chess(previous.join(' ')).isCheck(), false, 'Sound fixtures must start from a legal position.');
  }
  let move;
  for (const san of moves) move = board.move(san);
  return move;
}
const normal = () => lastMove(['e4']);
const capture = () => lastMove(['e4', 'd5', 'exd5']);

test('ordinary moves and captures use distinct sound classes', () => {
  assert.equal(classifyMoveSound(normal()), 'move');
  assert.equal(classifyMoveSound(capture()), 'capture');
});

test('en passant is a capture even though its destination was empty', () => {
  const move = lastMove(['e4', 'a6', 'e5', 'd5', 'exd6']);
  assert.ok(move.flags.includes('e'));
  assert.equal(classifyMoveSound(move), 'capture');
});

test('castling and nonchecking promotion have their own sound classes', () => {
  const castle = lastMove(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']);
  const promotion = lastMove(['c8=N'], '7k/2P5/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(classifyMoveSound(castle), 'castle');
  assert.equal(classifyMoveSound(promotion), 'promotion');
});

test('check takes precedence over capture, promotion and castling', () => {
  const check = lastMove(['e4', 'd5', 'Bb5+']);
  const captureCheck = lastMove(['Rxd2+'], '3k4/8/8/8/8/8/3p4/3RK3 w - - 0 1');
  const promotionCheck = lastMove(['c8=Q+'], '7k/2P5/8/8/8/8/8/4K3 w - - 0 1');
  const castleCheck = lastMove(['O-O+'], '5k2/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.equal(classifyMoveSound(check), 'check');
  assert.equal(classifyMoveSound(captureCheck), 'check');
  assert.equal(classifyMoveSound(promotionCheck), 'check');
  assert.equal(classifyMoveSound(castleCheck), 'check');
});

test('checkmate has priority even when the mating move also captures or promotes', () => {
  const captureMate = lastMove(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
  const quietMate = lastMove(['f3', 'e5', 'g4', 'Qh4#']);
  const promotionMate = lastMove(['g8=Q#'], '8/5KPk/7P/6P1/8/8/8/8 w - - 0 1');
  assert.equal(classifyMoveSound(captureMate), 'checkmate');
  assert.equal(classifyMoveSound(quietMate), 'checkmate');
  assert.equal(classifyMoveSound(promotionMate), 'checkmate');
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Minimal public Web Audio surface. Tests inspect lifecycle and audible starts,
// not oscillator frequencies, envelopes, or the implementation's waveform mix.
class FakeParam {
  value = 0;
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  cancelScheduledValues() { return this; }
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  Q = new FakeParam();
  playbackRate = new FakeParam();
  disconnected = false;
  connect(node) { return node; }
  disconnect() { this.disconnected = true; }
}
class FakeSource extends FakeNode {
  constructor(context) { super(); this.context = context; this.stops = []; }
  start(time) { this.context.starts.push({ source: this, time }); }
  stop(time) { this.stops.push(time); }
}
class FakeContext {
  currentTime = 10;
  sampleRate = 44100;
  state = 'running';
  destination = new FakeNode();
  starts = [];
  resumeCalls = 0;
  closeCalls = 0;
  resumeHook = null;
  createGain() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createOscillator() { return new FakeSource(this); }
  createBufferSource() { return new FakeSource(this); }
  createBuffer(channels, frames, sampleRate) {
    const samples = Array.from({ length: channels }, () => new Float32Array(frames));
    return { sampleRate, length: frames, duration: frames / sampleRate, getChannelData: channel => samples[channel] };
  }
  async resume() {
    this.resumeCalls++;
    if (this.resumeHook) return this.resumeHook();
    this.state = 'running';
  }
  async close() { this.closeCalls++; this.state = 'closed'; }
}
function setup(enabled = true) {
  const context = new FakeContext();
  let creations = 0;
  const sounds = new MoveSounds({ enabled, contextFactory: () => { creations++; return context; } });
  return { sounds, context, creations: () => creations };
}

test('muted sounds never create an audio context or start sources', async () => {
  const { sounds, context, creations } = setup(false);
  assert.equal(sounds.enabled, false);
  assert.equal(await sounds.unlock(), false);
  assert.equal(await sounds.play(normal()), false);
  assert.equal(creations(), 0);
  assert.equal(context.starts.length, 0);
  await sounds.destroy();
});

test('play stays silent before a user-gesture unlock and reuses one unlocked context', async () => {
  const { sounds, context, creations } = setup();
  assert.equal(await sounds.play(normal()), false);
  assert.equal(creations(), 0);
  assert.equal(await sounds.unlock(), true);
  assert.equal(await sounds.play(normal()), true);
  assert.ok(context.starts.length > 0);
  assert.equal(await sounds.unlock(), true);
  assert.equal(await sounds.play(capture()), true);
  assert.equal(creations(), 1);
  await sounds.destroy();
});

test('unsupported audio and denied context resume are nonfatal', async () => {
  const unsupported = new MoveSounds({ contextFactory: () => { throw new Error('Web Audio unavailable'); } });
  assert.equal(await unsupported.unlock(), false);
  assert.equal(await unsupported.play(normal()), false);
  await unsupported.destroy();
  const { sounds, context } = setup();
  context.state = 'suspended';
  context.resumeHook = () => Promise.reject(new Error('User activation required'));
  assert.equal(await sounds.unlock(), false);
  assert.equal(context.starts.length, 0);
  assert.equal(await sounds.play(normal()), false);
  context.state = 'running';
  context.resumeHook = null;
  assert.equal(await sounds.unlock(), true);
  assert.equal(await sounds.play(normal()), true);
  await sounds.destroy();
});

for (const action of ['mute', 'stop', 'destroy']) {
  test(`${action} prevents a suspended pending move from sounding after resume`, async () => {
    const { sounds, context } = setup();
    assert.equal(await sounds.unlock(), true);
    const gate = deferred();
    context.state = 'suspended';
    context.resumeHook = () => gate.promise;
    const pending = sounds.play(normal());
    assert.equal(context.starts.length, 0);
    if (action === 'mute') sounds.setEnabled(false);
    else if (action === 'stop') sounds.stop();
    else await sounds.destroy();
    context.state = action === 'destroy' ? 'closed' : 'running';
    gate.resolve();
    assert.equal(await pending, false);
    assert.equal(context.starts.length, 0);
    await sounds.destroy();
  });
}

test('a newer move replaces an older request waiting for audio resume', async () => {
  const { sounds, context } = setup();
  await sounds.unlock();
  const gate = deferred();
  context.state = 'suspended';
  context.resumeHook = () => gate.promise;
  const oldMove = sounds.play(normal());
  const newMove = sounds.play(capture());
  assert.equal(context.starts.length, 0);
  context.state = 'running';
  gate.resolve();
  assert.equal(await oldMove, false);
  assert.equal(await newMove, true);
  assert.ok(context.starts.length > 0);
  await sounds.destroy();
});

test('muting already-playing audio stops it and later unmuting can play again', async () => {
  const { sounds, context } = setup();
  await sounds.unlock();
  await sounds.play(normal());
  const playing = context.starts.map(item => item.source);
  const scheduledStops = playing.map(source => source.stops.length);
  sounds.enabled = false;
  assert.equal(sounds.enabled, false);
  assert.ok(playing.every((source, index) => source.stops.length > scheduledStops[index]));
  const count = context.starts.length;
  assert.equal(await sounds.play(capture()), false);
  assert.equal(context.starts.length, count);
  sounds.setEnabled(true);
  assert.equal(await sounds.play(capture()), true);
  assert.ok(context.starts.length > count);
  await sounds.destroy();
});

test('naturally completed sounds release their sources instead of retaining old voices', async () => {
  const { sounds, context } = setup();
  await sounds.unlock();
  await sounds.play(normal());
  const completed = context.starts.map(item => item.source);
  assert.ok(completed.length > 0);
  for (const source of completed) source.onended?.();
  assert.ok(completed.every(source => source.disconnected));
  const stopCounts = completed.map(source => source.stops.length);
  await sounds.play(capture());
  assert.deepEqual(completed.map(source => source.stops.length), stopCounts);
  await sounds.destroy();
});

test('destroy is idempotent and permanently prevents new audio contexts', async () => {
  const { sounds, context, creations } = setup();
  await sounds.unlock();
  await sounds.play(normal());
  await sounds.destroy();
  await sounds.destroy();
  sounds.setEnabled(true);
  assert.equal(await sounds.unlock(), false);
  assert.equal(await sounds.play(capture()), false);
  assert.equal(context.closeCalls, 1);
  assert.equal(creations(), 1);
});
