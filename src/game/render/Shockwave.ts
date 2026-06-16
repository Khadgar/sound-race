/**
 * Shockwave — short-lived expanding wireframe icosphere.
 *
 * Used for pickup "explosion" feedback at the hull. Mirrors the
 * `ParticleBurst` lifecycle so the GameScene can pool and reap them
 * the same way:
 *
 *   const wave = new Shockwave({ position, color, lifetime, maxRadius });
 *   parent.add(wave.object);
 *   each frame: wave.update(dt);
 *   when !wave.alive: parent.remove(wave.object); wave.dispose();
 *
 * Built from a single low-poly icosahedron + wireframe material so it
 * fits the synthwave aesthetic and stays cheap to render.
 */

import * as THREE from "three";

export interface ShockwaveOptions {
  position: THREE.Vector3;
  color: number;
  /** Seconds for the shockwave to expand fully and fade out. */
  lifetime?: number;
  /** World-space radius the wave reaches at end-of-life. */
  maxRadius?: number;
  /** Optional starting alpha (default 1). */
  alpha?: number;
}

const BASE_GEOMETRY_RADIUS = 0.4;

export class Shockwave {
  readonly object: THREE.Mesh;
  alive = true;

  private readonly lifetime: number;
  private readonly maxScale: number;
  private readonly alphaScale: number;
  private age = 0;

  private readonly geometry: THREE.IcosahedronGeometry;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(opts: ShockwaveOptions) {
    this.lifetime = opts.lifetime ?? 0.45;
    const maxRadius = opts.maxRadius ?? 2.6;
    // Scale factor relative to BASE_GEOMETRY_RADIUS so consumers can
    // think in world units rather than geometry scales.
    this.maxScale = maxRadius / BASE_GEOMETRY_RADIUS;
    this.alphaScale = opts.alpha ?? 1;

    this.geometry = new THREE.IcosahedronGeometry(BASE_GEOMETRY_RADIUS, 1);
    this.material = new THREE.MeshBasicMaterial({
      color: opts.color,
      wireframe: true,
      transparent: true,
      opacity: this.alphaScale,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.position.copy(opts.position);
    this.object.scale.setScalar(1);
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.age += dt;
    const t = this.age / this.lifetime;
    if (t >= 1) {
      this.alive = false;
      this.material.opacity = 0;
      return;
    }
    // Smooth ease-out for the expansion + quadratic fade for the alpha.
    const eased = 1 - Math.pow(1 - t, 2);
    const scale = 1 + (this.maxScale - 1) * eased;
    this.object.scale.setScalar(scale);
    this.material.opacity = (1 - t) * (1 - t) * this.alphaScale;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
