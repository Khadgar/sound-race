/**
 * Three.js renderer wrapper.
 *
 * Owns the WebGLRenderer, the root Scene, and the chase PerspectiveCamera.
 * Mounts its DOM element into a host container and keeps everything sized
 * to the window. The GameScene reuses the same renderer/scene/camera for
 * its lifetime; the wrapper is the single point of contact with the DOM.
 *
 * Synthwave-tuned defaults — dark purple background, exponential fog, soft
 * shadows enabled for the directional pink "sun" added by SceneEnv.
 */

import * as THREE from "three";

import type { QualityConfig } from "../quality.js";

const BACKGROUND = 0x0b0a14;
const FOG_COLOR = 0x14082a;
const FOG_DENSITY = 0.035;

export interface RendererOptions {
  /** DOM element to mount the canvas into. */
  host: HTMLElement;
  /** Quality configuration (controls antialias, shadows, pixelRatio). */
  quality: QualityConfig;
  /** Optional: vertical field-of-view in degrees (default 65). */
  fov?: number;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLCanvasElement;
  readonly host: HTMLElement;

  private readonly pixelRatioCap: number;
  private readonly resizeHandler = () => this.resize();

  constructor(opts: RendererOptions) {
    this.host = opts.host;
    const q = opts.quality;
    this.pixelRatioCap = q.pixelRatioCap;

    this.renderer = new THREE.WebGLRenderer({
      antialias: q.antialias,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap));

    if (q.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.domElement = this.renderer.domElement;
    this.domElement.style.position = "absolute";
    this.domElement.style.inset = "0";
    this.domElement.style.display = "block";
    this.domElement.style.width = "100%";
    this.domElement.style.height = "100%";
    this.host.appendChild(this.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 65, 1, 0.1, 800);
    this.camera.position.set(0, 3.2, 7);
    this.camera.lookAt(0, 1.5, 0);

    window.addEventListener("resize", this.resizeHandler);
    this.resize();
  }

  resize(): void {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener("resize", this.resizeHandler);
    this.renderer.dispose();
    if (this.domElement.parentElement === this.host) {
      this.host.removeChild(this.domElement);
    }
  }
}
