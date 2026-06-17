import { decodeAudioSource } from "./audio/decoder.js";
import { generateBeatmap } from "./audio/beatmap.js";
import { AudioPlayer } from "./audio/player.js";
import { ensureTracksAvailable } from "./audio/trackCache.js";
import { GameEngine } from "./game/engine.js";
import { detectQuality } from "./game/quality.js";
import { Renderer } from "./game/render/Renderer.js";
import { SceneEnv } from "./game/render/SceneEnv.js";
import { GameScene } from "./game/scene.js";
import type { ScoreSummary } from "./game/score.js";
import { recordHighscore } from "./storage/highscores.js";
import { MenuOverlay, type RaceOptions } from "./ui/menu.js";

async function bootstrap(): Promise<void> {
  const appEl = document.getElementById("app");
  if (!appEl) throw new Error("#app element missing");

  const quality = detectQuality();

  // Three.js renderer owns the canvas + Scene + chase PerspectiveCamera
  // for the lifetime of the page. Each race installs its own subgraph
  // into renderer.scene and tears it down on destroy.
  const renderer = new Renderer({ host: appEl, quality });
  const sceneEnv = new SceneEnv(renderer.scene, quality);

  const menu = new MenuOverlay(appEl);

  // On first run, download and cache featured tracks.
  const didDownload = await ensureTracksAvailable((p) => {
    menu.showFirstRunDownload(p.current, p.total, p.filename, p.fileProgress);
  });
  if (didDownload) menu.renderTitle();

  let activeScene: GameScene | null = null;
  let activeEngine: GameEngine | null = null;
  let activePlayer: AudioPlayer | null = null;
  // Remembered for the Restart button on the pause / results screens.
  let lastSource: File | string | null = null;
  let lastOpts: RaceOptions | null = null;
  let paused = false;

  function cleanupActiveRace(): void {
    activeEngine?.stop();
    activePlayer?.stop();
    activeScene?.destroy();
    void activePlayer?.dispose();
    activeScene = null;
    activeEngine = null;
    activePlayer = null;
    paused = false;
  }

  async function restartCurrentRace(): Promise<void> {
    if (lastSource == null || lastOpts == null) return;
    cleanupActiveRace();
    menu.hide();
    await loadAndRace(lastSource, lastOpts);
  }

  function quitToMenu(): void {
    cleanupActiveRace();
    menu.show();
  }

  function pauseRace(): void {
    if (paused || !activePlayer || !activeScene) return;
    paused = true;
    activePlayer.pause();
    menu.showPaused(activeScene.getScoreSnapshot(), {
      onResume: () => resumeRace(),
      onRestart: () => void restartCurrentRace(),
      onQuitToMenu: () => quitToMenu(),
    });
  }

  function resumeRace(): void {
    if (!paused || !activePlayer) return;
    paused = false;
    menu.hide();
    void activePlayer.start();
  }

  async function loadAndRace(source: File | string, opts: RaceOptions): Promise<void> {
    lastSource = source;
    lastOpts = opts;
    try {
      menu.showLoading("decode", 0);
      const buffer = await decodeAudioSource(source, {
        onProgress: (phase, ratio) => menu.showLoading(phase, ratio),
      });

      const track = await generateBeatmap(buffer, {
        difficulty: opts.difficulty,
        onProgress: (p) => menu.showLoading(p.phase, p.ratio),
      });

      const player = new AudioPlayer(buffer);
      activePlayer = player;

      const scene = new GameScene(renderer, sceneEnv, track, player, {
        onFinish: (summary: ScoreSummary) => {
          const at = Date.now();
          const list = recordHighscore(track.id, {
            score: summary.score,
            combo: summary.maxCombo,
            accuracy: summary.accuracy,
            grade: summary.grade,
            at,
            name: opts.playerName.trim() || undefined,
          });
          activeEngine?.stop();
          player.stop();
          paused = false;
          menu.showResults(summary, list, at, {
            onRestart: () => void restartCurrentRace(),
            onQuitToMenu: () => quitToMenu(),
          });
        },
      }, quality);
      activeScene = scene;

      menu.hide();
      scene.attachInput(renderer.domElement, () => {
        if (paused) resumeRace();
        else pauseRace();
      });

      const engine = new GameEngine(player, {
        update: (dt, t) => scene.update(dt, t),
        render: (t, a) => scene.render(t, a),
      });
      activeEngine = engine;

      await player.start();
      engine.start();
    } catch (err) {
      console.error(err);
      cleanupActiveRace();
      menu.show();
      menu.renderTitle();
      menu.setStatus(`Error: ${(err as Error).message}`);
    }
  }

  menu.setCallbacks({
    onLoadFile: (f, opts) => void loadAndRace(f, opts),
    onLoadUrl: (u, opts) => void loadAndRace(u, opts),
  });

  window.addEventListener("beforeunload", () => {
    activeEngine?.stop();
    activeScene?.destroy();
    void activePlayer?.dispose();
  });
}

bootstrap().catch((err) => {
  console.error(err);
  const el = document.getElementById("app");
  if (el) el.textContent = `Failed to start: ${(err as Error).message}`;
});
