/**
 * Minimal in-place radix-2 Cooley–Tukey FFT (real-input convenience wrapper).
 * Used by the analyzer worker to extract spectral features without pulling
 * in a heavy DSP dependency.
 */

export interface FFT {
  readonly size: number;
  /** Forward transform; writes magnitudes (length size/2) into `out`. */
  magnitudes(timeDomain: Float32Array, out: Float32Array): void;
}

export function createFFT(size: number): FFT {
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error(`FFT size must be a power of two, got ${size}`);
  }
  const cos = new Float32Array(size / 2);
  const sin = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    const a = (-2 * Math.PI * i) / size;
    cos[i] = Math.cos(a);
    sin[i] = Math.sin(a);
  }
  const reverse = new Uint32Array(size);
  const bits = Math.log2(size) | 0;
  for (let i = 0; i < size; i++) {
    let v = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (v & 1);
      v >>= 1;
    }
    reverse[i] = r;
  }

  const re = new Float32Array(size);
  const im = new Float32Array(size);

  return {
    size,
    magnitudes(timeDomain, out) {
      if (timeDomain.length !== size) throw new Error("input length mismatch");
      if (out.length !== size / 2) throw new Error("output length must be size/2");

      for (let i = 0; i < size; i++) {
        re[i] = timeDomain[reverse[i]!]!;
        im[i] = 0;
      }

      for (let step = 2; step <= size; step <<= 1) {
        const half = step >> 1;
        const tableStride = size / step;
        for (let i = 0; i < size; i += step) {
          for (let j = 0; j < half; j++) {
            const tIdx = j * tableStride;
            const c = cos[tIdx]!;
            const s = sin[tIdx]!;
            const kRe = re[i + j + half]! * c - im[i + j + half]! * s;
            const kIm = re[i + j + half]! * s + im[i + j + half]! * c;
            re[i + j + half] = re[i + j]! - kRe;
            im[i + j + half] = im[i + j]! - kIm;
            re[i + j] = re[i + j]! + kRe;
            im[i + j] = im[i + j]! + kIm;
          }
        }
      }

      for (let i = 0; i < size / 2; i++) {
        out[i] = Math.hypot(re[i]!, im[i]!);
      }
    },
  };
}
