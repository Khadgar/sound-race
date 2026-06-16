/**
 * ParticleBurst — TypeScript port of ballance-web's
 * `src/entities/ParticleBurst.js`. A short-lived `THREE.Points` cloud
 * that expands radially from a centre point and fades out additively.
 *
 * Usage in the GameScene:
 *   const burst = new ParticleBurst({ position, color, count, lifetime, speed, size, gravity });
 *   parent.add(burst.object);
 *   each frame: burst.update(dt);
 *   when !burst.alive: parent.remove(burst.object); burst.dispose();
 */

import * as THREE from "three";

export interface ParticleBurstOptions {
  position: THREE.Vector3;
  color: number;
  count?: number;
  lifetime?: number;
  /** Baseline outward speed in world units / second. */
  speed?: number;
  /** Point size in world units (PointsMaterial). */
  size?: number;
  /** Optional downward acceleration (m/s²). */
  gravity?: number;
  /** Optional additional alpha multiplier (default 1). */
  alphaScale?: number;
}

export class ParticleBurst {
  readonly object: THREE.Points;
  alive = true;

  private readonly count: number;
  private readonly lifetime: number;
  private age = 0;
  private readonly gravity: number;
  private readonly alphaScale: number;

  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor(opts: ParticleBurstOptions) {
    const count = opts.count ?? 16;
    const lifetime = opts.lifetime ?? 0.4;
    const speed = opts.speed ?? 5;
    const size = opts.size ?? 0.16;
    const gravity = opts.gravity ?? 0;

    this.count = count;
    this.lifetime = lifetime;
    this.gravity = gravity;
    this.alphaScale = opts.alphaScale ?? 1;

    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);

    const ox = opts.position.x;
    const oy = opts.position.y;
    const oz = opts.position.z;
    for (let i = 0; i < count; i++) {
      this.positions[i * 3 + 0] = ox;
      this.positions[i * 3 + 1] = oy;
      this.positions[i * 3 + 2] = oz;

      // Random direction on the unit sphere; magnitude varies ±~40% around `speed`.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const mag = speed * (0.6 + Math.random() * 0.8);
      this.velocities[i * 3 + 0] = Math.sin(phi) * Math.cos(theta) * mag;
      this.velocities[i * 3 + 1] = Math.cos(phi) * mag;
      this.velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * mag;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: opts.color,
      size,
      transparent: true,
      opacity: this.alphaScale,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.Points(this.geometry, this.material);
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
    const p = this.positions;
    const v = this.velocities;
    for (let i = 0; i < this.count; i++) {
      p[i * 3 + 0]! += v[i * 3 + 0]! * dt;
      p[i * 3 + 1]! += v[i * 3 + 1]! * dt;
      p[i * 3 + 2]! += v[i * 3 + 2]! * dt;
      if (this.gravity) {
        v[i * 3 + 1]! -= this.gravity * dt;
      }
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    // Quadratic fade so the cloud lingers then snaps out at the end.
    this.material.opacity = (1 - t) * (1 - t) * this.alphaScale;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
