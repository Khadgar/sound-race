/**
 * Entities3D — real 3D pickups and hazards.
 *
 * Replaces the previous flat Pixi sprites. Pickups are colored cubes
 * with emissive neon edges; hazards are 4-sided spike pyramids in the
 * obstacle gray. Both pulse-scale when within the hit window so they
 * read as "live now" against the music.
 *
 * Spawn / cull / collision logic mirrors the previous scene exactly:
 * an event is spawned when its audio time enters the look-ahead window,
 * culled after passing the camera by 0.5s, and consumed when the player
 * is in its lane within HIT_WINDOW_SEC.
 *
 * The class is a pure renderer + bookkeeper; it returns hit / miss
 * outcomes from `resolveCollisions()` for the GameScene to forward to
 * the (unchanged) score module.
 */

import * as THREE from "three";

import type { GameEvent, TrackData } from "../../audio/types.js";
import { BLOCK_PALETTE, OBSTACLE_COLOR, OBSTACLE_OUTLINE, blockColorHex } from "../palette.js";
import type { QualityConfig } from "../quality.js";
import { sampleSeries } from "../track.js";
import { TRACK3D_CONSTANTS } from "./Track3D.js";

const HIT_WINDOW_SEC = 0.13;
const SPAWN_LOOKAHEAD_SEC = TRACK3D_CONSTANTS.VIEW_SECONDS + 0.6;
const CULL_PAST_SEC = 0.5;

const PICKUP_SIZE = 0.55;
const HAZARD_BASE = 0.5;
const HAZARD_HEIGHT = 0.95;

/** Resting y of each entity type so its base sits ON the road surface
 *  (road plane is y=0). Cubes are centered, cones are centered too. */
const PICKUP_BASE_Y = PICKUP_SIZE / 2;
const HAZARD_BASE_Y = HAZARD_HEIGHT / 2;

/** Mean lift above baseY (the cube hovers this far above the road on
 *  average). Must be ≥ PICKUP_FLOAT_AMP so the cube never dips below
 *  the road plane. */
const PICKUP_FLOAT_LIFT = 0.28;
/** Half peak-to-peak of the sine wave. */
const PICKUP_FLOAT_AMP = 0.14;
/** One full bob cycle every PICKUP_FLOAT_PERIOD seconds. */
const PICKUP_FLOAT_PERIOD = 2.6;
/** Pre-computed angular frequency in rad/sec. */
const PICKUP_FLOAT_OMEGA = (2 * Math.PI) / PICKUP_FLOAT_PERIOD;

/** Continuous spin (rad/sec) plus bonus on beats. */
const SPIN_BASE = 1.2;
const SPIN_BEAT_BONUS = 4.0;

export interface CollisionOutcome {
  kind: "hit" | "miss";
  type: "pickup" | "hazard";
  colorIdx: number;
}

export interface EntitiesUpdateArgs {
  songTime: number;
  speedMult: number;
  currentCarLane: number;
  beatPulse: number;
  halfRoadWorld: number;
  laneWorldWidth: number;
  dtSec: number;
}

interface SpawnedEvent3D extends GameEvent {
  consumed: boolean;
  mesh: THREE.Object3D;
  /** Resting y so positionAll can add a float on top. */
  baseY: number;
  /** True for pickups (they float); false for hazards (grounded). */
  floats: boolean;
  /** Phase offset (radians) so cubes bob out of sync like buoys. */
  floatPhase: number;
}

export class Entities3D {
  readonly root: THREE.Group;

  private readonly track: TrackData;
  private readonly centerline: Float32Array;
  private readonly spawned: SpawnedEvent3D[] = [];
  private nextEventIdx = 0;

  private readonly sharedGeoms: SharedGeoms;
  private readonly quality: QualityConfig;

  constructor(parent: THREE.Object3D, track: TrackData, centerline: Float32Array, quality: QualityConfig) {
    this.root = new THREE.Group();
    this.root.name = "Entities3D";
    parent.add(this.root);

    this.track = track;
    this.centerline = centerline;
    this.quality = quality;
    this.sharedGeoms = buildSharedGeoms();
  }

  /**
   * Per-frame: spawn upcoming events, position all live ones, resolve
   * collisions for the current player lane, cull past ones.
   * Returns the collision outcomes for the caller to forward to score.
   */
  update(args: EntitiesUpdateArgs): CollisionOutcome[] {
    this.spawnUpcoming(args.songTime);
    const outcomes = this.resolveCollisions(args.songTime, args.currentCarLane);
    this.positionAll(args);
    this.cullPast(args.songTime);
    return outcomes;
  }

  dispose(): void {
    for (const ev of this.spawned) {
      this.disposeMesh(ev.mesh);
    }
    this.spawned.length = 0;
    this.sharedGeoms.dispose();
    this.root.parent?.remove(this.root);
  }

  // ------------------------------------------------------------------

  private spawnUpcoming(songTime: number): void {
    const horizon = songTime + SPAWN_LOOKAHEAD_SEC;
    while (this.nextEventIdx < this.track.events.length) {
      const ev = this.track.events[this.nextEventIdx]!;
      if (ev.t > horizon) break;
      const isPickup = ev.type === "pickup";
      const mesh = isPickup
        ? this.buildPickupMesh(ev.color ?? 0)
        : this.buildHazardMesh();
      this.root.add(mesh);
      this.spawned.push({
        ...ev,
        consumed: false,
        mesh,
        baseY: isPickup ? PICKUP_BASE_Y : HAZARD_BASE_Y,
        floats: isPickup,
        floatPhase: isPickup ? Math.random() * Math.PI * 2 : 0,
      });
      this.nextEventIdx++;
    }
  }

  private resolveCollisions(songTime: number, currentCarLane: number): CollisionOutcome[] {
    const out: CollisionOutcome[] = [];
    for (const ev of this.spawned) {
      if (ev.consumed) continue;
      const dt = ev.t - songTime;
      if (dt > HIT_WINDOW_SEC) continue;
      if (dt < -HIT_WINDOW_SEC) {
        ev.consumed = true;
        ev.mesh.visible = false;
        if (ev.type === "pickup") {
          out.push({ kind: "miss", type: "pickup", colorIdx: ev.color ?? 0 });
        } else {
          out.push({ kind: "miss", type: "hazard", colorIdx: 0 });
        }
        continue;
      }
      if (Math.abs(ev.lane - currentCarLane) < 0.5) {
        ev.consumed = true;
        ev.mesh.visible = false;
        if (ev.type === "pickup") {
          out.push({ kind: "hit", type: "pickup", colorIdx: ev.color ?? 0 });
        } else {
          out.push({ kind: "hit", type: "hazard", colorIdx: 0 });
        }
      }
    }
    return out;
  }

  private positionAll(args: EntitiesUpdateArgs): void {
    const { songTime, speedMult, halfRoadWorld, laneWorldWidth, beatPulse, dtSec } = args;
    const cxNow = sampleSeries(this.centerline, this.track.hopSeconds, songTime)
      * TRACK3D_CONSTANTS.CURVE_WORLD_SCALE;
    // Spin shared by every entity this frame — they all dance to the
    // same beat, in lockstep, like an audience clapping in time.
    const spinDelta = (SPIN_BASE + SPIN_BEAT_BONUS * beatPulse) * dtSec;
    // Continuous float driver. Each pickup has its own phase offset so
    // the cubes bob like buoys on water rather than all rising and
    // falling together.
    const wave = songTime * PICKUP_FLOAT_OMEGA;
    for (const ev of this.spawned) {
      if (ev.consumed) continue;
      const dt = ev.t - songTime;
      const z = -TRACK3D_CONSTANTS.WORLD_SPEED_BASE * speedMult * dt;
      const cxAt = sampleSeries(this.centerline, this.track.hopSeconds, ev.t)
        * TRACK3D_CONSTANTS.CURVE_WORLD_SCALE;
      const elAt = sampleSeries(this.track.elevation, this.track.hopSeconds, ev.t)
        * TRACK3D_CONSTANTS.ELEVATION_SCALE;
      const cxRel = cxAt - cxNow;
      const x = cxRel + -halfRoadWorld + (ev.lane + 0.5) * laneWorldWidth;
      // y = absolute road elevation at this event's time + baseY + a
      // gentle hover for pickups. Hazards stay flat on the slope.
      const hop = ev.floats
        ? PICKUP_FLOAT_LIFT + PICKUP_FLOAT_AMP * Math.sin(wave + ev.floatPhase)
        : 0;
      ev.mesh.position.set(x, elAt + ev.baseY + hop, z);

      // Pulse scale when near the hit window AND on every beat. The
      // beat-pulse part is what makes the cubes "punch" with the music
      // (visual rhythm cue, on top of the smooth float).
      const proximity = Math.max(0, 1 - Math.abs(dt) / 0.25);
      const s = 1 + 0.22 * proximity + 0.22 * beatPulse;
      ev.mesh.scale.setScalar(s);

      ev.mesh.rotation.y += spinDelta;
    }
  }

  private cullPast(songTime: number): void {
    while (this.spawned.length > 0 && this.spawned[0]!.t < songTime - CULL_PAST_SEC) {
      const ev = this.spawned.shift()!;
      this.disposeMesh(ev.mesh);
    }
  }

  // ------------------------------------------------------------------

  private buildPickupMesh(colorIdx: number): THREE.Object3D {
    const group = new THREE.Group();
    const color = blockColorHex(colorIdx);
    const bodyMat = this.quality.pbrEntities
      ? new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.7,
          roughness: 0.45,
          metalness: 0.25,
        })
      : new THREE.MeshBasicMaterial({ color });
    const body = new THREE.Mesh(this.sharedGeoms.pickupBody, bodyMat);
    if (this.quality.entityShadows) body.castShadow = true;
    group.add(body);

    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xfffce0,
      transparent: true,
      opacity: 0.95,
    });
    const edges = new THREE.LineSegments(this.sharedGeoms.pickupEdges, edgeMat);
    group.add(edges);
    return group;
  }

  private buildHazardMesh(): THREE.Object3D {
    const group = new THREE.Group();
    const bodyMat = this.quality.pbrEntities
      ? new THREE.MeshStandardMaterial({
          color: OBSTACLE_COLOR,
          emissive: OBSTACLE_OUTLINE,
          emissiveIntensity: 0.25,
          roughness: 0.7,
          metalness: 0.1,
        })
      : new THREE.MeshBasicMaterial({ color: OBSTACLE_COLOR });
    const body = new THREE.Mesh(this.sharedGeoms.hazardBody, bodyMat);
    if (this.quality.entityShadows) body.castShadow = true;
    group.add(body);

    const edgeMat = new THREE.LineBasicMaterial({
      color: OBSTACLE_OUTLINE,
      transparent: true,
      opacity: 0.9,
    });
    const edges = new THREE.LineSegments(this.sharedGeoms.hazardEdges, edgeMat);
    group.add(edges);

    // Spark tip in neon yellow.
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xfff066 });
    const tip = new THREE.Mesh(this.sharedGeoms.tip, tipMat);
    tip.position.set(0, HAZARD_HEIGHT * 0.55, 0);
    group.add(tip);
    return group;
  }

  private disposeMesh(obj: THREE.Object3D): void {
    obj.parent?.remove(obj);
    obj.traverse((node) => {
      const m = node as THREE.Mesh | THREE.LineSegments;
      // Body / edge geometries are SHARED — only dispose materials.
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) {
        for (const x of mat) x.dispose();
      } else if (mat) {
        mat.dispose();
      }
    });
  }
}

// ----------------------------------------------------------------------
// Shared geometry (re-used across all entity instances)

interface SharedGeoms {
  pickupBody: THREE.BoxGeometry;
  pickupEdges: THREE.EdgesGeometry;
  hazardBody: THREE.ConeGeometry;
  hazardEdges: THREE.EdgesGeometry;
  tip: THREE.SphereGeometry;
  dispose(): void;
}

function buildSharedGeoms(): SharedGeoms {
  const pickupBody = new THREE.BoxGeometry(PICKUP_SIZE, PICKUP_SIZE, PICKUP_SIZE);
  const pickupEdges = new THREE.EdgesGeometry(pickupBody);
  // 4 radial segments → square-base pyramid (spike).
  const hazardBody = new THREE.ConeGeometry(HAZARD_BASE, HAZARD_HEIGHT, 4);
  const hazardEdges = new THREE.EdgesGeometry(hazardBody);
  const tip = new THREE.SphereGeometry(0.06, 8, 6);
  return {
    pickupBody,
    pickupEdges,
    hazardBody,
    hazardEdges,
    tip,
    dispose() {
      pickupBody.dispose();
      pickupEdges.dispose();
      hazardBody.dispose();
      hazardEdges.dispose();
      tip.dispose();
    },
  };
}

// Re-exports so scene.ts doesn't need to import the palette directly for
// the few constants it forwards (kept for parity with the original
// scene module that re-exported these).
export { BLOCK_PALETTE };
