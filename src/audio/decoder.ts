/**
 * Decode an audio source (File or URL) into an AudioBuffer.
 * Everything happens in the user's browser — no upload.
 */

import { getCachedTrackBuffer, isPreloadedTrackUrl } from "./trackCache.js";

export type DecodeProgress = (phase: "fetch" | "decode", ratio: number) => void;

const MAX_BYTES = 60 * 1024 * 1024; // 60 MB hard cap
const ALLOWED_MIME = /^audio\/(mpeg|mp3|wav|wave|x-wav|ogg|flac|aac|mp4|x-m4a|webm)$/i;

export interface DecodeOptions {
  onProgress?: DecodeProgress;
  signal?: AbortSignal;
  /** Override the AudioContext used for decoding (mainly for tests). */
  audioContext?: BaseAudioContext;
}

function getDecodeContext(opts: DecodeOptions): BaseAudioContext {
  if (opts.audioContext) return opts.audioContext;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API not supported in this browser");
  return new Ctor();
}

async function readFile(file: File, onProgress?: DecodeProgress): Promise<ArrayBuffer> {
  if (file.size > MAX_BYTES) {
    throw new Error(`File too large (${(file.size / 1_048_576).toFixed(1)} MB, max 60 MB)`);
  }
  if (file.type && !ALLOWED_MIME.test(file.type)) {
    // Some browsers report empty type for valid audio — only reject if a type is set and unknown.
    throw new Error(`Unsupported audio type: ${file.type}`);
  }
  onProgress?.("fetch", 0);
  const buf = await file.arrayBuffer();
  onProgress?.("fetch", 1);
  return buf;
}

async function fetchUrl(url: string, opts: DecodeOptions): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: opts.signal, mode: "cors" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (total && total > MAX_BYTES) {
    throw new Error(`Remote file too large (${(total / 1_048_576).toFixed(1)} MB, max 60 MB)`);
  }

  if (!res.body || !opts.onProgress || !total) {
    const buf = await res.arrayBuffer();
    opts.onProgress?.("fetch", 1);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (received > MAX_BYTES) throw new Error("Remote file exceeded 60 MB during download");
    opts.onProgress("fetch", received / total);
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

export async function decodeAudioSource(
  source: File | string,
  options: DecodeOptions = {},
): Promise<AudioBuffer> {
  let raw: ArrayBuffer;

  if (typeof source === "string" && isPreloadedTrackUrl(source)) {
    // Try cache first for featured tracks (avoids re-downloading).
    options.onProgress?.("fetch", 0);
    const cached = await getCachedTrackBuffer(source);
    raw = cached ?? await fetchUrl(source, options);
    if (cached) options.onProgress?.("fetch", 1);
  } else if (typeof source === "string") {
    raw = await fetchUrl(source, options);
  } else {
    raw = await readFile(source, options.onProgress);
  }

  options.onProgress?.("decode", 0);
  const ctx = getDecodeContext(options);
  // decodeAudioData detaches the ArrayBuffer; pass a slice so callers can keep using `raw` if needed.
  const buffer = await ctx.decodeAudioData(raw.slice(0));
  options.onProgress?.("decode", 1);
  return buffer;
}

/** Convenience: hash the decoded audio (downsampled) for stable per-track IDs. */
export async function hashAudioBuffer(buffer: AudioBuffer): Promise<string> {
  const channel = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(channel.length / 16384));
  const down = new Float32Array(Math.ceil(channel.length / step));
  for (let i = 0, j = 0; i < channel.length; i += step, j++) down[j] = channel[i] ?? 0;
  const digest = await crypto.subtle.digest("SHA-256", down.buffer);
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
