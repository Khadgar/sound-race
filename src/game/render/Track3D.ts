/**
 * Track3D — real-3D curved road built from the existing curvature track.
 *
 * Holds per-sub-mesh geometries (road surface, side rails, rail-top neon,
 * lane dividers, beat-grid lines, current-lane glow) sized once and
 * rebuilt in-place each frame. Geometry is "camera-aligned": x=0 is the
 * road centerline at the camera's current song position, +z is behind
 * the camera, -z is forward into the song.
 *
 * Per-frame inputs are passed via update(); GameScene owns the song
 * state and forwards it here.
 */

import * as THREE from "three";

import type { TrackData } from "../../audio/types.js";
import { sampleSeries } from "../track.js";

const SAMPLES = 40;
const VIEW_SECONDS = 2.4;
/** Seconds of road rendered BEHIND the camera/ship so the hull sits on
 *  a continuous strip with road visible behind it too. */
const VIEW_SECONDS_BEHIND = 0.4;
const WORLD_SPEED_BASE = 7;
const RAIL_HEIGHT = 0.55;
const CURVE_WORLD_SCALE = 1.5;
/** Maximum vertical amplitude of the rollercoaster hills, in world
 *  units, peak vs. trough. The road's centerline at y=0 corresponds
 *  to elevation=0; ±1 in the audio elevation series maps to
 *  ±ELEVATION_SCALE in world y. */
const ELEVATION_SCALE = 3.5;

const COLOR_ROAD = 0x100a22;
const COLOR_RAIL_LEFT = 0x1a1538;
const COLOR_RAIL_RIGHT = 0x2a1d4a;
const COLOR_NEON_PINK = 0xff5dc8;
const COLOR_NEON_CYAN = 0x5df0ff;
const COLOR_NEON_GRID = 0x6a3aff;

const LANE_WORLD_WIDTH = 2.4;

/** Cap on beat-grid lines rendered at once. */
const MAX_BEAT_LINES = 32;

export interface TrackUpdateArgs {
  songTime: number;
  speedMult: number;
  carLaneVisual: number;
  beatPulse: number;
}

export class Track3D {
  readonly root: THREE.Group;

  private readonly laneCount: number;
  private readonly halfRoadWorld: number;

  private readonly centerline: Float32Array;
  private readonly elevation: Float32Array;
  private readonly hopSeconds: number;
  private readonly beats: Float32Array;

  private readonly surface: TrackSurface;
  private readonly rails: TrackRails;
  private readonly railTops: TrackRailTops;
  private readonly dividers: TrackDividers;
  private readonly laneGlow: TrackLaneGlow;
  private readonly beatGrid: TrackBeatGrid;

  // Scratch row buffers reused every frame to avoid GC.
  private readonly rowCxRel: Float32Array;
  private readonly rowY: Float32Array;
  private readonly rowZ: Float32Array;

  constructor(parent: THREE.Object3D, track: TrackData, centerline: Float32Array) {
    this.root = new THREE.Group();
    this.root.name = "Track3D";
    parent.add(this.root);

    this.laneCount = track.laneCount;
    this.halfRoadWorld = (this.laneCount * LANE_WORLD_WIDTH) / 2;
    this.centerline = centerline;
    this.elevation = track.elevation;
    this.hopSeconds = track.hopSeconds;
    this.beats = track.beats;

    this.rowCxRel = new Float32Array(SAMPLES + 1);
    this.rowY = new Float32Array(SAMPLES + 1);
    this.rowZ = new Float32Array(SAMPLES + 1);

    this.surface = new TrackSurface(this.root, this.halfRoadWorld);
    this.rails = new TrackRails(this.root, this.halfRoadWorld);
    this.railTops = new TrackRailTops(this.root);
    this.dividers = new TrackDividers(this.root, this.laneCount);
    this.laneGlow = new TrackLaneGlow(this.root);
    this.beatGrid = new TrackBeatGrid(this.root);
  }

  update(args: TrackUpdateArgs): void {
    const { songTime, speedMult, carLaneVisual, beatPulse } = args;
    const halfRoad = this.halfRoadWorld;
    const totalRange = VIEW_SECONDS + VIEW_SECONDS_BEHIND;

    // ---- Sample rows along the road ----
    // X and Z are camera-aligned so the centerline at the hull is at
    // world x=0 and the hull sits at world z=0. Y is WORLD-ABSOLUTE so
    // the hull + camera can simply ride along the elevation series for
    // a rollercoaster feel (instead of the road bobbing under them).
    const cxNow = this.centerlineWorldAt(songTime);
    for (let i = 0; i <= SAMPLES; i++) {
      // Spread samples across [-VIEW_SECONDS_BEHIND, +VIEW_SECONDS].
      const dt = -VIEW_SECONDS_BEHIND + (i / SAMPLES) * totalRange;
      const tAt = songTime + dt;
      this.rowCxRel[i] = this.centerlineWorldAt(tAt) - cxNow;
      this.rowY[i] = this.elevationWorldAt(tAt);
      this.rowZ[i] = -WORLD_SPEED_BASE * speedMult * dt;
    }

    // ---- Rebuild sub-meshes ----
    this.surface.update(this.rowCxRel, this.rowY, this.rowZ, halfRoad);
    this.rails.update(this.rowCxRel, this.rowY, this.rowZ, halfRoad, RAIL_HEIGHT);
    this.railTops.update(this.rowCxRel, this.rowY, this.rowZ, halfRoad, RAIL_HEIGHT);
    this.dividers.update(this.rowCxRel, this.rowY, this.rowZ, halfRoad);
    this.laneGlow.update(this.rowCxRel, this.rowY, this.rowZ, halfRoad, carLaneVisual, beatPulse);
    this.beatGrid.update(
      this.beats, songTime, speedMult,
      this.centerline, this.elevation, this.hopSeconds,
      halfRoad, cxNow,
    );
  }

  dispose(): void {
    this.surface.dispose();
    this.rails.dispose();
    this.railTops.dispose();
    this.dividers.dispose();
    this.laneGlow.dispose();
    this.beatGrid.dispose();
    this.root.parent?.remove(this.root);
  }

  private centerlineWorldAt(t: number): number {
    return sampleSeries(this.centerline, this.hopSeconds, t) * CURVE_WORLD_SCALE;
  }

  private elevationWorldAt(t: number): number {
    return sampleSeries(this.elevation, this.hopSeconds, t) * ELEVATION_SCALE;
  }
}

// ----------------------------------------------------------------------
// Sub-mesh helpers

/** Triangle-strip indices for a 2-vertex-per-row strip with `rows` rows. */
function buildStripIndices(rows: number): Uint16Array {
  const tris = (rows - 1) * 2;
  const idx = new Uint16Array(tris * 3);
  let o = 0;
  for (let i = 0; i < rows - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    idx[o++] = a; idx[o++] = b; idx[o++] = d;
    idx[o++] = a; idx[o++] = d; idx[o++] = c;
  }
  return idx;
}

class TrackSurface {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;

  constructor(parent: THREE.Object3D, halfRoad: number) {
    void halfRoad;
    const rows = SAMPLES + 1;
    this.positions = new Float32Array(rows * 2 * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(buildStripIndices(rows), 1));
    this.geometry.computeVertexNormals();

    this.material = new THREE.MeshStandardMaterial({
      color: COLOR_ROAD,
      roughness: 0.85,
      metalness: 0.0,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    parent.add(this.mesh);
  }

  update(rowCxRel: Float32Array, rowY: Float32Array, rowZ: Float32Array, halfRoad: number): void {
    const p = this.positions;
    const rows = SAMPLES + 1;
    let o = 0;
    for (let i = 0; i < rows; i++) {
      const cx = rowCxRel[i]!;
      const y = rowY[i]!;
      const z = rowZ[i]!;
      p[o++] = cx - halfRoad; p[o++] = y; p[o++] = z; // left
      p[o++] = cx + halfRoad; p[o++] = y; p[o++] = z; // right
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

class TrackRails {
  private readonly meshLeft: THREE.Mesh;
  private readonly meshRight: THREE.Mesh;
  private readonly posLeft: Float32Array;
  private readonly posRight: Float32Array;
  private readonly geoLeft: THREE.BufferGeometry;
  private readonly geoRight: THREE.BufferGeometry;
  private readonly matLeft: THREE.MeshStandardMaterial;
  private readonly matRight: THREE.MeshStandardMaterial;

  constructor(parent: THREE.Object3D, halfRoad: number) {
    void halfRoad;
    const rows = SAMPLES + 1;
    this.posLeft = new Float32Array(rows * 2 * 3);
    this.posRight = new Float32Array(rows * 2 * 3);
    this.geoLeft = new THREE.BufferGeometry();
    this.geoLeft.setAttribute("position", new THREE.BufferAttribute(this.posLeft, 3));
    this.geoLeft.setIndex(new THREE.BufferAttribute(buildStripIndices(rows), 1));
    this.geoRight = new THREE.BufferGeometry();
    this.geoRight.setAttribute("position", new THREE.BufferAttribute(this.posRight, 3));
    this.geoRight.setIndex(new THREE.BufferAttribute(buildStripIndices(rows), 1));

    this.matLeft = new THREE.MeshStandardMaterial({
      color: COLOR_RAIL_LEFT,
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    this.matRight = new THREE.MeshStandardMaterial({
      color: COLOR_RAIL_RIGHT,
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    this.meshLeft = new THREE.Mesh(this.geoLeft, this.matLeft);
    this.meshRight = new THREE.Mesh(this.geoRight, this.matRight);
    this.meshLeft.castShadow = false;
    this.meshRight.castShadow = false;
    this.meshLeft.receiveShadow = true;
    this.meshRight.receiveShadow = true;
    parent.add(this.meshLeft);
    parent.add(this.meshRight);
  }

  update(
    rowCxRel: Float32Array, rowY: Float32Array, rowZ: Float32Array,
    halfRoad: number, railHeight: number,
  ): void {
    const rows = SAMPLES + 1;
    const pl = this.posLeft;
    const pr = this.posRight;
    let oL = 0, oR = 0;
    for (let i = 0; i < rows; i++) {
      const cx = rowCxRel[i]!;
      const y = rowY[i]!;
      const z = rowZ[i]!;
      const xL = cx - halfRoad;
      const xR = cx + halfRoad;
      // Left rail: bottom (road y) then top (road y + railHeight).
      pl[oL++] = xL; pl[oL++] = y;              pl[oL++] = z;
      pl[oL++] = xL; pl[oL++] = y + railHeight; pl[oL++] = z;
      // Right rail.
      pr[oR++] = xR; pr[oR++] = y;              pr[oR++] = z;
      pr[oR++] = xR; pr[oR++] = y + railHeight; pr[oR++] = z;
    }
    (this.geoLeft.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geoRight.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.geoLeft.computeVertexNormals();
    this.geoRight.computeVertexNormals();
  }

  dispose(): void {
    this.geoLeft.dispose();
    this.geoRight.dispose();
    this.matLeft.dispose();
    this.matRight.dispose();
  }
}

class TrackRailTops {
  private readonly lineLeft: THREE.Line;
  private readonly lineRight: THREE.Line;
  private readonly posLeft: Float32Array;
  private readonly posRight: Float32Array;
  private readonly geoLeft: THREE.BufferGeometry;
  private readonly geoRight: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;

  constructor(parent: THREE.Object3D) {
    const rows = SAMPLES + 1;
    this.posLeft = new Float32Array(rows * 3);
    this.posRight = new Float32Array(rows * 3);
    this.geoLeft = new THREE.BufferGeometry();
    this.geoRight = new THREE.BufferGeometry();
    this.geoLeft.setAttribute("position", new THREE.BufferAttribute(this.posLeft, 3));
    this.geoRight.setAttribute("position", new THREE.BufferAttribute(this.posRight, 3));
    this.material = new THREE.LineBasicMaterial({
      color: COLOR_NEON_PINK,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.lineLeft = new THREE.Line(this.geoLeft, this.material);
    this.lineRight = new THREE.Line(this.geoRight, this.material);
    this.lineLeft.renderOrder = 2;
    this.lineRight.renderOrder = 2;
    parent.add(this.lineLeft);
    parent.add(this.lineRight);
  }

  update(
    rowCxRel: Float32Array, rowY: Float32Array, rowZ: Float32Array,
    halfRoad: number, railHeight: number,
  ): void {
    const rows = SAMPLES + 1;
    let oL = 0, oR = 0;
    for (let i = 0; i < rows; i++) {
      const cx = rowCxRel[i]!;
      const y = rowY[i]!;
      const z = rowZ[i]!;
      this.posLeft[oL++]  = cx - halfRoad; this.posLeft[oL++]  = y + railHeight; this.posLeft[oL++]  = z;
      this.posRight[oR++] = cx + halfRoad; this.posRight[oR++] = y + railHeight; this.posRight[oR++] = z;
    }
    (this.geoLeft.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geoRight.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geoLeft.dispose();
    this.geoRight.dispose();
    this.material.dispose();
  }
}

class TrackDividers {
  private readonly lines: THREE.Line[] = [];
  private readonly positions: Float32Array[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material: THREE.LineBasicMaterial;

  constructor(parent: THREE.Object3D, laneCount: number) {
    const rows = SAMPLES + 1;
    this.material = new THREE.LineBasicMaterial({
      color: COLOR_NEON_CYAN,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    for (let lane = 1; lane < laneCount; lane++) {
      const pos = new Float32Array(rows * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const line = new THREE.Line(geo, this.material);
      line.renderOrder = 1;
      parent.add(line);
      this.positions.push(pos);
      this.geometries.push(geo);
      this.lines.push(line);
    }
  }

  update(rowCxRel: Float32Array, rowY: Float32Array, rowZ: Float32Array, halfRoad: number): void {
    const rows = SAMPLES + 1;
    const count = this.lines.length;
    for (let l = 0; l < count; l++) {
      const dxFromLeft = ((l + 1) * (2 * halfRoad)) / (count + 1);
      const pos = this.positions[l]!;
      let o = 0;
      for (let i = 0; i < rows; i++) {
        const cx = rowCxRel[i]!;
        const y = rowY[i]!;
        const z = rowZ[i]!;
        pos[o++] = cx - halfRoad + dxFromLeft;
        pos[o++] = y + 0.012;
        pos[o++] = z;
      }
      (this.geometries[l]!.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}

class TrackLaneGlow {
  private readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly positions: Float32Array;

  constructor(parent: THREE.Object3D) {
    const rows = SAMPLES + 1;
    this.positions = new Float32Array(rows * 2 * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(buildStripIndices(rows), 1));
    this.material = new THREE.MeshBasicMaterial({
      color: COLOR_NEON_CYAN,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
  }

  update(
    rowCxRel: Float32Array,
    rowY: Float32Array,
    rowZ: Float32Array,
    halfRoad: number,
    carLaneVisual: number,
    beatPulse: number,
  ): void {
    const laneCount = (2 * halfRoad) / LANE_WORLD_WIDTH;
    const dx0 = -halfRoad + (carLaneVisual + 0.5) * LANE_WORLD_WIDTH;
    void laneCount;
    const halfLane = LANE_WORLD_WIDTH * 0.45;
    const rows = SAMPLES + 1;
    let o = 0;
    for (let i = 0; i < rows; i++) {
      const cx = rowCxRel[i]!;
      const y = rowY[i]!;
      const z = rowZ[i]!;
      this.positions[o++] = cx + dx0 - halfLane; this.positions[o++] = y + 0.02; this.positions[o++] = z;
      this.positions[o++] = cx + dx0 + halfLane; this.positions[o++] = y + 0.02; this.positions[o++] = z;
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.material.opacity = 0.08 + 0.18 * beatPulse;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

class TrackBeatGrid {
  private readonly segs: THREE.LineSegments;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  constructor(parent: THREE.Object3D) {
    this.positions = new Float32Array(MAX_BEAT_LINES * 2 * 3);
    this.colors = new Float32Array(MAX_BEAT_LINES * 2 * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.segs = new THREE.LineSegments(this.geometry, this.material);
    this.segs.renderOrder = 1;
    parent.add(this.segs);
  }

  update(
    beats: Float32Array,
    songTime: number,
    speedMult: number,
    centerline: Float32Array,
    elevation: Float32Array,
    hopSeconds: number,
    halfRoad: number,
    cxNow: number,
  ): void {
    if (beats.length < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    const period = beats[1]! - beats[0]!;
    const subDiv = 2;
    const subStep = period / subDiv;
    const phase = beats[0] ?? 0;
    const firstK = Math.ceil((songTime - phase) / subStep);

    let written = 0;
    const pinkR = ((COLOR_NEON_PINK >> 16) & 0xff) / 255;
    const pinkG = ((COLOR_NEON_PINK >> 8) & 0xff) / 255;
    const pinkB = (COLOR_NEON_PINK & 0xff) / 255;
    const gridR = ((COLOR_NEON_GRID >> 16) & 0xff) / 255;
    const gridG = ((COLOR_NEON_GRID >> 8) & 0xff) / 255;
    const gridB = (COLOR_NEON_GRID & 0xff) / 255;
    for (let k = firstK; written < MAX_BEAT_LINES; k++) {
      const t = phase + k * subStep;
      const dt = t - songTime;
      if (dt > VIEW_SECONDS) break;
      if (dt < 0) continue;
      const z = -WORLD_SPEED_BASE * speedMult * dt;
      const cxAt = sampleSeries(centerline, hopSeconds, t) * CURVE_WORLD_SCALE;
      const elAt = sampleSeries(elevation, hopSeconds, t) * ELEVATION_SCALE;
      const cxRel = cxAt - cxNow;
      const y = elAt + 0.015;
      const isBeat = k % subDiv === 0;
      const r = isBeat ? pinkR : gridR;
      const g = isBeat ? pinkG : gridG;
      const b = isBeat ? pinkB : gridB;
      const o = written * 6;
      this.positions[o + 0] = cxRel - halfRoad; this.positions[o + 1] = y; this.positions[o + 2] = z;
      this.positions[o + 3] = cxRel + halfRoad; this.positions[o + 4] = y; this.positions[o + 5] = z;
      this.colors[o + 0] = r; this.colors[o + 1] = g; this.colors[o + 2] = b;
      this.colors[o + 3] = r; this.colors[o + 4] = g; this.colors[o + 5] = b;
      written++;
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, written * 2);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export const TRACK3D_CONSTANTS = {
  SAMPLES,
  VIEW_SECONDS,
  WORLD_SPEED_BASE,
  RAIL_HEIGHT,
  LANE_WORLD_WIDTH,
  CURVE_WORLD_SCALE,
  ELEVATION_SCALE,
} as const;
