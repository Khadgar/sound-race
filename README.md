# Sound Race

A lo-fi, browser-based, real-3D arcade racer where the track and obstacles are generated from an audio file you provide. Inspired by Audiosurf, with a synthwave aesthetic.

> **Note on YouTube URLs:** YouTube's Terms of Service and Player API do not allow extracting audio for client-side analysis. Sound Race therefore accepts local audio files and (CORS-enabled) direct audio URLs. All audio analysis happens in your browser — your files are never uploaded.

## Stack

- TypeScript + Vite
- Three.js (WebGL 3D rendering, real PerspectiveCamera, lights, fog, shadows)
- Web Audio API (`AudioContext`, `OfflineAudioContext`, `AnalyserNode`)
- Meyda + web-audio-beat-detector for offline feature extraction in a Web Worker

## Development

```bash
npm install
npm run dev      # start dev server
npm run build    # type-check + production build
npm run test     # run Vitest
npm run lint     # ESLint
npm run format   # Prettier
```

## Controls

### Keyboard
- `A` / `←`  — lane left
- `D` / `→`  — lane right
- `Space`    — activate shield
- `Escape`   — pause / resume

### Touch / Mobile
- Tap **left side** of screen — lane left
- Tap **right side** of screen — lane right
- **Shield button** (bottom-center) — activate shield
- **Pause button** (top-right corner) — pause / resume

On-screen touch controls are always visible during gameplay.

## Offline Track Caching

Featured tracks are automatically downloaded and cached (via the Cache API) on first launch. Subsequent visits load instantly from cache — no re-download needed. This works in both browsers and Capacitor (Android) WebViews, and keeps the app binary small by not bundling audio files.

## Android (Capacitor)

The project uses [Capacitor](https://capacitorjs.com/) to wrap the web app as a native Android application.

### Prerequisites

- [Android Studio](https://developer.android.com/studio) installed
- Android SDK (API 22+ / Android 5.1+)
- Java 17+

### Build & run

```bash
npm run cap:sync    # build web → sync to android → strip MP3s from APK
npm run cap:open    # open in Android Studio
npm run cap:run     # build & run on connected device/emulator
```

`cap:sync` runs a post-sync script (`scripts/strip-mp3.mjs`) that removes bundled MP3 files from the Android assets. Featured tracks are downloaded on first launch via the Cache API instead, keeping the APK small.

### Hosting tracks for mobile

For the Android build, featured tracks need to be hosted externally (since they're stripped from the APK). Update `TRACKS_BASE_URL` in `src/audio/preloadedTracks.ts` to point at your CDN or static host:

```ts
export const TRACKS_BASE_URL = "https://your-cdn.example.com/tracks/";
```

For the browser version, the default `"/"` serves tracks from Vite's `public/` folder as usual.

## Status

Playable. See
[`.github/copilot-instructions.md`](./.github/copilot-instructions.md)
for an architecture overview and contributor guide (AI agents *and*
humans).
