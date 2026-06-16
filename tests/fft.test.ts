import { describe, it, expect } from "vitest";
import { createFFT } from "../src/audio/fft.js";

describe("FFT", () => {
  it("isolates a pure sinusoid in a single bin", () => {
    const N = 1024;
    const fft = createFFT(N);
    const signal = new Float32Array(N);
    const bin = 32;
    for (let i = 0; i < N; i++) signal[i] = Math.cos((2 * Math.PI * bin * i) / N);
    const out = new Float32Array(N / 2);
    fft.magnitudes(signal, out);

    let maxIdx = 0;
    let maxVal = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i]! > maxVal) {
        maxVal = out[i]!;
        maxIdx = i;
      }
    }
    expect(maxIdx).toBe(bin);
    expect(maxVal).toBeGreaterThan(N / 4);
  });

  it("rejects non-power-of-two sizes", () => {
    expect(() => createFFT(1000)).toThrow();
  });
});
