/**
 * Fixed-step game loop driven by the audio clock.
 *
 * - `update(dt)` is called in fixed-size steps for deterministic physics.
 * - `render(alpha)` is called once per frame.
 * - The authoritative time source is the AudioPlayer's currentTime, so the
 *   game stays perfectly in sync with the music even under jank.
 */

import type { AudioPlayer } from "../audio/player.js";

export interface LoopCallbacks {
  update(dtSec: number, songTimeSec: number): void;
  render(songTimeSec: number, alpha: number): void;
}

export class GameEngine {
  private readonly fixedStep: number;
  private accumulator = 0;
  private lastFrame = 0;
  private rafId = 0;
  private running = false;
  private lastSongTime = 0;

  constructor(
    private readonly player: AudioPlayer,
    private readonly cb: LoopCallbacks,
    options?: { fixedHz?: number },
  ) {
    this.fixedStep = 1 / (options?.fixedHz ?? 120);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const songTime = this.player.currentTime;
    const dtSong = Math.max(0, songTime - this.lastSongTime);
    this.lastSongTime = songTime;

    // Cap to avoid spiral-of-death after tab backgrounding.
    const dt = Math.min(0.25, dtSong || (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.accumulator += dt;

    let updated = 0;
    while (this.accumulator >= this.fixedStep && updated < 8) {
      this.cb.update(this.fixedStep, songTime - this.accumulator + this.fixedStep);
      this.accumulator -= this.fixedStep;
      updated++;
    }
    if (updated >= 8) this.accumulator = 0; // catch-up failed; drop time

    const alpha = this.accumulator / this.fixedStep;
    this.cb.render(songTime, alpha);

    this.rafId = requestAnimationFrame(this.tick);
  };
}
