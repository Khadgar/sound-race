/**
 * Beatmap generator.
 *
 * Pipeline:
 *   1. Mix down the AudioBuffer to mono Float32 PCM.
 *   2. Run BPM detection (web-audio-beat-detector) on the main thread.
 *   3. Ship PCM to the analyzer worker for FFT-based features.
 *   4. Combine BPM grid + features into TrackData (curvature, intensity, events).
 */

import { analyze as detectBpm } from "web-audio-beat-detector";
import AnalyzerWorker from "./analyzer.worker.ts?worker";
import { hashAudioBuffer } from "./decoder.js";
import type { AnalyzeMessage, AnalyzeRequest } from "./analyzer.worker.js";
import type { AnalysisProgress, AudioFeatures, GameEvent, TrackData } from "./types.js";

const DEFAULT_LANES = 3;
/** Default for difficulty when caller passes nothing — 0.5 = current
 *  hazard density. */
const DEFAULT_DIFFICULTY = 0.5;

export interface BeatmapOptions {
  laneCount?: number;
  /** 0 = peaceful (no hazards), 0.5 = default, 1 = ~2× hazard density. */
  difficulty?: number;
  onProgress?: (p: AnalysisProgress) => void;
}

function toMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const len = buffer.length;
  if (channels === 1) return Float32Array.from(buffer.getChannelData(0));
  const out = new Float32Array(len);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i]! += data[i]!;
  }
  const inv = 1 / channels;
  for (let i = 0; i < len; i++) out[i] = out[i]! * inv;
  return out;
}

function runWorker(
  pcm: Float32Array,
  sampleRate: number,
  onProgress?: (ratio: number) => void,
): Promise<AudioFeatures> {
  return new Promise<AudioFeatures>((resolve, reject) => {
    const worker = new AnalyzerWorker();
    worker.onmessage = (e: MessageEvent<AnalyzeMessage>) => {
      const m = e.data;
      if (m.type === "progress") onProgress?.(m.ratio);
      else if (m.type === "result") {
        worker.terminate();
        resolve(m.features);
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || "worker error"));
    };
    const req: AnalyzeRequest = { type: "analyze", pcm, sampleRate };
    // Transfer the PCM buffer to avoid copying.
    worker.postMessage(req, [pcm.buffer]);
  });
}

function smooth(arr: Float32Array, window: number): Float32Array {
  const out = new Float32Array(arr.length);
  let sum = 0;
  const w = Math.max(1, window);
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i]!;
    if (i >= w) sum -= arr[i - w]!;
    out[i] = sum / Math.min(i + 1, w);
  }
  return out;
}

function buildCurvature(features: AudioFeatures): Float32Array {
  // Curvature swings with smoothed low-mid difference, mapped to [-1,1].
  const lo = smooth(features.low, 24);
  const md = smooth(features.mid, 24);
  const out = new Float32Array(features.frameCount);
  let phase = 0;
  let dir = 1;
  for (let i = 0; i < features.frameCount; i++) {
    const bias = md[i]! - lo[i]!; // shifts curve toward one side as mids take over
    phase += 0.015 + lo[i]! * 0.03;
    if (phase > Math.PI) {
      phase -= Math.PI;
      dir = -dir;
    }
    out[i] = Math.max(-1, Math.min(1, dir * Math.sin(phase) + bias * 0.4));
  }
  return out;
}

function buildElevation(features: AudioFeatures): Float32Array {
  // Rollercoaster ups/downs: integrate a slow phase, biased by bass +
  // RMS so drops climb (peaks lift) and breakdowns dip. Phase grows
  // roughly half as fast as curvature so hills are noticeably longer
  // than turns — one full up-down cycle every ~6-10 seconds depending
  // on intensity.
  const lo = smooth(features.low, 32);
  const rms = smooth(features.rms, 32);
  const out = new Float32Array(features.frameCount);
  let phase = 0;
  for (let i = 0; i < features.frameCount; i++) {
    phase += 0.008 + lo[i]! * 0.015;
    // Continuous sine cycle, biased UP by overall energy so loud
    // sections feel like hill climbs and silence feels like valleys.
    const base = Math.sin(phase);
    const bias = (rms[i]! - 0.4) * 0.45;
    out[i] = Math.max(-1, Math.min(1, base + bias));
  }
  return out;
}

function buildIntensity(features: AudioFeatures): Float32Array {
  const out = new Float32Array(features.frameCount);
  for (let i = 0; i < features.frameCount; i++) {
    out[i] = Math.min(1, 0.4 * features.rms[i]! + 0.4 * features.low[i]! + 0.2 * features.high[i]!);
  }
  return smooth(out, 8);
}

function detectFluxPeaks(flux: Float32Array, hop: number, minGapSec: number): number[] {
  const peaks: number[] = [];
  const win = 11;
  const half = win >> 1;
  const minGapFrames = Math.max(1, Math.floor(minGapSec / hop));
  let lastPeak = -minGapFrames;
  for (let i = half; i < flux.length - half; i++) {
    const v = flux[i]!;
    if (v < 0.35) continue;
    let local = 0;
    for (let j = i - half; j <= i + half; j++) local = Math.max(local, flux[j]!);
    if (v >= local && i - lastPeak >= minGapFrames) {
      peaks.push(i);
      lastPeak = i;
    }
  }
  return peaks;
}

function estimateBeatPhase(features: AudioFeatures, bpm: number): number {
  const period = 60 / bpm;
  const duration = features.frameCount * features.hopSeconds;
  let bestPhase = 0;
  let bestScore = -Infinity;
  const steps = 24;
  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * period;
    let score = 0;
    for (let t = phase; t < duration; t += period) {
      const f = Math.min(features.frameCount - 1, Math.floor(t / features.hopSeconds));
      score += (features.low[f] ?? 0) + 0.5 * (features.flux[f] ?? 0);
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

function buildBeats(bpm: number, phase: number, duration: number): Float32Array {
  const period = 60 / bpm;
  const count = Math.max(0, Math.floor((duration - phase) / period) + 1);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = phase + i * period;
  return out;
}

function pickBlockColor(low: number, mid: number, high: number, rms: number): number {
  // 4-color palette: red(0)=bass, pink(1)=mid, cyan(2)=treble, yellow(3)=full-mix/drops.
  const max = Math.max(low, mid, high);
  if (rms > 0.65 && max - Math.min(low, mid, high) < 0.25) return 3;
  if (max === low) return 0;
  if (max === mid) return 1;
  return 2;
}

function buildEvents(
  features: AudioFeatures,
  beats: Float32Array,
  duration: number,
  laneCount: number,
  difficulty: number,
): GameEvent[] {
  const events: GameEvent[] = [];
  const hop = features.hopSeconds;
  const period = beats.length > 1 ? beats[1]! - beats[0]! : 60 / 120;

  // Smoothed curvature for lane biasing — keeps blocks roughly on the path.
  const curve = smooth(features.low, 32);

  // Colored blocks: one per beat. We only skip TRULY silent beats (intro
  // / outro padding) so the cube-spawn cadence matches the song's beat
  // rate and the rhythm reads visually on the road.
  let lastLane = Math.floor(laneCount / 2);
  for (let i = 1; i < beats.length; i++) {
    const t = beats[i]!;
    if (t >= duration - 0.1) break;
    const f = Math.min(features.frameCount - 1, Math.floor(t / hop));
    const rms = features.rms[f]!;
    if (rms < 0.03) continue; // skip near-dead-silence only

    const bias = curve[f]! - 0.5;
    let lane = Math.floor(((bias + 1) / 2) * laneCount);
    // Add a little zig-zag so a section of same-color blocks isn't all in one lane.
    lane += (i % 3) - 1;
    lane = Math.max(0, Math.min(laneCount - 1, lane));
    lastLane = lane;

    const color = pickBlockColor(features.low[f]!, features.mid[f]!, features.high[f]!, rms);
    events.push({ t, type: "pickup", lane, color });
  }

  // ----- Hazards (gated by difficulty) -----
  // difficulty=0 → no hazards at all (peaceful mode for new players).
  // difficulty=0.5 → roughly the original density.
  // difficulty=1.0 → ~2× density: keep every flux peak AND ~2× scatter.
  const hazardMultiplier = Math.max(0, Math.min(2, difficulty * 2));
  if (hazardMultiplier > 0.01) {
    // Flux peaks (musical accents): keep each with probability proportional
    // to the hazard multiplier (capped at 1.0).
    const peakKeepProb = Math.min(1, hazardMultiplier);
    const peakFrames = detectFluxPeaks(features.flux, hop, period * 0.75);
    const usedTimes: number[] = [];
    for (const f of peakFrames) {
      const t = f * hop;
      if (t < 2 || t > duration - 0.5) continue;
      // Skip if very close to a beat (already a block there).
      const nearestBeat = Math.round((t - (beats[0] ?? 0)) / period);
      const nearestT = (beats[0] ?? 0) + nearestBeat * period;
      if (Math.abs(t - nearestT) < 0.08) continue;
      if (Math.random() > peakKeepProb) continue;
      // Pick a lane that's NOT the most recent block lane so you can actually dodge.
      const lane = (lastLane + 1 + Math.floor(Math.random() * (laneCount - 1))) % laneCount;
      events.push({ t, type: "hazard", lane, intensity: features.flux[f]! });
      usedTimes.push(t);
    }

    // Random scatter: tighter interval at higher difficulty.
    const scatterInterval = 3.5 / hazardMultiplier;
    for (let t = 4; t < duration - 1; t += scatterInterval * (0.6 + Math.random() * 0.8)) {
      const f = Math.min(features.frameCount - 1, Math.floor(t / hop));
      if (features.rms[f]! < 0.1) continue;
      const nearestBeat = Math.round((t - (beats[0] ?? 0)) / period);
      const nearestT = (beats[0] ?? 0) + nearestBeat * period;
      if (Math.abs(t - nearestT) < 0.1) continue;
      if (usedTimes.some((u) => Math.abs(u - t) < 0.4)) continue;
      const lane = Math.floor(Math.random() * laneCount);
      events.push({ t, type: "hazard", lane });
      usedTimes.push(t);
    }
  }

  events.sort((a, b) => a.t - b.t);
  return events;
}

export async function generateBeatmap(
  buffer: AudioBuffer,
  options: BeatmapOptions = {},
): Promise<TrackData> {
  const laneCount = options.laneCount ?? DEFAULT_LANES;
  const difficulty = Math.max(0, Math.min(1, options.difficulty ?? DEFAULT_DIFFICULTY));
  const onProgress = options.onProgress;

  onProgress?.({ phase: "bpm", ratio: 0 });
  let bpm = 120;
  try {
    bpm = await detectBpm(buffer);
  } catch {
    // Fallback BPM if detector can't find one.
    bpm = 120;
  }
  bpm = Math.max(60, Math.min(200, bpm));
  onProgress?.({ phase: "bpm", ratio: 1 });

  const pcm = toMono(buffer);
  onProgress?.({ phase: "features", ratio: 0 });
  const features = await runWorker(pcm, buffer.sampleRate, (r) =>
    onProgress?.({ phase: "features", ratio: r }),
  );
  onProgress?.({ phase: "features", ratio: 1 });

  onProgress?.({ phase: "beatmap", ratio: 0 });
  const curvature = buildCurvature(features);
  const elevation = buildElevation(features);
  const intensity = buildIntensity(features);
  const phase = estimateBeatPhase(features, bpm);
  const beats = buildBeats(bpm, phase, buffer.duration);
  const events = buildEvents(features, beats, buffer.duration, laneCount, difficulty);
  onProgress?.({ phase: "beatmap", ratio: 1 });

  const id = await hashAudioBuffer(buffer);
  return {
    id,
    duration: buffer.duration,
    bpm,
    beats,
    laneCount,
    curvature,
    elevation,
    intensity,
    hopSeconds: features.hopSeconds,
    events,
  };
}
