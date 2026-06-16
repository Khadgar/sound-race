/**
 * Offline audio analyzer running in a Web Worker.
 *
 * Receives a Float32 mono PCM buffer + sample rate, computes per-frame
 * features (RMS, band energies, spectral flux) using a hand-rolled FFT,
 * then ships the typed arrays back via Transferable transfer.
 */

import { createFFT } from "./fft.js";
import type { AudioFeatures } from "./types.js";

export interface AnalyzeRequest {
  type: "analyze";
  pcm: Float32Array;
  sampleRate: number;
  fftSize?: number;
  hopSize?: number;
}

export type AnalyzeProgress = { type: "progress"; ratio: number };
export type AnalyzeResult = { type: "result"; features: AudioFeatures };
export type AnalyzeError = { type: "error"; message: string };
export type AnalyzeMessage = AnalyzeProgress | AnalyzeResult | AnalyzeError;

const FFT_SIZE = 2048;
const HOP_SIZE = 1024;

function hann(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

function normalize(arr: Float32Array): void {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i]! > max) max = arr[i]!;
  if (max <= 1e-9) return;
  const inv = 1 / max;
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! * inv;
}

function analyze(req: AnalyzeRequest): AudioFeatures {
  const fftSize = req.fftSize ?? FFT_SIZE;
  const hopSize = req.hopSize ?? HOP_SIZE;
  const { pcm, sampleRate } = req;
  const fft = createFFT(fftSize);
  const window = hann(fftSize);
  const frame = new Float32Array(fftSize);
  const mags = new Float32Array(fftSize / 2);
  const prevMags = new Float32Array(fftSize / 2);

  const frameCount = Math.max(0, Math.floor((pcm.length - fftSize) / hopSize) + 1);
  const rms = new Float32Array(frameCount);
  const low = new Float32Array(frameCount);
  const mid = new Float32Array(frameCount);
  const high = new Float32Array(frameCount);
  const flux = new Float32Array(frameCount);

  const nyquist = sampleRate / 2;
  const binHz = nyquist / (fftSize / 2);
  const lowMax = Math.min(fftSize / 2, Math.floor(250 / binHz));
  const midMax = Math.min(fftSize / 2, Math.floor(2000 / binHz));

  let lastProgress = 0;

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    let sum = 0;
    for (let i = 0; i < fftSize; i++) {
      const s = pcm[start + i] ?? 0;
      frame[i] = s * window[i]!;
      sum += s * s;
    }
    rms[f] = Math.sqrt(sum / fftSize);

    fft.magnitudes(frame, mags);

    let lo = 0,
      md = 0,
      hi = 0;
    for (let i = 1; i < lowMax; i++) lo += mags[i]!;
    for (let i = lowMax; i < midMax; i++) md += mags[i]!;
    for (let i = midMax; i < fftSize / 2; i++) hi += mags[i]!;
    low[f] = lo / Math.max(1, lowMax - 1);
    mid[f] = md / Math.max(1, midMax - lowMax);
    high[f] = hi / Math.max(1, fftSize / 2 - midMax);

    let fl = 0;
    for (let i = 0; i < fftSize / 2; i++) {
      const d = mags[i]! - prevMags[i]!;
      if (d > 0) fl += d;
      prevMags[i] = mags[i]!;
    }
    flux[f] = fl;

    if (f - lastProgress > Math.max(1, frameCount / 50)) {
      lastProgress = f;
      const msg: AnalyzeMessage = { type: "progress", ratio: f / frameCount };
      (self as unknown as Worker).postMessage(msg);
    }
  }

  normalize(rms);
  normalize(low);
  normalize(mid);
  normalize(high);
  normalize(flux);

  return {
    hopSeconds: hopSize / sampleRate,
    frameCount,
    rms,
    low,
    mid,
    high,
    flux,
  };
}

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  try {
    if (e.data?.type !== "analyze") return;
    const features = analyze(e.data);
    const transfer = [
      features.rms.buffer,
      features.low.buffer,
      features.mid.buffer,
      features.high.buffer,
      features.flux.buffer,
    ];
    const msg: AnalyzeMessage = { type: "result", features };
    (self as unknown as Worker).postMessage(msg, transfer);
  } catch (err) {
    const msg: AnalyzeMessage = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(msg);
  }
};
