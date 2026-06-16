/**
 * Pre-loaded MP3 tracks served from `public/` (browser) or downloaded
 * on first run from TRACKS_BASE_URL (Capacitor / PWA).
 *
 * To add a new track, drop the .mp3 into `public/` and append its
 * filename below. Display name is derived from the filename.
 */

/** Base URL for fetching featured tracks. Uses Vite's base so paths
 *  work on both root deploys and subpath deploys (e.g. GitHub Pages). */
export const TRACKS_BASE_URL = import.meta.env.BASE_URL;

/** Cache name used by the Cache API to store downloaded tracks. */
export const TRACKS_CACHE_NAME = "sound-race-tracks";

const FILENAMES: ReadonlyArray<string> = [
  "sandstorm.mp3",
  "synthwave.mp3",
  "midnight-synthwave.mp3",
];

export interface PreloadedTrack {
  url: string;
  filename: string;
  displayName: string;
}

/** Returns the full URL for a given track filename. */
export function getTrackUrl(filename: string): string {
  return TRACKS_BASE_URL + encodeURIComponent(filename);
}

export const PRELOADED_TRACKS: ReadonlyArray<PreloadedTrack> = FILENAMES.map(
  (filename) => ({
    url: getTrackUrl(filename),
    filename,
    displayName: prettifyFilename(filename),
  }),
);

function prettifyFilename(filename: string): string {
  return filename
    .replace(/\.mp3$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
