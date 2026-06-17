/**
 * SceneEnv — synthwave sky, sun, fog, and lighting rig.
 *
 * Owned by main.ts for the page lifetime and shared across races, since
 * the aesthetic is constant. GameScene calls `update(beatPulse, barPulse,
 * lowBand)` each render frame to drive the sun + horizon-glow pulse.
 *
 * Visual elements:
 *   - Sky dome: large inverted SphereGeometry with a CanvasTexture baked
 *     from a vertical gradient (COLOR_BG_TOP → COLOR_BG_BOTTOM), used as
 *     a static background.
 *   - Horizon glow strip: a thin neon-pink plane far away on +Z and -Z,
 *     alpha pulses with barPulse + low band.
 *   - Sun: billboarded sprite with a baked "sliced synthwave sun" texture
 *     (concentric ring glow + horizontal bars). Scale pulses on beat +
 *     low band.
 *   - Lights: AmbientLight (purple fill) + DirectionalLight (pink "sun"
 *     casting shadows) + HemisphereLight (sky/ground tint).
 */

import * as THREE from "three";

import type { QualityConfig } from "../quality.js";

const COLOR_BG_TOP = 0x14082a;
const COLOR_BG_BOTTOM = 0x0b0a14;
const COLOR_HORIZON = 0xff2d8e;
const COLOR_SUN = 0xff7adf;
const COLOR_NEON_PINK = 0xff5dc8;

const SKY_RADIUS = 500;
const SUN_DISTANCE = 380;
const SUN_HEIGHT = 18;
const SUN_BASE_WORLD_SIZE = 95;

export class SceneEnv {
  readonly root: THREE.Group;
  readonly directional: THREE.DirectionalLight;
  readonly ambient: THREE.AmbientLight;
  readonly hemisphere: THREE.HemisphereLight;

  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.Sprite;
  private readonly horizonStripFront: THREE.Mesh;
  private readonly horizonStripBack: THREE.Mesh;
  private readonly horizonStripMaterial: THREE.MeshBasicMaterial;

  constructor(parent: THREE.Scene, quality: QualityConfig) {
    this.root = new THREE.Group();
    this.root.name = "SceneEnv";
    parent.add(this.root);

    // ---- Sky dome ----
    const skyTexture = buildSkyTexture(quality.skyTextureWidth);
    const skyGeom = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
    const skyMaterial = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(skyGeom, skyMaterial);
    this.sky.renderOrder = -10;
    this.root.add(this.sky);

    // ---- Sun (billboarded) ----
    const sunTexture = buildSunTexture();
    const sunMaterial = new THREE.SpriteMaterial({
      map: sunTexture,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.NormalBlending,
    });
    this.sun = new THREE.Sprite(sunMaterial);
    this.sun.position.set(0, SUN_HEIGHT, -SUN_DISTANCE);
    this.sun.scale.set(SUN_BASE_WORLD_SIZE, SUN_BASE_WORLD_SIZE, 1);
    this.sun.renderOrder = -9;
    this.root.add(this.sun);

    // ---- Horizon glow strips (front + back so it works regardless of facing) ----
    this.horizonStripMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_HORIZON,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const stripGeom = new THREE.PlaneGeometry(2 * SKY_RADIUS, 1.6);
    this.horizonStripFront = new THREE.Mesh(stripGeom, this.horizonStripMaterial);
    this.horizonStripFront.position.set(0, 0.02, -SKY_RADIUS * 0.6);
    this.horizonStripFront.renderOrder = -8;
    this.root.add(this.horizonStripFront);

    this.horizonStripBack = new THREE.Mesh(stripGeom.clone(), this.horizonStripMaterial);
    this.horizonStripBack.position.set(0, 0.02, SKY_RADIUS * 0.6);
    this.horizonStripBack.renderOrder = -8;
    this.root.add(this.horizonStripBack);

    // ---- Lights ----
    this.ambient = new THREE.AmbientLight(0x4a3a8a, 0.45);
    this.root.add(this.ambient);

    this.hemisphere = new THREE.HemisphereLight(0xff5dc8, 0xa080ff, 0.25);
    this.root.add(this.hemisphere);

    this.directional = new THREE.DirectionalLight(0xff7adf, 0.9);
    this.directional.position.set(0, 30, -40);
    this.directional.target.position.set(0, 0, 0);

    if (quality.shadows) {
      this.directional.castShadow = true;
      this.directional.shadow.mapSize.set(1024, 1024);
      this.directional.shadow.camera.near = 1;
      this.directional.shadow.camera.far = 120;
      this.directional.shadow.camera.left = -25;
      this.directional.shadow.camera.right = 25;
      this.directional.shadow.camera.top = 25;
      this.directional.shadow.camera.bottom = -25;
      this.directional.shadow.bias = -0.0008;
    }

    this.root.add(this.directional);
    this.root.add(this.directional.target);
  }

  /**
   * Per-frame reactive update.
   *   beatPulse / barPulse — in [0, 1], decayed elsewhere.
   *   lowBand            — live low-frequency energy in [0, 1].
   */
  update(beatPulse: number, barPulse: number, lowBand: number): void {
    const sunScale = SUN_BASE_WORLD_SIZE * (1 + 0.08 * beatPulse + 0.05 * lowBand);
    this.sun.scale.set(sunScale, sunScale, 1);

    const glowAlpha = 0.45 + 0.35 * barPulse + 0.25 * lowBand;
    this.horizonStripMaterial.opacity = Math.min(1, glowAlpha);

    // Subtle directional-light pulse on bar beats so shadows breathe.
    this.directional.intensity = 0.9 + 0.25 * barPulse;
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    this.sky.geometry.dispose();
    (this.sky.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.sky.material as THREE.MeshBasicMaterial).dispose();
    (this.sun.material as THREE.SpriteMaterial).map?.dispose();
    (this.sun.material as THREE.SpriteMaterial).dispose();
    this.horizonStripFront.geometry.dispose();
    this.horizonStripBack.geometry.dispose();
    this.horizonStripMaterial.dispose();
  }
}

// ----------------------------------------------------------------------
// Procedural textures

function buildSkyTexture(width: number = 1024): THREE.Texture {
  const W = width;
  const H = Math.floor(width / 2);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.Texture();
  }

  // Equirectangular-ish: equator at v=0.5. Top half = above horizon
  // (dark purple gradient), bottom half = below horizon (deeper, darker).
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, hex(COLOR_BG_TOP));
  grad.addColorStop(0.4, mixHex(COLOR_BG_TOP, COLOR_BG_BOTTOM, 0.3));
  grad.addColorStop(0.5, mixHex(COLOR_BG_TOP, COLOR_HORIZON, 0.35));
  grad.addColorStop(0.52, mixHex(COLOR_BG_TOP, COLOR_HORIZON, 0.2));
  grad.addColorStop(0.6, mixHex(COLOR_BG_BOTTOM, COLOR_BG_TOP, 0.25));
  grad.addColorStop(1, hex(COLOR_BG_BOTTOM));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Soft horizon glow band — a faint additive smear at the equator so
  // the meeting line looks lit.
  ctx.globalCompositeOperation = "lighter";
  const glow = ctx.createLinearGradient(0, H * 0.46, 0, H * 0.56);
  glow.addColorStop(0, "rgba(255, 45, 142, 0)");
  glow.addColorStop(0.5, "rgba(255, 45, 142, 0.45)");
  glow.addColorStop(1, "rgba(255, 45, 142, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, H * 0.46, W, H * 0.1);
  ctx.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function buildSunTexture(): THREE.Texture {
  const SIZE = 512;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.Texture();
  }

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const baseR = SIZE * 0.38;

  // Outer halo rings.
  for (let i = 3; i >= 1; i--) {
    ctx.beginPath();
    ctx.arc(cx, cy, baseR + i * 12, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 93, 200, ${0.18 + i * 0.07})`;
    ctx.stroke();
  }

  // Sun disc with radial gradient: hot pink center → cooler edge.
  const disc = ctx.createRadialGradient(cx, cy, baseR * 0.05, cx, cy, baseR);
  disc.addColorStop(0, "rgba(255, 230, 255, 0.95)");
  disc.addColorStop(0.35, hex(COLOR_SUN));
  disc.addColorStop(0.85, hex(COLOR_NEON_PINK));
  disc.addColorStop(1, "rgba(255, 93, 200, 0)");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.fill();

  // Horizontal bars cutting the lower half of the sun (synthwave classic).
  // Drawn in the sky's bottom color so they cleanly "subtract" from the
  // sun without affecting the sky around it (sprite material handles alpha).
  ctx.globalCompositeOperation = "destination-out";
  const bars = 5;
  for (let i = 0; i < bars; i++) {
    const t = (i + 0.5) / bars;
    const y = cy + t * baseR;
    const h = 4 + i * 2;
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(cx - baseR, y - h / 2, baseR * 2, h);
  }
  ctx.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ----------------------------------------------------------------------
// Helpers

function createCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  // Non-DOM environments (tests) — return a dummy. Materials will fall
  // back to default colors.
  return { width: w, height: h, getContext: () => null } as unknown as HTMLCanvasElement;
}

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

function mixHex(a: number, b: number, t: number): string {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar * (1 - t) + br * t);
  const g = Math.round(ag * (1 - t) + bg * t);
  const bl = Math.round(ab * (1 - t) + bb * t);
  return `rgb(${r}, ${g}, ${bl})`;
}
