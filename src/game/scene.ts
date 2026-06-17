/**
 * Three.js GameScene. Owns all per-race rendering and gameplay-render
 * coupling. Each race instantiates a fresh GameScene; the renderer is
 * owned by main.ts and shared across races.
 *
 * Public API mirrors the previous Pixi scene so main.ts / GameEngine
 * don't change:
 *   - attachInput / detachInput
 *   - destroy
 *   - update(dt, songTime)
 *   - render(songTime, alpha)
 *
 * Subsystems (SceneEnv, Track3D, Hull, Entities3D, ParticleBurst, Fx,
 * HUD) are added incrementally in later phases. This module orchestrates
 * them and owns per-frame beat / pulse state.
 */

import * as THREE from "three";

import type { AudioPlayer } from "../audio/player.js";
import type { TrackData } from "../audio/types.js";
import { LaneInput } from "./input.js";
import type { QualityConfig } from "./quality.js";
import { Entities3D, type CollisionOutcome } from "./render/Entities3D.js";
import { Fx } from "./render/Fx.js";
import { Hull } from "./render/Hull.js";
import { ParticleBurst, type ParticleBurstOptions } from "./render/ParticleBurst.js";
import type { Renderer } from "./render/Renderer.js";
import type { SceneEnv } from "./render/SceneEnv.js";
import { Shockwave, type ShockwaveOptions } from "./render/Shockwave.js";
import { Track3D, TRACK3D_CONSTANTS } from "./render/Track3D.js";
import { blockColorHex } from "./palette.js";
import {
  consumeShield,
  createScoreState,
  onHazard,
  onHazardDeflected,
  onHazardDodged,
  onPickup,
  onPickupMiss,
  summarize,
  type ScoreState,
  type ScoreSummary,
} from "./score.js";
import { integrateCurvature, sampleSeries } from "./track.js";
import { HUD } from "../ui/hud.js";
import { TouchControls } from "../ui/touchControls.js";

const MAX_SPEED_MULT = 2.2;
const MIN_SPEED_MULT = 0.55;
const CURVE_WORLD_SCALE = 1.5;
const INTRO_HINT_SECONDS = 5.0;
/** Each shield charge lasts this many seconds when active. */
const SHIELD_DURATION_SEC = 5.0;

export interface GameSceneCallbacks {
  onFinish(summary: ScoreSummary): void;
}

/** Short-lived point light entry used by `spawnTempLightAtHull` to
 *  flash the road around the hull on pickup explosions. */
interface TempLight {
  light: THREE.PointLight;
  age: number;
  ttl: number;
  initialIntensity: number;
}

export class GameScene {
  /** Subgraph root for this race; cleared on destroy. */
  private readonly root: THREE.Group;
  private readonly centerline: Float32Array;
  private readonly score: ScoreState = createScoreState();
  private readonly input: LaneInput;
  private readonly quality: QualityConfig;
  private readonly track3D: Track3D;
  private readonly hull: Hull;
  private readonly entities: Entities3D;
  private readonly fx: Fx;
  private readonly hud: HUD;
  private readonly touchControls: TouchControls;
  private readonly halfRoadWorld: number;
  private readonly bursts: ParticleBurst[] = [];
  private readonly shockwaves: Shockwave[] = [];
  /** Short-lived point lights used to flash the road on pickup hits. */
  private readonly tempLights: TempLight[] = [];

  private nextBeatIdx = 0;
  private currentCarLane: number;
  private carLaneVisual: number;
  private prevCarLaneVisual = 0;
  private finished = false;
  private lastDtSec = 1 / 60;

  /** Per-beat / per-bar reactive scalars, decayed each frame. */
  private beatPulse = 0;
  private barPulse = 0;
  private beatCount = 0;
  private smoothedIntensity = 0;
  private hintRemaining = INTRO_HINT_SECONDS;
  /** Hit-flash + cluster-bonus pulses (decay each frame). */
  private flashStrength = 0;
  private flashColor = 0xffffff;
  /** Per-trigger decay rate for `flashStrength` (units / sec). Lets a
   *  hazard set a sharp 10/s pop while a pickup uses a mellow 3/s
   *  lingering glow. */
  private flashDecayRate = 3;
  private clusterPulse = 0;
  private clusterPulseLen = 0;
  /** Song time when the currently-active shield expires (0 = inactive). */
  private shieldActiveUntil = 0;
  /** Most recent songTime — used by the input handler (which fires
   *  asynchronously) to anchor shield activation. */
  private lastSongTime = 0;
  private onPauseCb: (() => void) | null = null;

  constructor(
    private readonly renderer: Renderer,
    private readonly env: SceneEnv,
    private readonly track: TrackData,
    private readonly player: AudioPlayer,
    private readonly cb: GameSceneCallbacks,
    quality: QualityConfig,
  ) {
    this.quality = quality;
    this.root = new THREE.Group();
    this.renderer.scene.add(this.root);

    this.centerline = integrateCurvature(track.curvature, track.hopSeconds);
    this.currentCarLane = Math.floor(track.laneCount / 2);
    this.carLaneVisual = this.currentCarLane;
    this.prevCarLaneVisual = this.currentCarLane;
    this.input = new LaneInput({ laneCount: track.laneCount, initialLane: this.currentCarLane });

    this.halfRoadWorld = (track.laneCount * TRACK3D_CONSTANTS.LANE_WORLD_WIDTH) / 2;
    this.track3D = new Track3D(this.root, track, this.centerline);
    this.hull = new Hull(this.root);
    this.entities = new Entities3D(this.root, track, this.centerline, quality);
    this.fx = new Fx(this.root, this.renderer.host, quality);
    this.hud = new HUD(this.renderer.host);
    this.touchControls = new TouchControls({
      onPause: () => { if (this.onPauseCb) this.onPauseCb(); },
      onShield: () => this.tryActivateShield(),
      onLaneLeft: () => { this.input.lane = Math.max(0, this.input.lane - 1); },
      onLaneRight: () => { this.input.lane = Math.min(this.track.laneCount - 1, this.input.lane + 1); },
    });
    this.hintRemaining = INTRO_HINT_SECONDS;
  }

  attachInput(target: HTMLElement, onPause: () => void): void {
    this.onPauseCb = onPause;
    this.input.attach(target, onPause, () => this.tryActivateShield());
    this.touchControls.mount(this.renderer.host);
  }

  detachInput(): void {
    this.input.detach();
  }

  /** Snapshot of the current score state, with derived accuracy and
   *  grade. Used by the pause overlay to display live stats. */
  getScoreSnapshot(): ScoreSummary {
    return summarize(this.score);
  }

  destroy(): void {
    this.detachInput();
    this.touchControls.dispose();
    this.entities.dispose();
    this.hull.dispose();
    this.track3D.dispose();
    this.fx.dispose();
    this.hud.dispose();
    for (const b of this.bursts) {
      this.root.remove(b.object);
      b.dispose();
    }
    this.bursts.length = 0;
    for (const w of this.shockwaves) {
      this.root.remove(w.object);
      w.dispose();
    }
    this.shockwaves.length = 0;
    for (const tl of this.tempLights) {
      this.root.remove(tl.light);
      tl.light.dispose();
    }
    this.tempLights.length = 0;
    this.renderer.scene.remove(this.root);
    disposeSubtree(this.root);
  }

  update(dtSec: number, songTimeSec: number): void {
    this.lastDtSec = dtSec;
    this.lastSongTime = songTimeSec;
    if (this.finished) return;

    const intensityNow = sampleSeries(this.track.intensity, this.track.hopSeconds, songTimeSec);
    const k = Math.min(1, dtSec * 4);
    this.smoothedIntensity += (intensityNow - this.smoothedIntensity) * k;

    this.currentCarLane = this.input.lane;
    const laneDiff = this.currentCarLane - this.carLaneVisual;
    this.carLaneVisual += laneDiff * Math.min(1, dtSec * 14);

    this.consumeBeats(songTimeSec);

    if (this.beatPulse > 0) this.beatPulse = Math.max(0, this.beatPulse - dtSec * 4);
    if (this.barPulse > 0) this.barPulse = Math.max(0, this.barPulse - dtSec * 2.5);
    if (this.flashStrength > 0) {
      this.flashStrength = Math.max(0, this.flashStrength - dtSec * this.flashDecayRate);
    }
    if (this.clusterPulse > 0) this.clusterPulse = Math.max(0, this.clusterPulse - dtSec * 1.4);
    if (this.hintRemaining > 0) this.hintRemaining = Math.max(0, this.hintRemaining - dtSec);

    this.updateBursts(dtSec);
    this.updateShockwaves(dtSec);
    this.updateTempLights(dtSec);

    // End-of-song detection uses the raw audio clock rather than the
    // interpolated `songTimeSec`. The fixed-step engine always passes
    // a value strictly less than `player.currentTime` (it leaves a
    // sub-step residual in its accumulator each frame), so an
    // interpolated check against `track.duration` would never fire on
    // natural completion.
    if (this.score.health <= 0 || this.player.currentTime >= this.track.duration) {
      this.finished = true;
      this.cb.onFinish(summarize(this.score));
    }
  }

  /** True while the player's shield is active. */
  private isShieldActive(songTime: number): boolean {
    return songTime < this.shieldActiveUntil;
  }

  /** Spacebar handler — consumes one shield charge if available and
   *  not already shielded. */
  private tryActivateShield(): void {
    if (this.finished) return;
    if (this.isShieldActive(this.lastSongTime)) return;
    if (!consumeShield(this.score)) return;
    this.shieldActiveUntil = this.lastSongTime + SHIELD_DURATION_SEC;
    // Visible activation burst — a cyan ring radiating off the hull.
    this.spawnBurstAtHull({
      color: 0x5df0ff,
      count: this.quality.burstCountPrimary,
      lifetime: 0.55,
      speed: 6,
      size: 0.18,
      alphaScale: 1.1,
    });
    this.flashColor = 0x5df0ff;
    this.flashStrength = 0.4;
    this.flashDecayRate = 3;
  }

  render(songTimeSec: number, _alpha: number): void {
    void _alpha;
    const live = this.player.sampleBands();
    const speedMult = this.currentSpeedMult();

    const outcomes = this.entities.update({
      songTime: songTimeSec,
      speedMult,
      currentCarLane: this.currentCarLane,
      beatPulse: this.beatPulse,
      halfRoadWorld: this.halfRoadWorld,
      laneWorldWidth: TRACK3D_CONSTANTS.LANE_WORLD_WIDTH,
      dtSec: this.lastDtSec,
    });
    this.applyCollisionOutcomes(outcomes);

    // Road tangent (yaw + pitch) at the hull's z position. Sample the
    // centerline + elevation a short way ahead, then take atan2 of the
    // resulting direction vector. The hull uses these for nose-into-
    // curve banking and pitch-into-slope rollercoaster lean; the chase
    // camera uses them to track the road's direction and elevation.
    const aheadDt = 0.4;
    const aheadCxRel = this.centerlineRel(songTimeSec + aheadDt, songTimeSec);
    const aheadZ = -TRACK3D_CONSTANTS.WORLD_SPEED_BASE * speedMult * aheadDt;
    const roadYaw = Math.atan2(aheadCxRel, -aheadZ);
    const elNow = this.elevationWorldAt(songTimeSec);
    const elAhead = this.elevationWorldAt(songTimeSec + aheadDt);
    const roadPitch = Math.atan2(elAhead - elNow, -aheadZ);

    this.env.update(this.beatPulse, this.barPulse, live.low);
    this.track3D.update({
      songTime: songTimeSec,
      speedMult,
      carLaneVisual: this.carLaneVisual,
      beatPulse: this.beatPulse,
    });
    const shieldRemainingSec = Math.max(0, this.shieldActiveUntil - songTimeSec);
    const shieldFraction = shieldRemainingSec / SHIELD_DURATION_SEC;

    this.hull.update({
      carLaneVisual: this.carLaneVisual,
      prevCarLaneVisual: this.prevCarLaneVisual,
      halfRoadWorld: this.halfRoadWorld,
      laneWorldWidth: TRACK3D_CONSTANTS.LANE_WORLD_WIDTH,
      beatPulse: this.beatPulse,
      lowBand: live.low,
      lastDtSec: this.lastDtSec,
      centerlineX: 0,
      roadYaw,
      roadPitch,
      roadHeight: elNow,
      roadHeightAhead: elAhead,
      shieldFraction,
    }, this.renderer.camera);
    this.fx.update({
      speedAmt: (speedMult - MIN_SPEED_MULT) / (MAX_SPEED_MULT - MIN_SPEED_MULT),
      beatPulse: this.beatPulse,
      barPulse: this.barPulse,
      clusterPulse: this.clusterPulse,
      clusterPulseLen: this.clusterPulseLen,
      flashStrength: this.flashStrength,
      flashColor: this.flashColor,
      lowBand: live.low,
      dtSec: this.lastDtSec,
      cameraX: this.renderer.camera.position.x,
      hintAlpha: Math.min(1, this.hintRemaining),
    });
    this.hud.setScore(this.score.score, songTimeSec, this.track.duration);
    this.hud.setBpm(this.track.bpm, this.beatCount);
    this.hud.setSpeed(speedMult, MIN_SPEED_MULT, MAX_SPEED_MULT);
    this.hud.setCombo(this.score.combo);
    this.hud.setHealth(this.score.health);
    this.hud.setBlockQueue(this.score.recentColors);
    this.hud.setShields(this.score.shieldsRemaining, shieldFraction);
    this.prevCarLaneVisual = this.carLaneVisual;
    this.renderer.render();
  }

  private applyCollisionOutcomes(outs: CollisionOutcome[]): void {
    const q = this.quality;
    for (const o of outs) {
      if (o.kind === "hit") {
        if (o.type === "pickup") {
          const result = onPickup(this.score, o.colorIdx);
          const blockColor = blockColorHex(o.colorIdx);
          // --- Pickup "explosion": multi-layer burst + shockwave + light ---
          this.flashColor = blockColor;
          this.flashStrength = 0.6;
          this.flashDecayRate = 3; // mellow, lingering glow
          // Primary cube-colored burst.
          this.spawnBurstAtHull({
            color: blockColor,
            count: q.burstCountPrimary,
            lifetime: 0.5,
            speed: 6,
            size: 0.2,
          });
          // Secondary white sparkle puff so the explosion has layers.
          this.spawnBurstAtHull({
            color: 0xfffce0,
            count: q.burstCountSecondary,
            lifetime: 0.6,
            speed: 3.2,
            size: 0.1,
            alphaScale: 0.9,
          });
          if (q.shockwaves) {
            this.spawnShockwaveAtHull({
              color: blockColor,
              lifetime: 0.45,
              maxRadius: 2.6,
            });
          }
          if (q.tempLights) {
            this.spawnTempLightAtHull(blockColor, 4, 6, 0.18);
          }
          if (result.cluster) {
            this.clusterPulse = 1;
            this.clusterPulseLen = result.clusterLen;
            this.spawnBurstAtHull({
              color: 0xfff066,
              count: q.burstCountPrimary,
              lifetime: 0.65,
              speed: 7,
              size: 0.22,
              alphaScale: 1.1,
            });
            if (q.shockwaves) {
              this.spawnShockwaveAtHull({
                color: 0xfff066,
                lifetime: 0.6,
                maxRadius: 3.4,
              });
            }
          }
        } else {
          if (this.isShieldActive(this.lastSongTime)) {
            // Shield absorbs the hit — no health damage, no combo break.
            onHazardDeflected(this.score);
            this.flashColor = 0x5df0ff;
            this.flashStrength = 0.5;
            this.flashDecayRate = 3;
            this.spawnBurstAtHull({
              color: 0x5df0ff,
              count: q.burstCountPrimary > 20 ? 28 : 14,
              lifetime: 0.45,
              speed: 7,
              size: 0.16,
              alphaScale: 1.0,
            });
          } else {
            onHazard(this.score);
            // --- Hazard "camera flash": sharp + fast decay ---
            this.flashColor = 0xffffff;
            this.flashStrength = 1.5;
            this.flashDecayRate = 10; // sharp pop, gone in ~0.15s
            this.spawnBurstAtHull({
              color: 0xff4030,
              count: q.burstCountPrimary > 20 ? 22 : 12,
              lifetime: 0.4,
              speed: 5.5,
              size: 0.18,
              gravity: 6,
            });
          }
        }
      } else {
        if (o.type === "pickup") {
          onPickupMiss(this.score);
        } else {
          onHazardDodged(this.score);
        }
      }
    }
  }

  private spawnBurstAtHull(opts: Omit<ParticleBurstOptions, "position">): void {
    const x = -this.halfRoadWorld + (this.carLaneVisual + 0.5) * TRACK3D_CONSTANTS.LANE_WORLD_WIDTH;
    const y = this.elevationWorldAt(this.lastSongTime) + 0.55;
    const burst = new ParticleBurst({
      ...opts,
      position: new THREE.Vector3(x, y, 0),
    });
    this.bursts.push(burst);
    this.root.add(burst.object);
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.update(dt);
      if (!b.alive) {
        this.root.remove(b.object);
        b.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  private spawnShockwaveAtHull(opts: Omit<ShockwaveOptions, "position">): void {
    const x = -this.halfRoadWorld + (this.carLaneVisual + 0.5) * TRACK3D_CONSTANTS.LANE_WORLD_WIDTH;
    const y = this.elevationWorldAt(this.lastSongTime) + 0.55;
    const wave = new Shockwave({
      ...opts,
      position: new THREE.Vector3(x, y, 0),
    });
    this.shockwaves.push(wave);
    this.root.add(wave.object);
  }

  private updateShockwaves(dt: number): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const w = this.shockwaves[i]!;
      w.update(dt);
      if (!w.alive) {
        this.root.remove(w.object);
        w.dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  /**
   * Adds a short-lived point light at the hull position so a pickup
   * explosion actually illuminates a few meters of road around the ship.
   * The light is created on demand and removed when it expires; this
   * runs at most a handful of times per second so the allocation cost
   * is negligible.
   */
  private spawnTempLightAtHull(color: number, intensity: number, range: number, ttl: number): void {
    const x = -this.halfRoadWorld + (this.carLaneVisual + 0.5) * TRACK3D_CONSTANTS.LANE_WORLD_WIDTH;
    const y = this.elevationWorldAt(this.lastSongTime) + 0.6;
    const light = new THREE.PointLight(color, intensity, range, 2);
    light.position.set(x, y, 0);
    light.castShadow = false;
    this.root.add(light);
    this.tempLights.push({ light, age: 0, ttl, initialIntensity: intensity });
  }

  private updateTempLights(dt: number): void {
    for (let i = this.tempLights.length - 1; i >= 0; i--) {
      const tl = this.tempLights[i]!;
      tl.age += dt;
      const t = tl.age / tl.ttl;
      if (t >= 1) {
        this.root.remove(tl.light);
        tl.light.dispose();
        this.tempLights.splice(i, 1);
        continue;
      }
      // Linear fade — short enough that any easing curve looks similar.
      tl.light.intensity = tl.initialIntensity * (1 - t);
    }
  }

  private currentSpeedMult(): number {
    return MIN_SPEED_MULT + (MAX_SPEED_MULT - MIN_SPEED_MULT) * this.smoothedIntensity;
  }

  private consumeBeats(songTime: number): void {
    while (
      this.nextBeatIdx < this.track.beats.length &&
      this.track.beats[this.nextBeatIdx]! <= songTime
    ) {
      this.beatPulse = 1;
      this.beatCount++;
      if (this.beatCount % 4 === 1) this.barPulse = 1;
      this.nextBeatIdx++;
    }
  }

  private centerlineWorldAt(t: number): number {
    return sampleSeries(this.centerline, this.track.hopSeconds, t) * CURVE_WORLD_SCALE;
  }

  private centerlineRel(t: number, songTime: number): number {
    return this.centerlineWorldAt(t) - this.centerlineWorldAt(songTime);
  }

  private elevationWorldAt(t: number): number {
    return sampleSeries(this.track.elevation, this.track.hopSeconds, t)
      * TRACK3D_CONSTANTS.ELEVATION_SCALE;
  }
}

function disposeSubtree(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if ((mesh as { isMesh?: boolean }).isMesh) {
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else if (mat) {
        mat.dispose();
      }
    }
  });
}
