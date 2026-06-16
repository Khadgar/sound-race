# Sound Race — Copilot / AI agent instructions

This file is for AI coding assistants (GitHub Copilot, Copilot CLI,
Claude, Cursor, etc.) working on this codebase. Keep it short, current,
and high-signal — when in doubt, the code is the source of truth.

## 1. What this is

**Sound Race** is a browser-only, audio-driven arcade racer in the
spirit of Audiosurf. The user supplies an audio file (or a CORS-enabled
direct URL, or picks one of the bundled featured tracks); the game
analyses the audio offline, generates a curving 3-lane track with
pickups and hazards keyed to beats and spectral flux, then renders the
race in real-time Three.js with a synthwave aesthetic. Nothing leaves
the browser.

## 2. Tech stack

- **TypeScript** (strict, `tsc --noEmit` runs as part of `npm run build`).
- **Vite 6** — dev server + production bundler. Static `public/` is
  served at the site root.
- **Three.js 0.160** — real 3D with `PerspectiveCamera`, lights, fog,
  shadows. We do **not** use any 2D rendering layer (PixiJS was the
  original prototype direction but was dropped in favour of full 3D).
- **Web Audio API** — `AudioContext` for playback + `AnalyserNode` for
  live spectrum; `OfflineAudioContext` indirectly via the decoder.
- **`meyda`** + **`web-audio-beat-detector`** for offline feature
  extraction; FFT analysis runs in a dedicated Web Worker
  (`src/audio/analyzer.worker.ts`).
- **Vitest** for tests, **ESLint** + **Prettier** for tooling.
- **No backend.** Highscores are `localStorage` only.

## 3. Repo layout

```
sound-race/
  .github/
    copilot-instructions.md   # this file
  public/                     # static assets served at /
    *.mp3                     # featured tracks
  src/
    main.ts                   # bootstrap; owns Renderer + MenuOverlay,
                              # runs loadAndRace() per race
    audio/
      decoder.ts              # File|URL → AudioBuffer (+ hashing for
                              #   stable track ids)
      analyzer.worker.ts      # Web Worker: PCM → AudioFeatures
      fft.ts                  # pure-TS FFT (worker dep, no DOM)
      beatmap.ts              # AudioBuffer → TrackData (BPM, curvature,
                              #   intensity, events)
      player.ts               # AudioPlayer: playback + live bands
      preloadedTracks.ts      # static list of featured public/*.mp3
      types.ts                # AudioFeatures, GameEvent, TrackData
    game/
      engine.ts               # fixed-step game loop driven by audio time
      input.ts                # keyboard + touch → lane index, pause,
                              #   shield triggers
      palette.ts              # block color constants
      score.ts                # ScoreState, scoring rules, summarize()
      track.ts                # curvature integration + sampling helpers
      scene.ts                # GameScene — orchestrates everything per
                              #   race; owns the Three.js subgraph
      render/                 # presentation layer (Three.js)
        Renderer.ts           # canvas + camera + scene host
        SceneEnv.ts           # sky / sun / fog / lighting rig
        Track3D.ts            # road geometry, lane markers
        Hull.ts               # the player's ship
        Entities3D.ts         # pickups + hazards + collision outcomes
        Fx.ts                 # post-effects (flash, cluster pulse, hint)
        ParticleBurst.ts      # one-shot particle systems
        Shockwave.ts          # ring shock-wave on hit
    storage/
      highscores.ts           # per-track-id localStorage with names
    ui/
      hud.ts                  # in-race DOM HUD (score, BPM, shields, …)
      menu.ts                 # title / loading / pause / results panels
      styles.css              # CSS tokens + .overlay/.panel base styles
  tests/
    fft.test.ts
    game.test.ts              # scoring + track utility tests
    smoke.test.ts
```

## 4. Architecture in one diagram

```
File / URL ──► decoder ──► AudioBuffer ─┬──► AudioPlayer (playback + live bands)
                                        │
                                        └──► beatmap.ts
                                              │  (web worker for FFT features)
                                              ▼
                                          TrackData (curvature, intensity,
                                                     beats, events)
                                              │
                            ┌─────────────────┴─────────────────┐
                            ▼                                   ▼
                       GameScene  ◄── GameEngine (fixed-step) ──┘
                            │           (reads player.currentTime
                            │            as the master clock)
                            ▼
                  Three.js Renderer  +  DOM HUD  +  MenuOverlay
```

- **The audio clock is the source of truth.** Everything in the game
  loop is timed off `player.currentTime`. Don't introduce wall-clock
  side channels for gameplay state.
- **`main.ts` is the only state owner.** It holds the active scene,
  engine, player, and the `lastSource` / `lastOpts` / `paused` flags
  used to drive Restart and pause/resume. Don't sprinkle global state
  elsewhere.
- **`MenuOverlay` is the only DOM panel.** Title, loading, pause, and
  results are all `MenuOverlay` methods that rewrite a single `.panel`
  element. New full-screen UI states should be added as new methods on
  this class.
- **`GameScene` owns its own Three.js subgraph** under `root: THREE.Group`
  and disposes everything in `destroy()`. New per-race meshes/materials
  must be added to that group and cleaned up too — otherwise WebGL
  leaks on restart.

## 5. What's already done

- Audio decoding from `File` or URL, with progress callbacks.
- Offline beatmap generation (BPM via `web-audio-beat-detector`,
  spectral features via FFT worker + Meyda).
- Fixed-step engine + lane input + pause / shield handling.
- 3D scene: synthwave sky/sun, curving elevated track, animated hull,
  pickups + hazards, particle bursts, shockwaves, post-effects.
- DOM HUD with score, time, BPM, speed, combo, health, shields, and a
  color-frequency block queue.
- Scoring: combo, cluster bonus (3+ same-color streak), accuracy,
  S/A/B/C/D grading, 3-charge shield system that deflects hazards.
- Title menu: player-name input (persisted), difficulty slider, file
  picker, URL loader, featured tracks (`public/*.mp3`).
- Pause overlay with live stats + Resume / Restart / Quit-to-menu.
- Results screen with grade, score, full stat breakdown, rank badge,
  top-runs list (showing names), Restart + Pick-another-track buttons.
- Restart re-runs the same source + difficulty + player-name.
- Per-track local highscores keyed by audio-content hash, with player
  name persisted alongside.

## 6. Conventions

- **TypeScript strictness.** No `any`, no implicit any, no
  non-null-assertions unless the surrounding code already proves
  non-nullness. Prefer `??`, `?.`, and explicit `if (x == null)` guards.
- **Comments.** Only where they add value — explain *why*, not *what*.
  Prefer a short module-header comment on each non-trivial file.
- **DOM:** all UI is hand-rolled in `menu.ts` / `hud.ts` with inline
  styles + the few tokens in `styles.css` (`--bg`, `--fg`, `--accent`,
  `--accent2`, `--muted`). Don't add a framework.
- **No external network calls** in any code path (other than the user
  pasting an audio URL). The whole point is "nothing leaves your
  browser".
- **Local storage keys are namespaced** with `sound-race/` or
  `sound-race.` prefixes. Wrap in try/catch — private mode and quotas
  must not crash the app.
- **Scoring** lives entirely in `src/game/score.ts`. Don't compute
  scores anywhere else.
- **Palette / colors** for pickups come from `src/game/palette.ts`;
  UI accents come from CSS variables. Don't hard-code new colors.
- **Public folder = bundled assets.** Anything in `public/` is copied
  to the site root. To add a featured track, drop the mp3 in
  `public/` and append its filename to `PRELOADED_TRACKS` in
  `src/audio/preloadedTracks.ts`. Display names are derived from the
  filename (no ID3 / metadata parsing).

## 7. Critical gotchas

These are non-obvious things that have already burned us once. Don't
re-introduce them.

- **Fixed-step interpolation never reaches `track.duration`.**
  `GameEngine.tick` calls `update(fixedStep, songTime - accumulator + fixedStep)`,
  and the `while` condition (`accumulator >= fixedStep`) guarantees the
  interpolated value is strictly `<= songTime`. So
  `songTimeSec >= track.duration` will **never** fire. End-of-song
  detection must read **`this.player.currentTime`** directly. See the
  comment above the finish check in `GameScene.update`.
- **Web Audio autoplay policy.** `AudioContext` may start suspended;
  the *first* `player.start()` must follow a user gesture (the menu
  buttons satisfy this). Don't try to auto-start a race on page load.
- **`renderTitle()` clears the panel including the `status` element.**
  When showing an error in the error path of `loadAndRace`, call
  `menu.renderTitle()` **before** `menu.setStatus(...)`, otherwise the
  status element you wrote to is orphaned and invisible.
- **GameScene cleanup is mandatory.** Any new Three.js geometry /
  material / texture / point light created per-race must be added to
  the scene's `root` group **and** disposed in `destroy()`. The
  `disposeSubtree` helper at the bottom of `scene.ts` handles geometry
  + material disposal for whatever's in the subgraph; if you add
  resources outside the graph (e.g., the `tempLights` array), you must
  dispose them explicitly.
- **`HighscoreEntry.name` is optional.** Pre-name-feature entries
  exist in users' localStorage; renderers must fall back gracefully
  (`e.name?.trim() || "—"`).

## 8. Development commands

```bash
npm install
npm run dev      # Vite dev server (HMR)
npm run build    # tsc --noEmit && vite build
npm run preview  # serve the production build
npm run test     # vitest run
npm run lint     # eslint
npm run format   # prettier --write
```

The full **lint → build → test** sweep is the canonical "is this
green?" check. Run it before declaring a feature complete.

## 9. Adding things — quick recipes

**Add a featured track**

1. Drop the `.mp3` into `public/`.
2. Append its filename to the `FILENAMES` array in
   `src/audio/preloadedTracks.ts`.
3. Display name is derived from the filename
   (strip `.mp3`, replace `-`/`_` with spaces, title-case).

**Add a new in-race stat to the HUD**

1. Add the field to `ScoreState` in `src/game/score.ts` and update
   `createScoreState()` + the relevant event handlers.
2. Surface it via `HUD.setX(...)` in `src/ui/hud.ts` (build a new DOM
   element in the constructor, expose a setter).
3. Call the setter once per frame from `GameScene.render`.
4. If it should appear in the pause / results panels, add a row to the
   relevant `renderStatSection(...)` call in `src/ui/menu.ts`.

**Add a new gameplay event type**

1. Extend `GameEventType` in `src/audio/types.ts`.
2. Emit the event from `beatmap.ts` (with appropriate intensity logic).
3. Handle it in `Entities3D.ts` (mesh + spawn + collision behaviour)
   and in `GameScene.applyCollisionOutcomes(...)`.
4. Update scoring rules in `score.ts` if needed.

**Add a new menu panel**

Add a new method on `MenuOverlay` (e.g., `showFoo(...)`) that follows
the pattern of `showResults` / `showPaused`: clear `this.panel`, set
`maxHeight` + `overflowY`, build sections with the existing
`renderStatSection` / `renderStatRow` helpers where possible.

## 10. Where to look for…

| If you need to… | Look at… |
| --------------- | -------- |
| Change scoring rules | `src/game/score.ts` |
| Tune speed / curvature / elevation feel | `src/game/scene.ts` (constants at top) |
| Tune lane width / road geometry | `src/game/render/Track3D.ts` (`TRACK3D_CONSTANTS`) |
| Change camera framing | `src/game/render/Renderer.ts` + `Hull.update(... camera)` |
| Tweak post-effects / hit-flash | `src/game/render/Fx.ts` |
| Add a control | `src/game/input.ts` + wiring in `scene.attachInput` |
| Change persistence | `src/storage/highscores.ts` (or `src/ui/menu.ts` for menu prefs) |
| Add a UI panel / button | `src/ui/menu.ts` |
| Change FFT or feature extraction | `src/audio/analyzer.worker.ts` + `src/audio/beatmap.ts` |
