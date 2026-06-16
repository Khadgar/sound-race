/**
 * Lane-based input: maps keyboard / touch to a desired lane index.
 */

export interface LaneInputOptions {
  laneCount: number;
  initialLane?: number;
}

export class LaneInput {
  private desired: number;
  private readonly laneCount: number;
  private keyHandler: (e: KeyboardEvent) => void;
  private touchHandler: (e: TouchEvent) => void;
  private attached: HTMLElement | null = null;
  private paused = false;
  private onPauseToggle: (() => void) | null = null;
  private onShieldPressed: (() => void) | null = null;

  constructor(opts: LaneInputOptions) {
    this.laneCount = opts.laneCount;
    this.desired = opts.initialLane ?? Math.floor(opts.laneCount / 2);
    this.keyHandler = (e) => {
      if (e.repeat) return;
      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A":
          this.desired = Math.max(0, this.desired - 1);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          this.desired = Math.min(this.laneCount - 1, this.desired + 1);
          break;
        case " ":
          if (this.onShieldPressed) {
            e.preventDefault();
            this.onShieldPressed();
          }
          break;
        case "Escape":
          if (this.onPauseToggle) {
            e.preventDefault();
            this.onPauseToggle();
          }
          break;
      }
    };
    this.touchHandler = (e) => {
      const touch = e.changedTouches[0];
      if (!touch || !this.attached) return;
      // Ignore touches on the on-screen control buttons (handled by TouchControls)
      const target = e.target as HTMLElement | null;
      if (target?.closest("#sr-touch-controls")) return;
      const rect = this.attached.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      if (x < rect.width / 2) this.desired = Math.max(0, this.desired - 1);
      else this.desired = Math.min(this.laneCount - 1, this.desired + 1);
    };
  }

  attach(
    el: HTMLElement,
    onPauseToggle?: () => void,
    onShieldPressed?: () => void,
  ): void {
    this.attached = el;
    if (onPauseToggle) this.onPauseToggle = onPauseToggle;
    if (onShieldPressed) this.onShieldPressed = onShieldPressed;
    window.addEventListener("keydown", this.keyHandler);
    el.addEventListener("touchstart", this.touchHandler, { passive: true });
  }

  detach(): void {
    window.removeEventListener("keydown", this.keyHandler);
    if (this.attached) this.attached.removeEventListener("touchstart", this.touchHandler);
    this.attached = null;
  }

  get lane(): number {
    return this.desired;
  }

  set lane(v: number) {
    this.desired = Math.max(0, Math.min(this.laneCount - 1, v));
  }

  get isPaused(): boolean {
    return this.paused;
  }
}
