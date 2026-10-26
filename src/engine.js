/** All engine code and neural-network weights are packaged with the extension. */
export const ENGINE_WORKER_URL = new URL('../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url);

const aborted = () => new DOMException('Analysis cancelled', 'AbortError');

/** Parse scored UCI output into a White-perspective principal variation. */
export function parseInfo(message, turn = 'w') {
  if (!message.startsWith('info ')) return null;
  const depth = message.match(/\bdepth (\d+)/);
  const score = message.match(/\bscore (cp|mate) (-?\d+)/);
  const pv = message.match(/\bpv (.+)$/);
  // Bound-only scores are not stable evaluations and must not replace an exact PV.
  if (!depth || !score || !pv || /\b(?:lowerbound|upperbound)\b/.test(message)) return null;
  const sign = turn === 'b' ? -1 : 1;
  return {
    multipv: Number(message.match(/\bmultipv (\d+)/)?.[1] || 1),
    depth: Number(depth[1]),
    cp: score[1] === 'cp' ? Number(score[2]) * sign : null,
    mate: score[1] === 'mate' ? Number(score[2]) * sign : null,
    pv: pv[1].trim().split(/\s+/),
  };
}

/** A serialized UCI worker with cancellation that drains bestmove before reuse. */
export class Engine {
  constructor({ workerFactory = url => new Worker(url), workerUrl = ENGINE_WORKER_URL, timeoutMs = 30_000 } = {}) {
    this.workerFactory = workerFactory;
    this.workerUrl = workerUrl;
    this.timeoutMs = timeoutMs;
    this.worker = null;
    this._initializing = null;
    this._waiters = [];
    this._tasks = new Set();
    this._tail = Promise.resolve();
    this._active = null;
    this._destroyed = false;
  }

  async init() {
    if (this._destroyed) throw new Error('The analysis engine has been closed.');
    if (this._initializing) return this._initializing;
    this._initializing = (async () => {
      this.worker = this.workerFactory(this.workerUrl);
      this.worker.onmessage = event => {
        for (const line of String(event.data).split(/\r?\n/)) this._message(line.trim());
      };
      this.worker.onerror = event => this._fail(new Error(event.message || 'Unable to load the local Stockfish engine.'));
      await this._command('uci', 'uciok');
      this._send('setoption name Hash value 32');
      this._send('setoption name UCI_AnalyseMode value true');
      await this._ready();
      return this;
    })();
    try {
      return await this._initializing;
    } catch (error) {
      this._fail(error);
      throw error;
    }
  }

  analyze(fen, { depth = 14, movetime = 1000, multiPV = 3, onInfo, moves, startFen } = {}) {
    if (this._destroyed) return Promise.reject(new Error('The analysis engine has been closed.'));
    // Only valid UCI positions/moves should cross the worker command boundary.
    if (typeof fen !== 'string' || /[\r\n]/.test(fen) || !/^[prnbqkPRNBQK1-8/]+ [wb] [KQkq-]+ [a-h1-8-]+ \d+ \d+$/.test(fen)) {
      return Promise.reject(new Error('A valid six-field FEN is required.'));
    }
    if (moves && (!Array.isArray(moves) || moves.some(move => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)))) {
      return Promise.reject(new Error('Position history must contain UCI moves.'));
    }
    if (startFen && (typeof startFen !== 'string' || /[\r\n]/.test(startFen) || !/^[prnbqkPRNBQK1-8/]+ [wb] [KQkq-]+ [a-h1-8-]+ \d+ \d+$/.test(startFen))) {
      return Promise.reject(new Error('A valid starting FEN is required.'));
    }
    const task = { fen, depth: Math.max(1, Math.min(30, Math.round(Number(depth) || 14))),
      movetime: Math.max(50, Math.min(60_000, Math.round(Number(movetime) || 1000))),
      multiPV: Math.max(1, Math.min(5, Math.round(Number(multiPV) || 3))),
      onInfo, moves, startFen, cancelled: false, lines: new Map() };
    const result = new Promise((resolve, reject) => Object.assign(task, { resolve, reject }));
    this._tasks.add(task);
    this._tail = this._tail.then(async () => {
      try {
        if (task.cancelled || this._destroyed) return;
        await this.init();
        if (task.cancelled || this._destroyed) return;
        await this._ready();
        if (task.cancelled || this._destroyed) return;
        await this._search(task);
      } catch (error) {
        task.reject(error);
      } finally {
        this._tasks.delete(task);
      }
    });
    return result;
  }

  cancel() {
    for (const task of this._tasks) {
      task.cancelled = true;
      task.reject(aborted());
    }
    if (this._active && this.worker) this._send('stop');
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.cancel();
    this._fail(aborted());
  }

  _search(task) {
    return new Promise(resolveDrain => {
      task.drain = resolveDrain;
      task.timer = setTimeout(() => this._fail(new Error('Stockfish did not finish responding. Please try again.')),
        Math.max(this.timeoutMs, task.movetime + 15_000));
      this._active = task;
      this._send(`setoption name MultiPV value ${task.multiPV}`);
      // History allows Stockfish to recognize repetitions instead of analyzing an isolated FEN.
      const position = task.moves ? `${task.startFen ? `fen ${task.startFen}` : 'startpos'}${task.moves.length ? ` moves ${task.moves.join(' ')}` : ''}` : `fen ${task.fen}`;
      this._send(`position ${position}`);
      this._send(`go depth ${task.depth} movetime ${task.movetime}`);
    });
  }

  _message(line) {
    const waiter = this._waiters.find(item => item.expected === line);
    if (waiter) {
      this._waiters.splice(this._waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    const task = this._active;
    if (!task) return;
    if (line.startsWith('bestmove ')) {
      clearTimeout(task.timer);
      this._active = null;
      if (!task.cancelled) {
        const lines = [...task.lines.values()].sort((a, b) => a.multipv - b.multipv);
        const bestmove = line.split(/\s+/)[1];
        task.resolve({ lines, bestmove: bestmove === '(none)' || bestmove === '0000' ? null : bestmove,
          depth: lines[0]?.depth || 0 });
      }
      task.drain();
    } else if (!task.cancelled) {
      const info = parseInfo(line, task.fen.split(' ')[1]);
      if (info) {
        task.lines.set(info.multipv, info);
        // A UI callback must not break the worker protocol or strand a pending search.
        try { task.onInfo?.(info); } catch (error) { console.error('Analysis callback failed:', error); }
      }
    }
  }

  _send(command) {
    if (!this.worker) throw new Error('The local analysis engine is unavailable.');
    this.worker.postMessage(command);
  }

  _ready() { return this._command('isready', 'readyok'); }

  _command(command, expected) {
    return new Promise((resolve, reject) => {
      const waiter = { expected, resolve, reject };
      waiter.timer = setTimeout(() => this._fail(new Error(`Stockfish timed out while waiting for ${expected}.`)), this.timeoutMs);
      this._waiters.push(waiter);
      try { this._send(command); } catch (error) { this._fail(error); }
    });
  }

  _fail(error) {
    this.worker?.terminate();
    this.worker = null;
    this._initializing = null;
    for (const waiter of this._waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    const task = this._active;
    if (task) {
      this._active = null;
      clearTimeout(task.timer);
      task.reject(error);
      task.drain();
    }
  }
}
