/**
 * Sampler utilities for time-indexed Float32 series.
 */

export function sampleSeries(series: Float32Array, hopSeconds: number, t: number): number {
  if (series.length === 0) return 0;
  const idxF = t / hopSeconds;
  const i0 = Math.floor(idxF);
  const i1 = i0 + 1;
  if (i0 <= 0) return series[0]!;
  if (i1 >= series.length) return series[series.length - 1]!;
  const frac = idxF - i0;
  return series[i0]! * (1 - frac) + series[i1]! * frac;
}

/**
 * Precompute cumulative lateral offset (centerX) from a curvature series.
 * Returned values are in arbitrary world units; the renderer scales them.
 */
export function integrateCurvature(curvature: Float32Array, hopSeconds: number): Float32Array {
  const out = new Float32Array(curvature.length);
  let acc = 0;
  for (let i = 0; i < curvature.length; i++) {
    acc += curvature[i]! * hopSeconds;
    // Mild restoring force so the path doesn't drift unboundedly.
    acc *= 0.995;
    out[i] = acc;
  }
  return out;
}
