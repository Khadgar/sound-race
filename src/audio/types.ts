/**
 * Shared audio feature / beatmap types.
 *
 * A `TrackData` is the complete, time-indexed plan for a race, generated
 * once from an AudioBuffer before playback begins.
 */

export interface AudioFeatures {
  /** Seconds between successive frames. */
  hopSeconds: number;
  /** Number of analysis frames. */
  frameCount: number;
  /** Per-frame RMS energy in [0,1]. */
  rms: Float32Array;
  /** Per-frame low-band energy (sub-bass / bass) in [0,1]. */
  low: Float32Array;
  /** Per-frame mid-band energy in [0,1]. */
  mid: Float32Array;
  /** Per-frame high-band energy in [0,1]. */
  high: Float32Array;
  /** Per-frame spectral flux (positive differences) normalised to [0,1]. */
  flux: Float32Array;
}

export type GameEventType = "pickup" | "hazard";

export interface GameEvent {
  /** Time in seconds from start of song. */
  t: number;
  type: GameEventType;
  /** Lane index in [0, laneCount-1]. */
  lane: number;
  /** Color index into the block palette (pickups only). */
  color?: number;
  /** Optional intensity hint for visuals (e.g. drop = 1). */
  intensity?: number;
}

export interface TrackData {
  /** Stable id derived from the audio (hashAudioBuffer). */
  id: string;
  duration: number;
  /** Detected tempo in BPM (best-effort). */
  bpm: number;
  /** Phase-aligned beat times in seconds (sorted ascending). */
  beats: Float32Array;
  /** Number of lanes the track is designed for. */
  laneCount: number;
  /** Per-frame normalised curvature in [-1,1] driving track bending. */
  curvature: Float32Array;
  /** Per-frame normalised elevation in [-1,1] driving track ups/downs.
   *  Rendered at a constant ELEVATION_SCALE in world units. */
  elevation: Float32Array;
  /** Per-frame normalised intensity in [0,1] driving speed/color. */
  intensity: Float32Array;
  /** Seconds per `curvature`/`intensity` sample. */
  hopSeconds: number;
  /** Sorted by `t` ascending. */
  events: GameEvent[];
}

export interface AnalysisProgress {
  phase: "features" | "bpm" | "beatmap";
  ratio: number;
}
