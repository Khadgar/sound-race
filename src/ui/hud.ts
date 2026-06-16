/**
 * HUD — DOM/HTML/CSS HUD overlay.
 *
 * Replaces the Pixi text/graphics HUD that lived inside the previous
 * scene module. Built and mounted into the host element (the same
 * `#app` div Three.js renders into) so it sits above the canvas via
 * stacking context (z-index).
 *
 * Public update API mirrors the data shapes the previous `drawHud` /
 * `drawBlockQueue` / `drawHint` produced — the GameScene calls these
 * methods once per render frame.
 *
 * Styling is inline so the HUD is self-contained; the synthwave color
 * tokens match `styles.css` (--accent / --accent2).
 */

import { BLOCK_PALETTE } from "../game/palette.js";

const COLOR_PINK = 0xff5dc8;
const COLOR_CYAN = 0x5df0ff;
const COLOR_YELLOW = 0xfff066;
const COLOR_RED = 0xff3d6e;
const COLOR_BG = 0x0b0a14;

const QUEUE_ROWS = 5;

export class HUD {
  private readonly host: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly scoreText: HTMLDivElement;
  private readonly bpmText: HTMLDivElement;
  private readonly speedText: HTMLDivElement;
  private readonly comboText: HTMLDivElement;
  private readonly healthBar: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly queueGrid: HTMLDivElement;
  private readonly queueCells: HTMLDivElement[][] = [];
  private readonly shieldRow: HTMLDivElement;
  private readonly shieldIcons: HTMLDivElement[] = [];
  private readonly shieldTimerBar: HTMLDivElement;
  private readonly shieldTimerFill: HTMLDivElement;

  /** Number of shield icons rendered. Should match score.STARTING_SHIELDS. */
  private static readonly SHIELD_SLOTS = 3;

  constructor(host: HTMLElement) {
    this.host = host;

    this.root = document.createElement("div");
    this.root.id = "sr-hud";
    this.root.style.position = "absolute";
    this.root.style.inset = "0";
    this.root.style.pointerEvents = "none";
    this.root.style.fontFamily = "monospace";
    this.root.style.color = hex(COLOR_CYAN);
    this.root.style.zIndex = "6";

    // ---- Top-left: score + time ----
    this.scoreText = panel({
      top: "14px", left: "14px",
      fontSize: "16px",
      color: hex(COLOR_CYAN),
      letterSpacing: "2px",
    });
    this.scoreText.textContent = "▌ SCORE 0000000  │  00:00 / 00:00";

    this.bpmText = panel({
      top: "40px", left: "14px",
      fontSize: "12px",
      color: hex(COLOR_PINK),
      letterSpacing: "3px",
    });
    this.bpmText.textContent = "▌ BPM 000  │  BEAT 0000";

    this.speedText = panel({
      top: "62px", left: "14px",
      fontSize: "12px",
      color: hex(COLOR_CYAN),
      letterSpacing: "3px",
    });
    this.speedText.textContent = "▌ SPD 000  │ ··········";

    // ---- Top-right: combo + health ----
    this.comboText = panel({
      top: "14px", right: "14px",
      fontSize: "32px",
      color: hex(COLOR_PINK),
      letterSpacing: "4px",
      textAlign: "right",
      textShadow: `0 0 12px ${rgba(COLOR_PINK, 0.55)}`,
    });
    this.comboText.textContent = "";

    this.healthBar = panel({
      top: "60px", right: "14px",
      width: "200px",
      height: "12px",
      background: hex(COLOR_BG),
      border: `1px solid ${rgba(COLOR_CYAN, 0.6)}`,
      borderRadius: "2px",
      padding: "0",
      overflow: "hidden",
    });
    this.healthFill = document.createElement("div");
    this.healthFill.style.height = "100%";
    this.healthFill.style.width = "100%";
    this.healthFill.style.background = hex(COLOR_CYAN);
    this.healthFill.style.transition = "background 120ms ease";
    this.healthBar.appendChild(this.healthFill);

    // ---- Top-right: shield indicator (3 icons + active countdown bar) ----
    this.shieldRow = panel({
      top: "82px", right: "14px",
      padding: "6px 10px",
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: "4px",
    });
    const iconStrip = document.createElement("div");
    iconStrip.style.display = "flex";
    iconStrip.style.gap = "4px";
    iconStrip.style.alignItems = "center";
    const shieldLabel = document.createElement("span");
    shieldLabel.textContent = "SHIELD";
    shieldLabel.style.fontSize = "10px";
    shieldLabel.style.letterSpacing = "2px";
    shieldLabel.style.color = rgba(COLOR_CYAN, 0.7);
    shieldLabel.style.marginRight = "4px";
    iconStrip.appendChild(shieldLabel);
    for (let i = 0; i < HUD.SHIELD_SLOTS; i++) {
      const icon = document.createElement("div");
      icon.style.width = "14px";
      icon.style.height = "14px";
      icon.style.border = `1.5px solid ${hex(COLOR_CYAN)}`;
      icon.style.borderRadius = "50%";
      icon.style.background = hex(COLOR_CYAN);
      icon.style.boxShadow = `0 0 6px ${rgba(COLOR_CYAN, 0.65)}`;
      icon.style.transition = "background 120ms ease, opacity 120ms ease";
      iconStrip.appendChild(icon);
      this.shieldIcons.push(icon);
    }
    this.shieldTimerBar = document.createElement("div");
    this.shieldTimerBar.style.width = "100%";
    this.shieldTimerBar.style.height = "4px";
    this.shieldTimerBar.style.background = hex(COLOR_BG);
    this.shieldTimerBar.style.border = `1px solid ${rgba(COLOR_CYAN, 0.4)}`;
    this.shieldTimerBar.style.borderRadius = "2px";
    this.shieldTimerBar.style.overflow = "hidden";
    this.shieldTimerBar.style.opacity = "0";
    this.shieldTimerFill = document.createElement("div");
    this.shieldTimerFill.style.height = "100%";
    this.shieldTimerFill.style.width = "0%";
    this.shieldTimerFill.style.background = hex(COLOR_CYAN);
    this.shieldTimerFill.style.boxShadow = `0 0 6px ${rgba(COLOR_CYAN, 0.7)}`;
    this.shieldTimerBar.appendChild(this.shieldTimerFill);
    this.shieldRow.appendChild(iconStrip);
    this.shieldRow.appendChild(this.shieldTimerBar);

    // ---- Bottom-right: block queue grid ----
    this.queueGrid = panel({
      bottom: "14px", right: "14px",
      padding: "8px",
      background: rgba(COLOR_BG, 0.7),
      border: `1px solid ${rgba(COLOR_CYAN, 0.4)}`,
      borderRadius: "4px",
    });
    this.queueGrid.style.display = "grid";
    this.queueGrid.style.gridTemplateColumns = `repeat(${BLOCK_PALETTE.length}, 18px)`;
    this.queueGrid.style.gridTemplateRows = `12px repeat(${QUEUE_ROWS}, 14px)`;
    this.queueGrid.style.gap = "3px";
    this.queueGrid.style.alignItems = "stretch";
    this.queueGrid.style.justifyItems = "stretch";

    // Header dots (one per palette color).
    for (let c = 0; c < BLOCK_PALETTE.length; c++) {
      const dot = document.createElement("div");
      dot.style.width = "10px";
      dot.style.height = "10px";
      dot.style.borderRadius = "50%";
      dot.style.background = `#${BLOCK_PALETTE[c]!.toString(16).padStart(6, "0")}`;
      dot.style.boxShadow = `0 0 6px ${rgba(BLOCK_PALETTE[c]!, 0.7)}`;
      dot.style.justifySelf = "center";
      dot.style.alignSelf = "center";
      this.queueGrid.appendChild(dot);
    }
    // Stacked cells, growing from the bottom.
    for (let r = 0; r < QUEUE_ROWS; r++) {
      const row: HTMLDivElement[] = [];
      for (let c = 0; c < BLOCK_PALETTE.length; c++) {
        const cell = document.createElement("div");
        cell.style.border = `1px solid ${rgba(BLOCK_PALETTE[c]!, 0.4)}`;
        cell.style.background = rgba(BLOCK_PALETTE[c]!, 0);
        cell.style.borderRadius = "2px";
        cell.style.gridColumn = `${c + 1}`;
        cell.style.gridRow = `${r + 2}`;
        this.queueGrid.appendChild(cell);
        row.push(cell);
      }
      this.queueCells.push(row);
    }

    this.root.appendChild(this.scoreText);
    this.root.appendChild(this.bpmText);
    this.root.appendChild(this.speedText);
    this.root.appendChild(this.comboText);
    this.root.appendChild(this.healthBar);
    this.root.appendChild(this.shieldRow);
    this.root.appendChild(this.queueGrid);

    this.host.appendChild(this.root);
  }

  setScore(score: number, songTime: number, duration: number): void {
    const t = Math.max(0, Math.min(duration, songTime));
    const mm = Math.floor(t / 60).toString().padStart(2, "0");
    const ss = Math.floor(t % 60).toString().padStart(2, "0");
    const total = Math.floor(duration);
    const tmm = Math.floor(total / 60).toString().padStart(2, "0");
    const tss = (total % 60).toString().padStart(2, "0");
    this.scoreText.textContent =
      `▌ SCORE ${score.toString().padStart(7, "0")}  │  ${mm}:${ss} / ${tmm}:${tss}`;
  }

  setBpm(bpm: number, beat: number): void {
    this.bpmText.textContent =
      `▌ BPM ${Math.round(bpm).toString().padStart(3, "0")}  │  BEAT ${beat.toString().padStart(4, "0")}`;
  }

  setSpeed(speedMult: number, min: number, max: number): void {
    const kmh = Math.round(speedMult * 100);
    const bars = Math.round(((speedMult - min) / (max - min)) * 10);
    const speedBar = "█".repeat(Math.max(0, Math.min(10, bars))).padEnd(10, "·");
    this.speedText.textContent = `▌ SPD ${kmh.toString().padStart(3, "0")}  │ ${speedBar}`;
  }

  setCombo(combo: number): void {
    this.comboText.textContent = combo > 1 ? `x${combo}` : "";
  }

  setHealth(health01: number): void {
    const h = Math.max(0, Math.min(1, health01));
    this.healthFill.style.width = `${(h * 100).toFixed(1)}%`;
    this.healthFill.style.background = h > 0.4 ? hex(COLOR_CYAN) : hex(COLOR_RED);
  }

  /**
   *   shieldsRemaining: number of unused charges left (>= 0).
   *   activeFraction:   in [0,1] — remaining lifetime of the currently
   *                     active shield, 0 if not currently shielded.
   */
  setShields(shieldsRemaining: number, activeFraction: number): void {
    const left = Math.max(0, shieldsRemaining);
    for (let i = 0; i < this.shieldIcons.length; i++) {
      const icon = this.shieldIcons[i]!;
      if (i < left) {
        icon.style.opacity = "1";
        icon.style.background = hex(COLOR_CYAN);
        icon.style.border = `1.5px solid ${hex(COLOR_CYAN)}`;
      } else {
        icon.style.opacity = "0.35";
        icon.style.background = "transparent";
        icon.style.border = `1.5px solid ${rgba(COLOR_CYAN, 0.4)}`;
      }
    }
    if (activeFraction > 0) {
      this.shieldTimerBar.style.opacity = "1";
      this.shieldTimerFill.style.width = `${(activeFraction * 100).toFixed(1)}%`;
      this.shieldTimerFill.style.background = activeFraction < 0.25
        ? hex(COLOR_YELLOW)
        : hex(COLOR_CYAN);
    } else {
      this.shieldTimerBar.style.opacity = "0";
      this.shieldTimerFill.style.width = "0%";
    }
  }

  setBlockQueue(recentColors: number[]): void {
    // Count collected per color (most recent QUEUE).
    const counts = new Array(BLOCK_PALETTE.length).fill(0) as number[];
    for (const c of recentColors) {
      if (c >= 0 && c < BLOCK_PALETTE.length) counts[c] = (counts[c] ?? 0) + 1;
    }
    for (let c = 0; c < BLOCK_PALETTE.length; c++) {
      const fill = Math.min(QUEUE_ROWS, counts[c]!);
      for (let r = 0; r < QUEUE_ROWS; r++) {
        // r=0 is the BOTTOM row visually; we want fills to grow from
        // the bottom. queueCells[r=0] is the TOP row (row 1 in the grid).
        const isFilled = (QUEUE_ROWS - r) <= fill;
        const cell = this.queueCells[r]![c]!;
        cell.style.background = isFilled
          ? hex(BLOCK_PALETTE[c]!)
          : rgba(COLOR_BG, 0.55);
        cell.style.boxShadow = isFilled
          ? `0 0 6px ${rgba(BLOCK_PALETTE[c]!, 0.5)}`
          : "none";
      }
    }
  }

  dispose(): void {
    if (this.root.parentElement === this.host) {
      this.host.removeChild(this.root);
    }
  }
}

// ----------------------------------------------------------------------
// Helpers

function panel(style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const d = document.createElement("div");
  d.style.position = "absolute";
  d.style.padding = "6px 10px";
  d.style.background = rgba(COLOR_BG, 0.55);
  d.style.border = `1px solid ${rgba(COLOR_CYAN, 0.2)}`;
  d.style.borderRadius = "4px";
  d.style.backdropFilter = "blur(4px)";
  d.style.pointerEvents = "none";
  Object.assign(d.style, style);
  return d;
}

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

function rgba(c: number, a: number): string {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
