/**
 * Fx — beat / hit / speed visual flourishes.
 *
 * Three things are bundled here because they share an update cadence
 * and a small amount of shared state (the most-recent flash color):
 *
 *   - SpeedStreaks (3D): a tunnel of additive line segments flanking
 *     the road that scroll past the camera and respawn ahead. Density
 *     and alpha scaled by speedAmt in [0, 1].
 *
 *   - DOMOverlays: hit flash, bar tint, cluster bloom, beat-pulse
 *     vignette — implemented as transparent <div> layers stacked above
 *     the canvas. Per-frame the scene writes opacity values into them
 *     via cached element refs (no DOM queries in the hot path).
 *
 *   - Scanlines: a static CSS repeating-linear-gradient on a sibling
 *     div pinned above everything; created once at construction.
 *
 * Owned per-race by the GameScene (so the DOM overlay is torn down on
 * destroy). The 3D streaks are also attached to the scene root.
 */

import * as THREE from "three";

const COLOR_NEON_PINK = 0xff5dc8;
const COLOR_NEON_CYAN = 0x5df0ff;
const COLOR_NEON_YELLOW = 0xfff066;
const COLOR_HORIZON = 0xff2d8e;

const STREAK_COUNT = 56;
const STREAK_LEN = 1.2;
const STREAK_NEAR_Z = 6;
const STREAK_FAR_Z = -40;
const STREAK_BASE_VEL = 24; // world units / sec at speedAmt=1

export interface FxUpdateArgs {
  speedAmt: number;
  beatPulse: number;
  barPulse: number;
  clusterPulse: number;
  clusterPulseLen: number;
  flashStrength: number;
  flashColor: number;
  lowBand: number;
  dtSec: number;
  cameraX: number;
  hintAlpha: number;
}

export class Fx {
  readonly root: THREE.Group;

  private readonly streaks: SpeedStreaks;
  private readonly overlays: DOMOverlays;

  constructor(parent: THREE.Object3D, host: HTMLElement) {
    this.root = new THREE.Group();
    this.root.name = "Fx";
    parent.add(this.root);

    this.streaks = new SpeedStreaks(this.root);
    this.overlays = new DOMOverlays(host);
  }

  update(args: FxUpdateArgs): void {
    this.streaks.update(args.dtSec, args.speedAmt, args.cameraX);
    this.overlays.update(args);
  }

  dispose(): void {
    this.streaks.dispose();
    this.overlays.dispose();
    this.root.parent?.remove(this.root);
  }
}

// ----------------------------------------------------------------------
// 3D speed streaks

class SpeedStreaks {
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private readonly segs: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly base: Float32Array; // x, baseY, baseR(angle), pairIdx → for respawn

  constructor(parent: THREE.Object3D) {
    this.positions = new Float32Array(STREAK_COUNT * 2 * 3);
    this.base = new Float32Array(STREAK_COUNT * 4);
    for (let i = 0; i < STREAK_COUNT; i++) {
      this.respawn(i, true);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.LineBasicMaterial({
      color: COLOR_NEON_CYAN,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.segs = new THREE.LineSegments(this.geometry, this.material);
    this.segs.renderOrder = 3;
    this.segs.frustumCulled = false;
    parent.add(this.segs);
  }

  update(dtSec: number, speedAmt: number, cameraX: number): void {
    const vel = STREAK_BASE_VEL * (0.4 + speedAmt * 1.4);
    const dz = vel * dtSec;
    const p = this.positions;
    for (let i = 0; i < STREAK_COUNT; i++) {
      const o = i * 6;
      let z0 = p[o + 2]! + dz;
      let z1 = p[o + 5]! + dz;
      if (z0 > STREAK_NEAR_Z + 2) {
        this.respawn(i, false);
        // Apply camera-X offset to the newly-respawned streak.
        const ox = i * 4;
        p[o + 0] = this.base[ox + 0]! + cameraX;
        p[o + 3] = this.base[ox + 0]! + cameraX;
        z0 = p[o + 2]!;
        z1 = p[o + 5]!;
      } else {
        p[o + 2] = z0;
        p[o + 5] = z1;
        const ox = i * 4;
        p[o + 0] = this.base[ox + 0]! + cameraX;
        p[o + 3] = this.base[ox + 0]! + cameraX;
      }
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.material.opacity = 0.05 + 0.6 * speedAmt;
    this.segs.visible = speedAmt > 0.02;
  }

  private respawn(i: number, initial: boolean): void {
    // Distribute streaks into a tunnel just outside the road. Half on
    // the left, half on the right.
    const side = i % 2 === 0 ? -1 : 1;
    const lateral = side * (8 + Math.random() * 6);
    const yBase = 0.5 + Math.random() * 4.5;
    const zBase = initial
      ? STREAK_FAR_Z + Math.random() * (STREAK_NEAR_Z - STREAK_FAR_Z)
      : STREAK_FAR_Z + Math.random() * 4;
    const o = i * 6;
    this.positions[o + 0] = lateral;
    this.positions[o + 1] = yBase;
    this.positions[o + 2] = zBase;
    this.positions[o + 3] = lateral;
    this.positions[o + 4] = yBase;
    this.positions[o + 5] = zBase - STREAK_LEN;
    const ox = i * 4;
    this.base[ox + 0] = lateral;
    this.base[ox + 1] = yBase;
    this.base[ox + 2] = 0;
    this.base[ox + 3] = i;
  }

  dispose(): void {
    this.segs.parent?.remove(this.segs);
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ----------------------------------------------------------------------
// DOM overlays

class DOMOverlays {
  private readonly host: HTMLElement;
  private readonly wrap: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly barTint: HTMLDivElement;
  private readonly cluster: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly scanlines: HTMLDivElement;
  private readonly clusterText: HTMLDivElement;
  private readonly hintBox: HTMLDivElement;

  constructor(host: HTMLElement) {
    this.host = host;

    this.wrap = makeOverlayDiv("sr-fx-wrap");
    this.wrap.style.position = "absolute";
    this.wrap.style.inset = "0";
    this.wrap.style.pointerEvents = "none";
    this.wrap.style.overflow = "hidden";
    this.wrap.style.zIndex = "5";

    this.flash = makeOverlayDiv("sr-fx-flash");
    fullbleed(this.flash);
    this.flash.style.background = "rgba(255,255,255,0)";
    this.flash.style.mixBlendMode = "screen";

    this.barTint = makeOverlayDiv("sr-fx-bar");
    fullbleed(this.barTint);
    this.barTint.style.background = `rgba(${rgb(COLOR_NEON_PINK)}, 0)`;
    this.barTint.style.mixBlendMode = "screen";

    this.cluster = makeOverlayDiv("sr-fx-cluster");
    fullbleed(this.cluster);
    this.cluster.style.background =
      `radial-gradient(ellipse at center, rgba(${rgb(COLOR_NEON_YELLOW)}, 0) 0%, rgba(${rgb(COLOR_NEON_YELLOW)}, 0) 100%)`;
    this.cluster.style.mixBlendMode = "screen";

    this.vignette = makeOverlayDiv("sr-fx-vignette");
    fullbleed(this.vignette);
    this.vignette.style.boxShadow = `inset 0 0 0 0 rgba(${rgb(COLOR_HORIZON)}, 0)`;

    this.scanlines = makeOverlayDiv("sr-fx-scanlines");
    fullbleed(this.scanlines);
    this.scanlines.style.background =
      "repeating-linear-gradient(to bottom, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 3px)";
    this.scanlines.style.mixBlendMode = "multiply";

    this.clusterText = makeOverlayDiv("sr-fx-cluster-text");
    this.clusterText.style.position = "absolute";
    this.clusterText.style.top = "32%";
    this.clusterText.style.left = "50%";
    this.clusterText.style.transform = "translate(-50%, -50%) scale(1)";
    this.clusterText.style.fontFamily = "monospace";
    this.clusterText.style.color = `#${COLOR_NEON_YELLOW.toString(16).padStart(6, "0")}`;
    this.clusterText.style.fontSize = "32px";
    this.clusterText.style.letterSpacing = "4px";
    this.clusterText.style.textShadow = `0 0 12px rgba(${rgb(COLOR_NEON_YELLOW)}, 0.9)`;
    this.clusterText.style.opacity = "0";

    this.hintBox = makeOverlayDiv("sr-fx-hint");
    this.hintBox.style.position = "absolute";
    this.hintBox.style.top = "18%";
    this.hintBox.style.left = "50%";
    this.hintBox.style.transform = "translateX(-50%)";
    this.hintBox.style.padding = "14px 22px";
    this.hintBox.style.background = "rgba(11, 10, 20, 0.78)";
    this.hintBox.style.border = `1px solid rgba(${rgb(COLOR_NEON_CYAN)}, 0.9)`;
    this.hintBox.style.borderRadius = "6px";
    this.hintBox.style.fontFamily = "monospace";
    this.hintBox.style.fontSize = "15px";
    this.hintBox.style.letterSpacing = "2px";
    this.hintBox.style.color = `#${COLOR_NEON_CYAN.toString(16).padStart(6, "0")}`;
    this.hintBox.style.textAlign = "center";
    this.hintBox.style.opacity = "0";
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    this.hintBox.textContent = isTouchDevice
      ? "COLLECT blocks  ·  AVOID spikes  ·  TAP left/right  ·  🛡 shield  ·  ⏸ pause"
      : "COLLECT blocks  ·  AVOID spikes  ·  A/D or ◀/▶  ·  SPACE shield  ·  ESC pause";

    this.wrap.appendChild(this.flash);
    this.wrap.appendChild(this.barTint);
    this.wrap.appendChild(this.cluster);
    this.wrap.appendChild(this.vignette);
    this.wrap.appendChild(this.scanlines);
    this.wrap.appendChild(this.clusterText);
    this.wrap.appendChild(this.hintBox);
    this.host.appendChild(this.wrap);
  }

  update(args: FxUpdateArgs): void {
    // Hit flash.
    this.flash.style.background =
      `rgba(${rgb(args.flashColor)}, ${(0.18 * args.flashStrength).toFixed(3)})`;

    // Bar tint.
    this.barTint.style.background =
      `rgba(${rgb(COLOR_NEON_PINK)}, ${(0.08 * args.barPulse).toFixed(3)})`;

    // Cluster bloom (yellow glow from center).
    const cb = 0.18 * args.clusterPulse;
    this.cluster.style.background =
      `radial-gradient(ellipse at center, rgba(${rgb(COLOR_NEON_YELLOW)}, ${cb.toFixed(3)}) 0%, rgba(${rgb(COLOR_NEON_YELLOW)}, 0) 70%)`;
    this.clusterText.textContent = `▶ CLUSTER x${args.clusterPulseLen} ◀`;
    this.clusterText.style.opacity = args.clusterPulse.toFixed(3);
    const scale = 0.9 + 0.3 * args.clusterPulse;
    this.clusterText.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;

    // Beat-pulse vignette.
    const vBlur = 16 + 64 * args.beatPulse + 96 * args.barPulse;
    const vAlpha = 0.15 + 0.5 * args.beatPulse + 0.35 * args.barPulse + 0.1 * args.lowBand;
    this.vignette.style.boxShadow =
      `inset 0 0 ${Math.round(vBlur)}px ${Math.round(vBlur * 0.4)}px rgba(${rgb(COLOR_HORIZON)}, ${vAlpha.toFixed(3)})`;

    // Intro hint.
    this.hintBox.style.opacity = args.hintAlpha.toFixed(3);
  }

  dispose(): void {
    if (this.wrap.parentElement === this.host) {
      this.host.removeChild(this.wrap);
    }
  }
}

function makeOverlayDiv(id: string): HTMLDivElement {
  const d = document.createElement("div");
  d.id = id;
  return d;
}

function fullbleed(el: HTMLElement): void {
  el.style.position = "absolute";
  el.style.inset = "0";
  el.style.pointerEvents = "none";
}

function rgb(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `${r}, ${g}, ${b}`;
}
