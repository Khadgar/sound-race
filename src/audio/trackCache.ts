/**
 * Track cache — downloads and caches featured tracks on first run.
 *
 * Uses the Cache API (available without a Service Worker) to persist
 * downloaded MP3s across sessions. Works identically in a browser and
 * in a Capacitor WebView.
 */

import {
  PRELOADED_TRACKS,
  TRACKS_CACHE_NAME,
} from "./preloadedTracks.js";

export interface TrackCacheProgress {
  /** Index of the track currently being downloaded (0-based). */
  current: number;
  /** Total number of tracks to download. */
  total: number;
  /** Filename currently downloading. */
  filename: string;
  /** 0–1 download progress for the current file (0 if unknown). */
  fileProgress: number;
}

/**
 * Ensures all featured tracks are available in the Cache API.
 * Downloads any that are missing and reports progress.
 *
 * @returns `true` if any downloads were needed (first run), `false` if
 *   all tracks were already cached.
 */
export async function ensureTracksAvailable(
  onProgress?: (p: TrackCacheProgress) => void,
): Promise<boolean> {
  // Cache API not available — fall back silently (tracks will be fetched live).
  if (typeof caches === "undefined") return false;

  const cache = await caches.open(TRACKS_CACHE_NAME);
  const missing: { url: string; filename: string }[] = [];

  for (const track of PRELOADED_TRACKS) {
    const match = await cache.match(track.url);
    if (!match) {
      missing.push({ url: track.url, filename: track.filename });
    }
  }

  if (missing.length === 0) return false;

  for (let i = 0; i < missing.length; i++) {
    const { url, filename } = missing[i]!;
    onProgress?.({ current: i, total: missing.length, filename, fileProgress: 0 });

    const response = await fetchWithProgress(url, (ratio) => {
      onProgress?.({ current: i, total: missing.length, filename, fileProgress: ratio });
    });

    await cache.put(url, response);
    onProgress?.({ current: i, total: missing.length, filename, fileProgress: 1 });
  }

  return true;
}

/**
 * Retrieves a cached track response, or fetches it live as fallback.
 * Returns an ArrayBuffer ready for decodeAudioData.
 */
export async function getCachedTrackBuffer(url: string): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;

  const cache = await caches.open(TRACKS_CACHE_NAME);
  const match = await cache.match(url);
  if (!match) return null;
  return match.arrayBuffer();
}

/**
 * Check whether a URL is a preloaded track (eligible for cache lookup).
 */
export function isPreloadedTrackUrl(url: string): boolean {
  return PRELOADED_TRACKS.some((t) => t.url === url);
}

/** Fetch with download progress reporting. */
async function fetchWithProgress(
  url: string,
  onProgress: (ratio: number) => void,
): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download track: ${res.status} ${res.statusText}`);

  const total = Number(res.headers.get("content-length") ?? 0);

  // If no content-length or no body streaming, just return the response clone
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onProgress(1);
    return new Response(buf, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "audio/mpeg" },
    });
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received / total);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  onProgress(1);
  return new Response(body.buffer, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "audio/mpeg" },
  });
}
