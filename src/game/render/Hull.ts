/**
 * Hull — procedural low-poly polygon spaceship.
 *
 * Composed in a single `THREE.Group`, parented under the GameScene root.
 * Coordinates are ship-local with the nose pointing toward -Z (forward
 * down the track) and tail at +Z. All vertices are hand-authored so no
 * external model files are required.
 *
 * Parts:
 *   - body      — wedge hull built from a custom BufferGeometry.
 *                 Dark navy MeshStandardMaterial, casts shadows.
 *   - topDeck   — flat polygon on top of the body, neon cyan with mild
 *                 emissive boost so it pops in the synthwave palette.
 *   - canopy    — small chamfered BoxGeometry cockpit, glossy black
 *                 with a neon-yellow emissive inner band.
 *   - wings     — two swept-back triangular fins built as BufferGeometry,
 *                 dark navy with neon-pink edge lines.
 *   - engine    — short cylinder at the tail in neon-pink emissive.
 *   - glow      — two short additive cones extending backwards, plus
 *                 two PointLights that pulse on beats so the road lights
 *                 up under the ship.
 *   - shadow    — soft circular drop-shadow plane just above the road.
 */

import * as THREE from "three";

const COLOR_HULL_BODY = 0x1b2748;
const COLOR_HULL_TOP = 0x223a6a;
const COLOR_NEON_CYAN = 0x5df0ff;
const COLOR_NEON_PINK = 0xff5dc8;
const COLOR_NEON_YELLOW = 0xfff066;
const COLOR_CANOPY = 0x0b0a14;

const HULL_LENGTH = 2.4;
const HULL_WIDTH = 1.4;
const HULL_HEIGHT = 0.45;

const BANK_MAX_RAD = 0.55;
const BANK_VEL_GAIN = 0.35;
const BANK_SMOOTH_RATE = 12;
/** How fast the hull yaw catches up to the road tangent (rad/s coeff). */
const ROAD_YAW_SMOOTH_RATE = 6;
/** Fraction of the road tangent the hull actually yaws by. <1 keeps the
 *  rotation subtle so the ship reads as "leaning into the curve" rather
 *  than "twisting wildly". */
const HULL_YAW_TRACKING = 0.5;
/** Fraction of the road tangent the hull rolls into as a curve bank.
 *  Independent of HULL_YAW_TRACKING so we can tune them separately. */
const HULL_BANK_TRACKING = 0.25;
/** Caps so a sharp curve can never spin the hull past these limits. */
const HULL_YAW_MAX_RAD = 0.45;
const HULL_BANK_MAX_RAD = 0.35;
/** How much the chase camera tracks the road tangent — slightly less
 *  than the hull so the road still appears to curve on screen instead
 *  of being fully cancelled out by the camera. */
const CAM_YAW_TRACKING = 0.35;
const CAM_LOOK_DIST = 5.5;

export interface HullUpdateArgs {
  carLaneVisual: number;
  prevCarLaneVisual: number;
  halfRoadWorld: number;
  laneWorldWidth: number;
  beatPulse: number;
  lowBand: number;
  lastDtSec: number;
  /** World-x of the road centerline at the camera right now (≈ 0 in our
   *  camera-aligned model, but exposed for completeness). */
  centerlineX: number;
  /** Road tangent yaw in radians at the hull's z position. Positive =
   *  road curves right ahead. The hull smooths toward this so it
   *  banks INTO curves instead of staring straight forward. */
  roadYaw: number;
  /** Road tangent pitch in radians at the hull's z position. Positive =
   *  road climbs ahead. Hull's nose tilts to match (smoothed). */
  roadPitch: number;
  /** Y position of the road surface at the hull's z (in our camera-
   *  aligned frame the centerline at the hull = 0, so this is the
   *  delta the hull rides on top of any per-frame elevation). */
  roadHeight: number;
  /** Y position of the road surface a bit ahead (used by the chase
   *  camera's lookAt so the camera looks ALONG the slope). */
  roadHeightAhead: number;
  /** Fraction in [0,1] of the shield's remaining lifetime — 0 means
   *  inactive, 1 means just activated. */
  shieldFraction: number;
}

export class Hull {
  readonly root: THREE.Group;
  readonly group: THREE.Group;

  private readonly body: THREE.Mesh;
  private readonly topDeck: THREE.Mesh;
  private readonly canopy: THREE.Mesh;
  private readonly canopyGlass: THREE.Mesh;
  private readonly wingLeft: THREE.Mesh;
  private readonly wingRight: THREE.Mesh;
  private readonly engine: THREE.Mesh;
  private readonly glowLeft: THREE.Mesh;
  private readonly glowRight: THREE.Mesh;
  private readonly engineLight: THREE.PointLight;
  private readonly shadow: THREE.Mesh;
  private readonly shieldInner: THREE.Mesh;
  private readonly shieldOuter: THREE.LineSegments;
  private readonly shieldInnerMaterial: THREE.MeshBasicMaterial;
  private readonly shieldOuterMaterial: THREE.LineBasicMaterial;

  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  private steerYaw = 0;
  private roadYawSmooth = 0;
  private roadPitchSmooth = 0;
  private roadHeightSmooth = 0;
  private cameraXSmooth = 0;
  private cameraYSmooth = 3.0;

  constructor(parent: THREE.Object3D) {
    this.root = new THREE.Group();
    this.root.name = "Hull";
    parent.add(this.root);

    this.group = new THREE.Group();
    this.group.name = "HullBody";
    this.root.add(this.group);

    // ---- Body (hand-authored wedge) ----
    const bodyMat = this.track(new THREE.MeshStandardMaterial({
      color: COLOR_HULL_BODY,
      roughness: 0.55,
      metalness: 0.25,
    }));
    const bodyGeo = this.track(buildBodyGeometry());
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.castShadow = true;
    this.body.receiveShadow = false;
    this.group.add(this.body);

    // ---- Top deck overlay (cyan emissive) ----
    const topMat = this.track(new THREE.MeshStandardMaterial({
      color: COLOR_HULL_TOP,
      emissive: COLOR_NEON_CYAN,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.4,
    }));
    const topGeo = this.track(buildTopDeckGeometry());
    this.topDeck = new THREE.Mesh(topGeo, topMat);
    this.topDeck.castShadow = true;
    this.group.add(this.topDeck);

    // ---- Cockpit canopy (chamfered box) ----
    const canopyMat = this.track(new THREE.MeshStandardMaterial({
      color: COLOR_CANOPY,
      roughness: 0.2,
      metalness: 0.6,
    }));
    const canopyGeo = this.track(new THREE.BoxGeometry(0.32, 0.18, 0.55));
    this.canopy = new THREE.Mesh(canopyGeo, canopyMat);
    this.canopy.position.set(0, HULL_HEIGHT + 0.05, -0.35);
    this.canopy.castShadow = true;
    this.group.add(this.canopy);

    // Inner glowing canopy band — small flatter box on top of the canopy.
    const glassMat = this.track(new THREE.MeshBasicMaterial({
      color: COLOR_NEON_YELLOW,
      transparent: true,
      opacity: 0.85,
    }));
    const glassGeo = this.track(new THREE.BoxGeometry(0.18, 0.08, 0.35));
    this.canopyGlass = new THREE.Mesh(glassGeo, glassMat);
    this.canopyGlass.position.set(0, HULL_HEIGHT + 0.13, -0.42);
    this.group.add(this.canopyGlass);

    // ---- Wings (swept-back triangles) ----
    const wingMat = this.track(new THREE.MeshStandardMaterial({
      color: COLOR_HULL_BODY,
      roughness: 0.55,
      metalness: 0.25,
      side: THREE.DoubleSide,
    }));
    this.wingLeft = new THREE.Mesh(this.track(buildWingGeometry(-1)), wingMat);
    this.wingRight = new THREE.Mesh(this.track(buildWingGeometry(+1)), wingMat);
    this.wingLeft.castShadow = true;
    this.wingRight.castShadow = true;
    this.group.add(this.wingLeft);
    this.group.add(this.wingRight);

    // Neon-pink edge highlights along the wing trailing edges.
    const wingEdgeMat = this.track(new THREE.LineBasicMaterial({
      color: COLOR_NEON_PINK,
      transparent: true,
      opacity: 0.95,
    }));
    const wingEdgeLeft = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(this.wingLeft.geometry)), wingEdgeMat);
    const wingEdgeRight = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(this.wingRight.geometry)), wingEdgeMat);
    this.wingLeft.add(wingEdgeLeft);
    this.wingRight.add(wingEdgeRight);

    // ---- Engine grille ----
    const engineMat = this.track(new THREE.MeshStandardMaterial({
      color: COLOR_NEON_PINK,
      emissive: COLOR_NEON_PINK,
      emissiveIntensity: 0.85,
      roughness: 0.35,
      metalness: 0.5,
    }));
    const engineGeo = this.track(new THREE.CylinderGeometry(0.18, 0.22, 0.18, 12));
    this.engine = new THREE.Mesh(engineGeo, engineMat);
    this.engine.rotation.x = Math.PI / 2;
    this.engine.position.set(0, HULL_HEIGHT * 0.45, HULL_LENGTH / 2 - 0.05);
    this.group.add(this.engine);

    // ---- Engine glow cones (additive) ----
    const glowMat = this.track(new THREE.MeshBasicMaterial({
      color: COLOR_NEON_PINK,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const glowGeo = this.track(new THREE.ConeGeometry(0.16, 0.9, 12, 1, true));
    this.glowLeft = new THREE.Mesh(glowGeo, glowMat);
    this.glowRight = new THREE.Mesh(glowGeo, glowMat);
    this.glowLeft.rotation.x = -Math.PI / 2;
    this.glowRight.rotation.x = -Math.PI / 2;
    this.glowLeft.position.set(-0.22, HULL_HEIGHT * 0.4, HULL_LENGTH / 2 + 0.4);
    this.glowRight.position.set(+0.22, HULL_HEIGHT * 0.4, HULL_LENGTH / 2 + 0.4);
    this.group.add(this.glowLeft);
    this.group.add(this.glowRight);

    // ---- Single beat-reactive point light tucked behind the engine ----
    this.engineLight = new THREE.PointLight(COLOR_NEON_PINK, 1.6, 8, 2);
    this.engineLight.position.set(0, HULL_HEIGHT * 0.45, HULL_LENGTH / 2 + 0.5);
    this.engineLight.castShadow = false;
    this.group.add(this.engineLight);

    // ---- Soft drop shadow on the road ----
    const shadowMat = this.track(new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }));
    const shadowGeo = this.track(new THREE.CircleGeometry(HULL_WIDTH * 0.7, 16));
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0, 0.025, 0.1);
    this.root.add(this.shadow);

    // ---- Force-field shield (icosahedron + wireframe overlay) ----
    // Inner translucent shell for the glow, outer wireframe for the
    // sci-fi force-field facets. Hidden by default; toggled by Hull.update.
    const shieldRadius = 1.6;
    const shieldInnerGeo = this.track(new THREE.IcosahedronGeometry(shieldRadius, 1));
    this.shieldInnerMaterial = this.track(new THREE.MeshBasicMaterial({
      color: COLOR_NEON_CYAN,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.shieldInner = new THREE.Mesh(shieldInnerGeo, this.shieldInnerMaterial);
    this.shieldInner.position.set(0, 0.35, 0);
    this.shieldInner.visible = false;

    const shieldEdgesGeo = this.track(new THREE.EdgesGeometry(shieldInnerGeo));
    this.shieldOuterMaterial = this.track(new THREE.LineBasicMaterial({
      color: COLOR_NEON_CYAN,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    this.shieldOuter = new THREE.LineSegments(shieldEdgesGeo, this.shieldOuterMaterial);
    this.shieldOuter.position.set(0, 0.35, 0);
    this.shieldOuter.visible = false;

    this.group.add(this.shieldInner);
    this.group.add(this.shieldOuter);
  }

  update(args: HullUpdateArgs, camera: THREE.PerspectiveCamera): void {
    const halfRoad = args.halfRoadWorld;
    const laneX = -halfRoad + (args.carLaneVisual + 0.5) * args.laneWorldWidth + args.centerlineX;

    // Steering bank target from lane velocity (roll around forward axis).
    const dt = Math.max(1 / 240, args.lastDtSec);
    const laneVel = (args.carLaneVisual - args.prevCarLaneVisual) / dt;
    const targetBank = clamp(-laneVel * BANK_VEL_GAIN, -BANK_MAX_RAD, BANK_MAX_RAD);
    const kBank = Math.min(1, dt * BANK_SMOOTH_RATE);
    this.steerYaw += (targetBank - this.steerYaw) * kBank;

    // Smooth the road-tangent yaw + pitch so the hull's heading lags
    // the road slightly, like a real chase target.
    const kYaw = Math.min(1, dt * ROAD_YAW_SMOOTH_RATE);
    this.roadYawSmooth += (args.roadYaw - this.roadYawSmooth) * kYaw;
    this.roadPitchSmooth += (args.roadPitch - this.roadPitchSmooth) * kYaw;
    // Y also lags so we don't read every tiny noise — a slightly faster
    // rate keeps the hull glued to the road even on sharp drops.
    const kY = Math.min(1, dt * 14);
    this.roadHeightSmooth += (args.roadHeight - this.roadHeightSmooth) * kY;

    // ---- Apply orientation ----
    // NOTE on Three.js sign convention: rotation.y is right-handed
    // around +Y, so a *positive* rotation rotates the ship's forward
    // (-Z) toward -X (i.e. turns the ship LEFT). To face a road that
    // bends right (positive roadYaw) we therefore apply NEGATIVE
    // rotation.y. The user-visible effect is "ship leans into the curve
    // in the same direction the road is bending."
    const yawAmount = clamp(
      this.roadYawSmooth * HULL_YAW_TRACKING,
      -HULL_YAW_MAX_RAD, HULL_YAW_MAX_RAD,
    );
    const curveBank = clamp(
      this.roadYawSmooth * HULL_BANK_TRACKING,
      -HULL_BANK_MAX_RAD, HULL_BANK_MAX_RAD,
    );

    this.root.position.set(laneX, 0.05 + this.roadHeightSmooth, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.rotation.y = -yawAmount;
    // Curve bank and steer bank ADD. curveBank > 0 when curving right;
    // we subtract so the right wing tilts DOWN (rotation.z < 0).
    this.group.rotation.z = this.steerYaw - curveBank;
    // Pitch: nose tilts up on climbs (roadPitch > 0 = climbing) and
    // down on drops. Combined with the existing lateral lean.
    this.group.rotation.x = this.roadPitchSmooth - this.steerYaw * 0.18;

    // Beat reactivity: engine point-light + canopy + cone alpha.
    const pulse = 1 + 0.25 * args.beatPulse + 0.15 * args.lowBand;
    this.engineLight.intensity = 1.6 * pulse;
    (this.glowLeft.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.35 * args.beatPulse;
    (this.canopyGlass.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.25 * args.beatPulse;
    (this.topDeck.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.45 + 0.4 * args.beatPulse;

    // Slight breathing scale on bar/beat for tactile feel.
    const s = 1 + 0.04 * args.beatPulse;
    this.group.scale.setScalar(s);

    // ---- Shield ----
    this.updateShield(args.shieldFraction, dt);

    // Chase camera: lateral lerp toward the ship, plus a mild yaw track
    // so the curving road stays visible on screen. Same sign rule as
    // the hull — bending right (roadYaw > 0) → look right (lookX > laneX).
    // Y follows the road's height so the camera rides the hills.
    const aPos = 1 - Math.pow(1 - 0.18, dt * 60);
    this.cameraXSmooth += (laneX - this.cameraXSmooth) * aPos;
    const camYTarget = this.roadHeightSmooth + 3.0;
    this.cameraYSmooth += (camYTarget - this.cameraYSmooth) * aPos;
    camera.position.x = this.cameraXSmooth;
    camera.position.y = this.cameraYSmooth;
    camera.position.z = 5.5;
    const camYaw = this.roadYawSmooth * CAM_YAW_TRACKING;
    const lookX = laneX + Math.sin(camYaw) * CAM_LOOK_DIST;
    const lookZ = -Math.cos(camYaw) * CAM_LOOK_DIST;
    // Look at a point along the road's elevation ahead so the camera
    // tilts with the slope (looking down on drops, up on climbs).
    const lookY = args.roadHeightAhead + 0.7;
    camera.lookAt(lookX, lookY, lookZ);
  }

  /**
   * Drives the shield mesh's visibility, opacity and spin.
   *   shieldFraction ∈ [0,1] — 0 = inactive, 1 = just activated.
   * Last 25% of lifetime flickers so the player has a visual warning
   * the shield is about to drop.
   */
  private updateShield(shieldFraction: number, dt: number): void {
    if (shieldFraction <= 0) {
      this.shieldInner.visible = false;
      this.shieldOuter.visible = false;
      return;
    }
    this.shieldInner.visible = true;
    this.shieldOuter.visible = true;

    // Slow spin on independent axes so it reads as a force field.
    this.shieldOuter.rotation.y += dt * 0.9;
    this.shieldOuter.rotation.x += dt * 0.4;
    this.shieldInner.rotation.y -= dt * 0.6;
    this.shieldInner.rotation.z += dt * 0.35;

    // Flicker when low on charge (last 25% of lifetime).
    let alphaMod = 1;
    if (shieldFraction < 0.25) {
      const flicker = 0.55 + 0.45 * Math.sin(performance.now() * 0.02);
      alphaMod = flicker;
    }
    this.shieldInnerMaterial.opacity = 0.12 * alphaMod * (0.5 + 0.5 * shieldFraction);
    this.shieldOuterMaterial.opacity = 0.85 * alphaMod;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.root.parent?.remove(this.root);
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(obj: T): T {
    if ((obj as { isBufferGeometry?: boolean }).isBufferGeometry) {
      this.geometries.push(obj as THREE.BufferGeometry);
    } else {
      this.materials.push(obj as THREE.Material);
    }
    return obj;
  }
}

// ----------------------------------------------------------------------
// Geometry builders

function buildBodyGeometry(): THREE.BufferGeometry {
  // 12 vertices: front, mid, tail × 4 (bot-left, bot-right, top-left, top-right).
  // Ship faces -Z; +Z is the tail.
  const H = HULL_HEIGHT;
  const verts = new Float32Array([
    // Front (narrow)
    -0.14, 0.04, -1.20,   //  0 fbl
     0.14, 0.04, -1.20,   //  1 fbr
    -0.10, 0.22, -1.18,   //  2 ftl
     0.10, 0.22, -1.18,   //  3 ftr
    // Mid (widest)
    -0.55, 0.04,  0.10,   //  4 mbl
     0.55, 0.04,  0.10,   //  5 mbr
    -0.42, 0.36,  0.05,   //  6 mtl
     0.42, 0.36,  0.05,   //  7 mtr
    // Tail (wide, slightly tapered)
    -0.50, 0.04,  1.10,   //  8 tbl
     0.50, 0.04,  1.10,   //  9 tbr
    -0.40, H,     1.05,   // 10 ttl
     0.40, H,     1.05,   // 11 ttr
  ]);
  const idx = new Uint16Array([
    // Bottom: 2 quads (front→mid, mid→tail), each = 2 triangles.
    0,1,5,  0,5,4,
    4,5,9,  4,9,8,
    // Top deck: 2 quads.
    2,6,7,  2,7,3,
    6,10,11, 6,11,7,
    // Left side: 2 quads.
    0,4,6,  0,6,2,
    4,8,10, 4,10,6,
    // Right side: 2 quads.
    1,3,7,  1,7,5,
    5,7,11, 5,11,9,
    // Nose cap (close the front): triangle.
    0,2,3,  0,3,1,
    // Tail cap (close the back): quad.
    8,9,11, 8,11,10,
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

function buildTopDeckGeometry(): THREE.BufferGeometry {
  // Thin polygon hovering just above the body's top deck so it gets
  // its own emissive cyan look without z-fighting.
  const H = HULL_HEIGHT + 0.012;
  const verts = new Float32Array([
    -0.08, H, -1.16,
     0.08, H, -1.16,
    -0.32, H,  0.05,
     0.32, H,  0.05,
    -0.30, H,  1.02,
     0.30, H,  1.02,
  ]);
  const idx = new Uint16Array([
    0,1,3,  0,3,2,
    2,3,5,  2,5,4,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

function buildWingGeometry(side: -1 | 1): THREE.BufferGeometry {
  // Swept-back triangular fin attached at the mid-tail of the body.
  // `side` flips x for left vs right.
  const sx = side;
  const root = 0.46 * sx;
  const outer = 1.05 * sx;
  const y = 0.16;
  const verts = new Float32Array([
    root, y,  0.20,   // inner-front
    root, y,  1.05,   // inner-back
    outer, y, 1.30,   // outer-back
    outer * 0.7, y, 0.55, // outer-front
  ]);
  // Two triangles forming the wing top.
  // Wind order chosen so the wing's upward-facing normal is +Y on both sides.
  const idx = side === 1
    ? new Uint16Array([0, 1, 2, 0, 2, 3])
    : new Uint16Array([0, 2, 1, 0, 3, 2]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
