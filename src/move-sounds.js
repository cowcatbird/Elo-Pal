/** Pick one sound for a move; tactical outcomes take priority over move type. */
export function classifyMoveSound(move) {
  const san = typeof move === 'string' ? move : String(move?.san || '');
  const flags = typeof move?.flags === 'string' ? move.flags : '';
  if (san.includes('#')) return 'checkmate';
  if (san.includes('+')) return 'check';
  if (move?.promotion || flags.includes('p') || /=[QRBN]/i.test(san)) return 'promotion';
  if (flags.includes('k') || flags.includes('q') || /^(?:O|0)-(?:O|0)/.test(san)) return 'castle';
  if (move?.captured || /[ce]/.test(flags) || san.includes('x')) return 'capture';
  return 'move';
}

function defaultContextFactory() {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  return AudioContext ? new AudioContext({ latencyHint: 'interactive' }) : null;
}

/**
 * Local, quiet Web Audio effects. Call unlock() directly from a user gesture.
 * play() never creates an AudioContext, and newer requests replace older ones.
 */
export class MoveSounds {
  constructor({ enabled = true, contextFactory = defaultContextFactory } = {}) {
    this._enabled = Boolean(enabled);
    this._contextFactory = contextFactory;
    this._context = null;
    this._master = null;
    this._noiseBuffer = null;
    this._resumePromise = null;
    this._voices = new Set();
    this._request = 0;
    this._destroyed = false;
  }

  get enabled() { return this._enabled; }
  set enabled(value) { this.setEnabled(value); }

  setEnabled(value) {
    this._enabled = Boolean(value) && !this._destroyed;
    if (!this._enabled) this.stop();
  }

  async unlock() {
    if (!this._enabled || this._destroyed) return false;
    const request = this._request;
    if (!this._context) {
      let context;
      let master;
      try {
        context = this._contextFactory();
        if (!context || context.state === 'closed') return false;
        master = context.createGain();
        master.gain.value = 0.36;
        master.connect(context.destination);
        this._context = context;
        this._master = master;
      } catch {
        try { master?.disconnect(); } catch { /* Already disconnected. */ }
        try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* Unsupported context. */ }
        return false;
      }
    }
    const context = this._context;
    const ready = await this._resume(context);
    return ready && this._isCurrent(request, context);
  }

  async play(move) {
    // Context creation is reserved for unlock(), which the UI calls on a gesture.
    if (!move || !this._enabled || this._destroyed || !this._context) return false;
    this.stop();
    const request = this._request;
    const context = this._context;
    const ready = await this._resume(context);
    if (!ready || !this._isCurrent(request, context)) return false;
    const voice = { nodes: new Set(), sources: new Set(), disposed: false };
    this._voices.add(voice);
    try {
      // Schedule from the current clock after resume, never from a stale timestamp.
      const time = context.currentTime + 0.006;
      const kind = classifyMoveSound(move);
      if (kind === 'move') this._tap(voice, time, false);
      else if (kind === 'capture') this._tap(voice, time, true);
      else if (kind === 'castle') {
        this._tap(voice, time, false, 0.8);
        this._tap(voice, time + 0.11, true, 0.75);
      } else if (kind === 'check') {
        this._tone(voice, time, 880, 0.16, 0.13);
        this._tone(voice, time + 0.035, 1320, 0.13, 0.07);
      } else if (kind === 'promotion') {
        [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
          this._tone(voice, time + index * 0.06, frequency, 0.13, 0.12);
        });
      } else {
        // A short, resolving cadence distinguishes mate from an ordinary check.
        [659.25, 523.25, 392].forEach((frequency, index) => {
          this._tone(voice, time + index * 0.11, frequency, 0.21, 0.13);
        });
      }
      return true;
    } catch {
      this._disposeVoice(voice, true);
      return false;
    }
  }

  stop() {
    this._request += 1;
    for (const voice of this._voices) this._disposeVoice(voice, true);
  }

  async destroy() {
    if (this._destroyed) return false;
    this._destroyed = true;
    this._enabled = false;
    this.stop();
    const context = this._context;
    this._context = null;
    this._noiseBuffer = null;
    this._resumePromise = null;
    try { this._master?.disconnect(); } catch { /* Already disconnected. */ }
    this._master = null;
    try {
      if (context && context.state !== 'closed') await context.close();
    } catch { /* Audio failures must never interrupt the board. */ }
    return true;
  }

  _isCurrent(request, context) {
    return this._enabled && !this._destroyed && request === this._request && context === this._context;
  }

  _resume(context) {
    if (context.state === 'running') return Promise.resolve(true);
    if (context.state === 'closed') return Promise.resolve(false);
    if (this._resumePromise) return this._resumePromise;
    try {
      // Invoke resume synchronously so unlock() retains the calling user gesture.
      const pending = Promise.resolve(context.resume()).then(
        () => context.state === 'running',
        () => false,
      );
      this._resumePromise = pending;
      void pending.then(() => {
        if (this._resumePromise === pending) this._resumePromise = null;
      });
      return pending;
    } catch {
      return Promise.resolve(false);
    }
  }

  _node(voice, node) {
    voice.nodes.add(node);
    return node;
  }

  _source(voice, source, time, duration) {
    voice.sources.add(source);
    source.onended = () => {
      voice.sources.delete(source);
      if (!voice.sources.size) this._disposeVoice(voice, false);
    };
    source.start(time);
    source.stop(time + duration);
  }

  _envelope(voice, time, duration, volume) {
    const gain = this._node(voice, this._context.createGain());
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.003);
    // Exponential ramps require a positive endpoint; finish at silence afterward.
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration - 0.004);
    gain.gain.linearRampToValueAtTime(0, time + duration);
    gain.connect(this._master);
    return gain;
  }

  _tone(voice, time, frequency, duration, volume, endFrequency = frequency) {
    const oscillator = this._node(voice, this._context.createOscillator());
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, time);
    if (endFrequency !== frequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + 0.035);
    oscillator.connect(this._envelope(voice, time, duration, volume));
    this._source(voice, oscillator, time, duration);
  }

  _tap(voice, time, deep, volume = 1) {
    const duration = deep ? 0.135 : 0.095;
    // Two damped body resonances plus a tiny filtered impact resemble a wood tap.
    this._tone(voice, time, deep ? 440 : 720, duration, 0.18 * volume, deep ? 260 : 450);
    this._tone(voice, time, deep ? 190 : 320, duration * 0.8, 0.14 * volume, deep ? 160 : 270);
    if (!this._noiseBuffer) {
      const context = this._context;
      this._noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.06), context.sampleRate);
      const data = this._noiseBuffer.getChannelData(0);
      let seed = 0x21f0aaad;
      for (let i = 0; i < data.length; i += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = (seed / 0x100000000) * 2 - 1;
      }
    }
    const noise = this._node(voice, this._context.createBufferSource());
    noise.buffer = this._noiseBuffer;
    const filter = this._node(voice, this._context.createBiquadFilter());
    filter.type = 'bandpass';
    filter.frequency.value = deep ? 1150 : 1900;
    filter.Q.value = 0.7;
    noise.connect(filter);
    filter.connect(this._envelope(voice, time, 0.045, 0.25 * volume));
    this._source(voice, noise, time, 0.045);
  }

  _disposeVoice(voice, stopSources) {
    if (voice.disposed) return;
    voice.disposed = true;
    for (const source of voice.sources) {
      source.onended = null;
      if (stopSources) {
        try { source.stop(); } catch { /* A completed source can already be stopped. */ }
      }
    }
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* An audio device may have disconnected. */ }
    }
    voice.sources.clear();
    voice.nodes.clear();
    this._voices.delete(voice);
  }
}
