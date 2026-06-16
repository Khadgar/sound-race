/**
 * Audio playback + live AnalyserNode for reactive visuals.
 *
 * Wrap an AudioBuffer so the game loop can:
 *   - start playback from a user gesture (autoplay policy compliant)
 *   - query `currentTime` for drift-free sync with the beatmap
 *   - sample low/mid/high band energy live for background pulse, etc.
 */

export interface LiveBands {
  low: number;
  mid: number;
  high: number;
  rms: number;
}

export class AudioPlayer {
  private readonly ctx: AudioContext;
  private readonly analyser: AnalyserNode;
  private readonly buffer: AudioBuffer;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private pausedAt = 0;
  private playing = false;
  private readonly freqBuf: Uint8Array<ArrayBuffer>;
  private readonly timeBuf: Uint8Array<ArrayBuffer>;

  constructor(buffer: AudioBuffer, ctx?: AudioContext) {
    this.buffer = buffer;
    this.ctx =
      ctx ??
      new (window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;
    this.analyser.connect(this.ctx.destination);
    this.freqBuf = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.timeBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
  }

  get duration(): number {
    return this.buffer.duration;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Seconds since playback started (paused-aware). */
  get currentTime(): number {
    if (!this.playing) return this.pausedAt;
    return this.ctx.currentTime - this.startedAt;
  }

  async start(): Promise<void> {
    if (this.playing) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.analyser);
    src.onended = () => {
      if (this.source === src) {
        this.playing = false;
        this.pausedAt = this.buffer.duration;
      }
    };
    src.start(0, this.pausedAt);
    this.source = src;
    this.startedAt = this.ctx.currentTime - this.pausedAt;
    this.playing = true;
  }

  pause(): void {
    if (!this.playing || !this.source) return;
    this.pausedAt = this.currentTime;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
    this.playing = false;
  }

  stop(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* ignore */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
    this.pausedAt = 0;
  }

  /** Sample current band energies. Call once per frame. */
  sampleBands(): LiveBands {
    this.analyser.getByteFrequencyData(this.freqBuf);
    this.analyser.getByteTimeDomainData(this.timeBuf);
    const bins = this.freqBuf.length;
    const nyquist = this.ctx.sampleRate / 2;
    const binHz = nyquist / bins;
    const lowMax = Math.min(bins, Math.floor(250 / binHz));
    const midMax = Math.min(bins, Math.floor(2000 / binHz));
    let lo = 0,
      md = 0,
      hi = 0;
    for (let i = 1; i < lowMax; i++) lo += this.freqBuf[i]!;
    for (let i = lowMax; i < midMax; i++) md += this.freqBuf[i]!;
    for (let i = midMax; i < bins; i++) hi += this.freqBuf[i]!;
    lo /= Math.max(1, lowMax - 1) * 255;
    md /= Math.max(1, midMax - lowMax) * 255;
    hi /= Math.max(1, bins - midMax) * 255;

    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) {
      const v = (this.timeBuf[i]! - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.timeBuf.length);

    return { low: lo, mid: md, high: hi, rms };
  }

  async dispose(): Promise<void> {
    this.stop();
    this.analyser.disconnect();
    if (this.ctx.state !== "closed") await this.ctx.close();
  }
}
