/**
 * TouchControls — on-screen buttons for mobile gameplay.
 *
 * Renders:
 *   • Shield button (bottom-center) — fires onShield callback
 *   • Pause button (top-right) — fires onPause callback
 *   • Left/right tap zones (invisible, full-height) — fires onLaneLeft / onLaneRight
 *
 * Always visible during gameplay so it works on desktop mobile emulation too.
 * Styled to match the synthwave HUD aesthetic.
 */

export interface TouchControlsCallbacks {
  onPause: () => void;
  onShield: () => void;
  onLaneLeft: () => void;
  onLaneRight: () => void;
}

export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly shieldBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly leftZone: HTMLDivElement;
  private readonly rightZone: HTMLDivElement;
  private host: HTMLElement | null = null;

  constructor(private readonly callbacks: TouchControlsCallbacks) {
    // Root overlay — covers the viewport, passes through clicks except on buttons/zones
    this.root = document.createElement("div");
    this.root.id = "sr-touch-controls";
    this.root.style.position = "absolute";
    this.root.style.inset = "0";
    this.root.style.pointerEvents = "none";
    this.root.style.zIndex = "7"; // above HUD (z-index 6)
    this.root.style.userSelect = "none";
    this.root.style.webkitUserSelect = "none";

    // ---- Left tap zone ----
    this.leftZone = document.createElement("div");
    Object.assign(this.leftZone.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "35%",
      height: "100%",
      pointerEvents: "auto",
      // Invisible — no background
    } satisfies Partial<CSSStyleDeclaration>);
    this.leftZone.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.callbacks.onLaneLeft();
    });

    // ---- Right tap zone ----
    this.rightZone = document.createElement("div");
    Object.assign(this.rightZone.style, {
      position: "absolute",
      right: "0",
      top: "0",
      width: "35%",
      height: "100%",
      pointerEvents: "auto",
    } satisfies Partial<CSSStyleDeclaration>);
    this.rightZone.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.callbacks.onLaneRight();
    });

    // ---- Shield button (bottom-center) ----
    this.shieldBtn = document.createElement("button");
    this.shieldBtn.id = "sr-shield-btn";
    this.shieldBtn.textContent = "🛡";
    Object.assign(this.shieldBtn.style, {
      position: "absolute",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "64px",
      height: "64px",
      borderRadius: "50%",
      border: "2px solid #5df0ff",
      background: "rgba(11, 10, 20, 0.7)",
      color: "#5df0ff",
      fontSize: "24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "auto",
      cursor: "pointer",
      boxShadow: "0 0 12px rgba(93, 240, 255, 0.4)",
      backdropFilter: "blur(4px)",
      transition: "box-shadow 120ms ease, border-color 120ms ease",
      padding: "0",
    } satisfies Partial<CSSStyleDeclaration>);
    this.shieldBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onShield();
      this.flashButton(this.shieldBtn);
    });
    this.shieldBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onShield();
      this.flashButton(this.shieldBtn);
    });

    // ---- Pause button (top-right) ----
    this.pauseBtn = document.createElement("button");
    this.pauseBtn.id = "sr-pause-btn";
    this.pauseBtn.textContent = "⏸";
    Object.assign(this.pauseBtn.style, {
      position: "absolute",
      top: "14px",
      right: "14px",
      width: "40px",
      height: "40px",
      borderRadius: "8px",
      border: "1.5px solid #ff5dc8",
      background: "rgba(11, 10, 20, 0.7)",
      color: "#ff5dc8",
      fontSize: "18px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "auto",
      cursor: "pointer",
      boxShadow: "0 0 8px rgba(255, 93, 200, 0.35)",
      backdropFilter: "blur(4px)",
      transition: "box-shadow 120ms ease, border-color 120ms ease",
      padding: "0",
    } satisfies Partial<CSSStyleDeclaration>);
    this.pauseBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onPause();
    });
    this.pauseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onPause();
    });

    // Assemble
    this.root.appendChild(this.leftZone);
    this.root.appendChild(this.rightZone);
    this.root.appendChild(this.shieldBtn);
    this.root.appendChild(this.pauseBtn);
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.appendChild(this.root);
  }

  dispose(): void {
    if (this.host && this.root.parentElement === this.host) {
      this.host.removeChild(this.root);
    }
    this.host = null;
  }

  /** Brief glow flash on button press for tactile feedback. */
  private flashButton(btn: HTMLButtonElement): void {
    btn.style.boxShadow = "0 0 20px rgba(93, 240, 255, 0.8)";
    setTimeout(() => {
      btn.style.boxShadow = "0 0 12px rgba(93, 240, 255, 0.4)";
    }, 150);
  }
}
