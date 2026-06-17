/**
 * Quality tier detection and configuration.
 *
 * Auto-detects mobile / Capacitor environments and exports a config
 * object with reduced visual settings so the game runs smoothly on
 * weaker GPUs. The user can override via the menu selector; the
 * preference is persisted to localStorage and applied on next load.
 */

export type QualityTier = "low" | "medium" | "high" | "ultra";

export const QUALITY_TIERS: ReadonlyArray<QualityTier> = ["low", "medium", "high", "ultra"];

const QUALITY_STORAGE_KEY = "sound-race/quality";

export interface QualityConfig {
  tier: QualityTier;
  /** WebGLRenderer antialias (MSAA). */
  antialias: boolean;
  /** Enable shadow map pass. */
  shadows: boolean;
  /** Max devicePixelRatio sent to the renderer. */
  pixelRatioCap: number;
  /** Use MeshStandardMaterial (PBR) for entities, or MeshBasicMaterial. */
  pbrEntities: boolean;
  /** Spawn temporary PointLights on pickup hits. */
  tempLights: boolean;
  /** Spawn expanding shockwave meshes on hits. */
  shockwaves: boolean;
  /** Particle count for the primary pickup burst. */
  burstCountPrimary: number;
  /** Particle count for the secondary sparkle burst. */
  burstCountSecondary: number;
  /** Number of speed-streak line segments in the Fx tunnel. */
  streakCount: number;
  /** Entities cast shadows into the shadow map. */
  entityShadows: boolean;
  /** Sky dome texture resolution (width). Height = width / 2. */
  skyTextureWidth: number;
}

const PRESETS: Record<QualityTier, QualityConfig> = {
  low: {
    tier: "low",
    antialias: false,
    shadows: false,
    pixelRatioCap: 1.5,
    pbrEntities: false,
    tempLights: false,
    shockwaves: false,
    burstCountPrimary: 16,
    burstCountSecondary: 8,
    streakCount: 24,
    entityShadows: false,
    skyTextureWidth: 512,
  },
  medium: {
    tier: "medium",
    antialias: false,
    shadows: true,
    pixelRatioCap: 2,
    pbrEntities: true,
    tempLights: false,
    shockwaves: false,
    burstCountPrimary: 24,
    burstCountSecondary: 10,
    streakCount: 40,
    entityShadows: false,
    skyTextureWidth: 512,
  },
  high: {
    tier: "high",
    antialias: true,
    shadows: true,
    pixelRatioCap: 2,
    pbrEntities: true,
    tempLights: true,
    shockwaves: true,
    burstCountPrimary: 36,
    burstCountSecondary: 14,
    streakCount: 56,
    entityShadows: true,
    skyTextureWidth: 1024,
  },
  ultra: {
    tier: "ultra",
    antialias: true,
    shadows: true,
    pixelRatioCap: 3,
    pbrEntities: true,
    tempLights: true,
    shockwaves: true,
    burstCountPrimary: 48,
    burstCountSecondary: 20,
    streakCount: 72,
    entityShadows: true,
    skyTextureWidth: 1024,
  },
};

/** Returns the QualityConfig for a given tier name. */
export function getQualityConfig(tier: QualityTier): QualityConfig {
  return PRESETS[tier];
}

/** Persists the user's quality preference to localStorage. */
export function saveQualityPreference(tier: QualityTier): void {
  try {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, tier);
  } catch {
    /* private mode or quota — ignore */
  }
}

/** Loads the user's saved quality preference, or null if none. */
export function loadQualityPreference(): QualityTier | null {
  try {
    const raw = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    if (raw != null && QUALITY_TIERS.includes(raw as QualityTier)) {
      return raw as QualityTier;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Detects the appropriate quality tier for the current device.
 * Checks localStorage first (user override), then auto-detects.
 */
export function detectQuality(): QualityConfig {
  const saved = loadQualityPreference();
  if (saved != null) return PRESETS[saved];

  const isCapacitor =
    typeof window !== "undefined" &&
    "Capacitor" in window &&
    (window as Record<string, unknown>)["Capacitor"] != null;

  const isMobileTouch =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
    Math.max(screen.width, screen.height) < 1200;

  if (isCapacitor || isMobileTouch) {
    return PRESETS.low;
  }
  return PRESETS.high;
}
