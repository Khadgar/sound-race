/**
 * Menu / loading / results overlay DOM.
 */

import { PRELOADED_TRACKS } from "../audio/preloadedTracks.js";
import { STARTING_SHIELDS, type ScoreSummary } from "../game/score.js";
import type { HighscoreEntry } from "../storage/highscores.js";

const DIFFICULTY_STORAGE_KEY = "sound-race/difficulty";
const DEFAULT_DIFFICULTY = 0.5;
const PLAYER_NAME_STORAGE_KEY = "sound-race/player-name";
const PLAYER_NAME_MAX_LENGTH = 16;

/** Big finishing-screen grade letter — color per grade. */
const GRADE_COLORS: Record<ScoreSummary["grade"], string> = {
  S: "#fff066",
  A: "#5df0ff",
  B: "#5dffa8",
  C: "#ff5dc8",
  D: "#a6a0c0",
};

export interface RaceOptions {
  /** 0 = peaceful (no hazards), 1 = nightmare (~2× hazard density). */
  difficulty: number;
  /** Display name for highscores. Empty string allowed. */
  playerName: string;
}

export interface MenuCallbacks {
  onLoadFile(file: File, opts: RaceOptions): void;
  onLoadUrl(url: string, opts: RaceOptions): void;
}

const DIFFICULTY_LABELS: Array<[number, string]> = [
  [0.05, "PEACEFUL"],
  [0.25, "EASY"],
  [0.55, "MEDIUM"],
  [0.8, "HARD"],
  [1.01, "NIGHTMARE"],
];

function difficultyLabel(v: number): string {
  for (const [upper, label] of DIFFICULTY_LABELS) {
    if (v <= upper) return label;
  }
  return DIFFICULTY_LABELS[DIFFICULTY_LABELS.length - 1]![1];
}

function loadDifficulty(): number {
  try {
    const raw = window.localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    if (raw == null) return DEFAULT_DIFFICULTY;
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v)) return DEFAULT_DIFFICULTY;
    return Math.max(0, Math.min(1, v));
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

function saveDifficulty(v: number): void {
  try {
    window.localStorage.setItem(DIFFICULTY_STORAGE_KEY, String(v));
  } catch {
    /* private mode or quota — ignore */
  }
}

function loadPlayerName(): string {
  try {
    const raw = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (raw == null) return "";
    return raw.slice(0, PLAYER_NAME_MAX_LENGTH);
  } catch {
    return "";
  }
}

function savePlayerName(name: string): void {
  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  } catch {
    /* private mode or quota — ignore */
  }
}

export class MenuOverlay {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private callbacks: MenuCallbacks | null = null;
  private difficulty: number = loadDifficulty();
  private playerName: string = loadPlayerName();

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "overlay";

    this.panel = document.createElement("div");
    this.panel.className = "panel";
    this.root.appendChild(this.panel);

    this.status = document.createElement("div");
    this.status.className = "status";

    this.renderTitle();
    parent.appendChild(this.root);
  }

  setCallbacks(cb: MenuCallbacks): void {
    this.callbacks = cb;
  }

  show(): void {
    this.root.classList.remove("hidden");
  }
  hide(): void {
    this.root.classList.add("hidden");
  }

  setStatus(msg: string): void {
    this.status.textContent = msg;
  }

  /** Re-renders the main title menu. Public so main.ts can return to
   *  it after a race ends or the user quits from the pause overlay. */
  renderTitle(): void {
    this.panel.innerHTML = "";
    this.panel.style.maxHeight = "";
    this.panel.style.overflowY = "";
    const h1 = document.createElement("h1");
    h1.textContent = "SOUND RACE";
    const p = document.createElement("p");
    p.textContent =
      "Drop an audio file or paste a direct audio URL. The track is generated from the music. Nothing leaves your browser.";
    this.panel.appendChild(h1);
    this.panel.appendChild(p);

    this.panel.appendChild(this.renderPlayerNameRow());

    const fileRow = document.createElement("div");
    fileRow.className = "row";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "audio/*";
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) this.callbacks?.onLoadFile(f, this.currentOptions());
    });
    fileRow.appendChild(fileInput);
    this.panel.appendChild(fileRow);

    const urlRow = document.createElement("div");
    urlRow.className = "row";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.placeholder = "https://example.com/song.mp3";
    const urlBtn = document.createElement("button");
    urlBtn.textContent = "Load URL";
    urlBtn.addEventListener("click", () => {
      const v = urlInput.value.trim();
      if (v) this.callbacks?.onLoadUrl(v, this.currentOptions());
    });
    urlRow.appendChild(urlInput);
    urlRow.appendChild(urlBtn);
    this.panel.appendChild(urlRow);

    this.panel.appendChild(this.renderFeaturedTracks());

    this.panel.appendChild(this.renderDifficultyRow());

    const hint = document.createElement("p");
    hint.style.marginTop = "1rem";
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    hint.innerHTML = isTouchDevice
      ? "Controls: <strong>Tap left/right</strong> to switch lanes, <strong>Shield button</strong> (bottom) to activate shield, <strong>Pause button</strong> (top-right) to pause."
      : "Controls: <strong>A/D</strong> or <strong>←/→</strong> switch lanes, <strong>Space</strong> activate shield, <strong>Esc</strong> pause.";
    this.panel.appendChild(hint);

    const how = document.createElement("div");
    how.style.marginTop = "0.75rem";
    how.style.padding = "0.75rem";
    how.style.border = "1px solid var(--muted)";
    how.style.borderRadius = "6px";
    how.style.fontSize = "0.8rem";
    how.style.lineHeight = "1.5";
    how.innerHTML = `
      <div style="color: var(--accent2); margin-bottom: 0.4rem;">▌ HOW TO PLAY</div>
      <div style="color: var(--muted); margin-bottom: 0.35rem;">Pick a featured track or load your own audio.</div>
      <div><span style="color:#ff3d6e;">■</span> <span style="color:#ff5dc8;">■</span> <span style="color:#5df0ff;">■</span> <span style="color:#fff066;">■</span> &nbsp;<strong>COLLECT</strong> colored blocks for points.</div>
      <div style="margin-top:0.25rem;">Match <strong>3+ same color in a row</strong> → cluster bonus.</div>
      <div style="margin-top:0.4rem;"><span style="color:#a6a0c0;">▲</span> &nbsp;<strong>AVOID</strong> gray spikes — they damage your hull.</div>
      <div style="margin-top:0.4rem;"><span style="color:#5df0ff;">◉</span> &nbsp;<strong>SHIELD</strong>: ${isTouchDevice ? "Tap the shield button" : "Space"} activates a 5s force field. 3 charges per run.</div>
      <div style="margin-top:0.25rem; color: var(--muted);">Speed scales with the song's intensity.</div>
    `;
    this.panel.appendChild(how);

    this.panel.appendChild(this.status);
  }

  /** Returns the difficulty row: label + range slider + live label. */
  private renderDifficultyRow(): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "row";
    row.style.alignItems = "center";
    row.style.gap = "0.6rem";
    row.style.marginTop = "0.4rem";

    const label = document.createElement("span");
    label.textContent = "Difficulty";
    label.style.color = "var(--muted)";
    label.style.fontSize = "0.85rem";
    label.style.minWidth = "5.5rem";
    row.appendChild(label);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.05";
    slider.value = String(this.difficulty);
    slider.style.flex = "1";
    slider.style.cursor = "pointer";
    slider.style.accentColor = "#ff5dc8";
    row.appendChild(slider);

    const valueLabel = document.createElement("span");
    valueLabel.textContent = difficultyLabel(this.difficulty);
    valueLabel.style.color = "var(--accent2)";
    valueLabel.style.fontSize = "0.8rem";
    valueLabel.style.minWidth = "6.5rem";
    valueLabel.style.textAlign = "right";
    valueLabel.style.letterSpacing = "0.08em";
    row.appendChild(valueLabel);

    slider.addEventListener("input", () => {
      const v = Math.max(0, Math.min(1, Number.parseFloat(slider.value)));
      this.difficulty = v;
      valueLabel.textContent = difficultyLabel(v);
      saveDifficulty(v);
    });

    return row;
  }

  private currentOptions(): RaceOptions {
    return { difficulty: this.difficulty, playerName: this.playerName };
  }

  /** Renders the PLAYER NAME row — label + text input that persists
   *  to localStorage on every keystroke. */
  private renderPlayerNameRow(): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "row";
    row.style.alignItems = "center";
    row.style.gap = "0.6rem";
    row.style.marginTop = "0.4rem";

    const label = document.createElement("span");
    label.textContent = "Player";
    label.style.color = "var(--muted)";
    label.style.fontSize = "0.85rem";
    label.style.minWidth = "5.5rem";
    row.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Your name";
    input.maxLength = PLAYER_NAME_MAX_LENGTH;
    input.value = this.playerName;
    input.style.flex = "1";
    input.addEventListener("input", () => {
      this.playerName = input.value.slice(0, PLAYER_NAME_MAX_LENGTH);
      savePlayerName(this.playerName);
    });
    row.appendChild(input);

    return row;
  }

  /**
   * Renders the FEATURED TRACKS section: a row of buttons pre-bound
   * to the MP3 files in `public/`. Button labels come from the
   * filename (see `preloadedTracks.ts`).
   */
  private renderFeaturedTracks(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "0.75rem";

    const header = document.createElement("div");
    header.textContent = "▌ FEATURED TRACKS";
    header.style.color = "var(--accent2)";
    header.style.fontSize = "0.75rem";
    header.style.letterSpacing = "0.12em";
    header.style.marginBottom = "0.4rem";
    wrap.appendChild(header);

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "0.35rem";
    wrap.appendChild(list);

    for (const track of PRELOADED_TRACKS) {
      const btn = document.createElement("button");
      btn.textContent = track.displayName;
      btn.style.textAlign = "left";
      btn.style.padding = "0.55rem 0.75rem";
      btn.style.fontSize = "0.85rem";
      btn.style.cursor = "pointer";
      btn.addEventListener("click", () => {
        this.callbacks?.onLoadUrl(track.url, this.currentOptions());
      });
      list.appendChild(btn);
    }

    return wrap;
  }

  showLoading(phase: string, ratio: number): void {
    this.panel.innerHTML = "";
    const h1 = document.createElement("h1");
    h1.textContent = "ANALYZING";
    const p = document.createElement("p");
    p.textContent = `${phase} — ${Math.round(ratio * 100)}%`;
    this.panel.appendChild(h1);
    this.panel.appendChild(p);

    const bar = document.createElement("div");
    bar.style.height = "8px";
    bar.style.background = "#1a1730";
    bar.style.borderRadius = "4px";
    bar.style.overflow = "hidden";
    const fill = document.createElement("div");
    fill.style.height = "100%";
    fill.style.width = `${Math.round(ratio * 100)}%`;
    fill.style.background = "linear-gradient(90deg, #ff5dc8, #5df0ff)";
    bar.appendChild(fill);
    this.panel.appendChild(bar);
  }

  /** First-run download screen — shown when featured tracks are being
   *  cached for the first time. */
  showFirstRunDownload(current: number, total: number, filename: string, fileProgress: number): void {
    this.panel.innerHTML = "";

    const h1 = document.createElement("h1");
    h1.textContent = "WELCOME";
    this.panel.appendChild(h1);

    const subtitle = document.createElement("p");
    subtitle.style.color = "var(--muted)";
    subtitle.style.marginBottom = "1rem";
    subtitle.textContent = "Downloading featured tracks for offline play…";
    this.panel.appendChild(subtitle);

    const info = document.createElement("p");
    info.style.fontSize = "0.85rem";
    info.style.color = "var(--accent2)";
    info.style.marginBottom = "0.5rem";
    const displayName = filename.replace(/\.mp3$/i, "").replace(/[-_]+/g, " ");
    info.textContent = `(${current + 1}/${total}) ${displayName}`;
    this.panel.appendChild(info);

    const bar = document.createElement("div");
    bar.style.height = "8px";
    bar.style.background = "#1a1730";
    bar.style.borderRadius = "4px";
    bar.style.overflow = "hidden";
    const fill = document.createElement("div");
    fill.style.height = "100%";
    const overallProgress = (current + fileProgress) / total;
    fill.style.width = `${Math.round(overallProgress * 100)}%`;
    fill.style.background = "linear-gradient(90deg, #ff5dc8, #5df0ff)";
    fill.style.transition = "width 100ms ease";
    bar.appendChild(fill);
    this.panel.appendChild(bar);

    const pct = document.createElement("p");
    pct.style.fontSize = "0.75rem";
    pct.style.color = "var(--muted)";
    pct.style.marginTop = "0.5rem";
    pct.style.textAlign = "right";
    pct.textContent = `${Math.round(overallProgress * 100)}%`;
    this.panel.appendChild(pct);
  }

  /**
   * Finishing screen: shown when a song completes (or the player runs
   * out of health). Displays the grade, score, every stat we tracked
   * during the run, and the top runs for this track with the just-
   * finished run highlighted.
   *
   * @param justFinishedAt timestamp (`Date.now()`) of the run that
   *   just ended, used to locate and highlight that entry inside
   *   `highscores`. Pass `null` if no entry was recorded.
   * @param callbacks `onRestart` re-runs the same track + settings.
   *   `onQuitToMenu` tears down the race and returns to the title.
   */
  showResults(
    summary: ScoreSummary,
    highscores: HighscoreEntry[],
    justFinishedAt: number | null,
    callbacks: { onRestart: () => void; onQuitToMenu: () => void },
  ): void {
    this.show();
    this.panel.innerHTML = "";
    this.panel.style.maxHeight = "calc(100vh - 4rem)";
    this.panel.style.overflowY = "auto";

    this.panel.appendChild(this.renderResultsHeader(summary, highscores, justFinishedAt));

    const totalPickups = summary.pickupsHit + summary.pickupsMissed;
    const shieldsUsed = STARTING_SHIELDS - summary.shieldsRemaining;

    this.panel.appendChild(
      renderStatSection("PERFORMANCE", [
        ["Max combo", `x${summary.maxCombo}`],
        ["Cluster bonus", `+${summary.clusterBonus.toLocaleString()}`],
        ["Accuracy", `${Math.round(summary.accuracy * 100)}%`],
      ]),
    );

    this.panel.appendChild(
      renderStatSection("PICKUPS", [
        ["Collected", `${summary.pickupsHit} / ${totalPickups}`],
        ["Missed", String(summary.pickupsMissed)],
      ]),
    );

    this.panel.appendChild(
      renderStatSection("HAZARDS", [
        ["Dodged", String(summary.hazardsDodged)],
        ["Deflected (shield)", String(summary.hazardsDeflected)],
        ["Hit", String(summary.hazardsHit)],
      ]),
    );

    this.panel.appendChild(
      renderStatSection("SURVIVAL", [
        ["Hull integrity", `${Math.round(summary.health * 100)}%`],
        ["Shields used", `${shieldsUsed} / ${STARTING_SHIELDS}`],
      ]),
    );

    if (highscores.length > 0) {
      this.panel.appendChild(renderTopRunsSection(highscores, justFinishedAt));
    }

    const row = document.createElement("div");
    row.className = "row";

    const restartBtn = document.createElement("button");
    restartBtn.textContent = "↻ Restart";
    restartBtn.style.flex = "1";
    restartBtn.style.borderColor = "var(--accent2)";
    restartBtn.style.color = "var(--accent2)";
    restartBtn.addEventListener("click", () => callbacks.onRestart());
    row.appendChild(restartBtn);

    const quitBtn = document.createElement("button");
    quitBtn.textContent = "Pick another track";
    quitBtn.style.flex = "1";
    quitBtn.addEventListener("click", () => {
      callbacks.onQuitToMenu();
      this.renderTitle();
    });
    row.appendChild(quitBtn);

    this.panel.appendChild(row);
  }

  /**
   * Pause overlay: shown when the player pauses mid-race. Displays
   * the current run's live stats and offers Resume / Restart / Quit.
   *
   * @param snapshot live score state as returned by
   *   `GameScene.getScoreSnapshot()`.
   * @param callbacks `onResume` un-pauses and continues the current
   *   race; `onRestart` re-runs the same track + settings; `onQuitToMenu`
   *   tears down the race and returns to the title.
   */
  showPaused(
    snapshot: ScoreSummary,
    callbacks: {
      onResume: () => void;
      onRestart: () => void;
      onQuitToMenu: () => void;
    },
  ): void {
    this.show();
    this.panel.innerHTML = "";
    this.panel.style.maxHeight = "calc(100vh - 4rem)";
    this.panel.style.overflowY = "auto";

    const header = document.createElement("div");
    header.style.textAlign = "center";
    header.style.marginBottom = "1rem";

    const label = document.createElement("div");
    label.textContent = "PAUSED";
    label.style.color = "var(--accent2)";
    label.style.letterSpacing = "0.25em";
    label.style.fontSize = "0.85rem";
    header.appendChild(label);

    const scoreEl = document.createElement("div");
    scoreEl.textContent = snapshot.score.toLocaleString();
    scoreEl.style.fontSize = "2.25rem";
    scoreEl.style.fontWeight = "700";
    scoreEl.style.color = "var(--accent)";
    scoreEl.style.textShadow = "0 0 12px rgba(255, 93, 200, 0.6)";
    scoreEl.style.marginTop = "0.25rem";
    header.appendChild(scoreEl);

    const sub = document.createElement("div");
    sub.textContent = `current grade: ${snapshot.grade}`;
    sub.style.color = "var(--muted)";
    sub.style.fontSize = "0.75rem";
    sub.style.letterSpacing = "0.12em";
    sub.style.marginTop = "0.25rem";
    header.appendChild(sub);

    this.panel.appendChild(header);

    const totalPickups = snapshot.pickupsHit + snapshot.pickupsMissed;
    const shieldsUsed = STARTING_SHIELDS - snapshot.shieldsRemaining;

    this.panel.appendChild(
      renderStatSection("PERFORMANCE", [
        ["Combo", snapshot.combo > 0 ? `x${snapshot.combo}` : "—"],
        ["Max combo", `x${snapshot.maxCombo}`],
        ["Cluster bonus", `+${snapshot.clusterBonus.toLocaleString()}`],
        ["Accuracy", `${Math.round(snapshot.accuracy * 100)}%`],
      ]),
    );

    this.panel.appendChild(
      renderStatSection("PICKUPS", [
        ["Collected", `${snapshot.pickupsHit} / ${totalPickups}`],
        ["Missed", String(snapshot.pickupsMissed)],
      ]),
    );

    this.panel.appendChild(
      renderStatSection("HAZARDS", [
        ["Dodged", String(snapshot.hazardsDodged)],
        ["Deflected (shield)", String(snapshot.hazardsDeflected)],
        ["Hit", String(snapshot.hazardsHit)],
      ]),
    );

    this.panel.appendChild(
      renderStatSection("SURVIVAL", [
        ["Hull integrity", `${Math.round(snapshot.health * 100)}%`],
        ["Shields left", `${snapshot.shieldsRemaining} / ${STARTING_SHIELDS}`],
        ["Shields used", `${shieldsUsed} / ${STARTING_SHIELDS}`],
      ]),
    );

    const row = document.createElement("div");
    row.className = "row";

    const resumeBtn = document.createElement("button");
    resumeBtn.textContent = "▶ Resume";
    resumeBtn.style.flex = "1";
    resumeBtn.style.borderColor = "var(--accent)";
    resumeBtn.style.color = "var(--accent)";
    resumeBtn.addEventListener("click", () => callbacks.onResume());
    row.appendChild(resumeBtn);

    const restartBtn = document.createElement("button");
    restartBtn.textContent = "↻ Restart";
    restartBtn.style.flex = "1";
    restartBtn.style.borderColor = "var(--accent2)";
    restartBtn.style.color = "var(--accent2)";
    restartBtn.addEventListener("click", () => callbacks.onRestart());
    row.appendChild(restartBtn);

    this.panel.appendChild(row);

    const quitRow = document.createElement("div");
    quitRow.className = "row";
    const quitBtn = document.createElement("button");
    quitBtn.textContent = "Quit to menu";
    quitBtn.style.flex = "1";
    quitBtn.addEventListener("click", () => {
      callbacks.onQuitToMenu();
      this.renderTitle();
    });
    quitRow.appendChild(quitBtn);
    this.panel.appendChild(quitRow);

    const hint = document.createElement("p");
    hint.textContent = "Press Esc to resume.";
    hint.style.fontSize = "0.75rem";
    hint.style.color = "var(--muted)";
    hint.style.marginTop = "0.5rem";
    hint.style.textAlign = "center";
    this.panel.appendChild(hint);
  }


  /** Header block: "RACE COMPLETE" label, the player's name (if set),
   *  huge color-coded grade letter, total score, and an optional rank
   *  badge. */
  private renderResultsHeader(
    summary: ScoreSummary,
    highscores: HighscoreEntry[],
    justFinishedAt: number | null,
  ): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.textAlign = "center";
    wrap.style.marginBottom = "1rem";

    const label = document.createElement("div");
    label.textContent = "RACE COMPLETE";
    label.style.color = "var(--muted)";
    label.style.letterSpacing = "0.2em";
    label.style.fontSize = "0.75rem";
    wrap.appendChild(label);

    const justFinished = justFinishedAt != null
      ? highscores.find((e) => e.at === justFinishedAt)
      : undefined;
    const name = justFinished?.name?.trim();
    if (name) {
      const nameEl = document.createElement("div");
      nameEl.textContent = name;
      nameEl.style.color = "var(--accent2)";
      nameEl.style.fontSize = "0.95rem";
      nameEl.style.letterSpacing = "0.12em";
      nameEl.style.marginTop = "0.15rem";
      wrap.appendChild(nameEl);
    }

    const gradeColor = GRADE_COLORS[summary.grade];
    const gradeEl = document.createElement("div");
    gradeEl.textContent = summary.grade;
    gradeEl.style.fontSize = "5rem";
    gradeEl.style.fontWeight = "700";
    gradeEl.style.lineHeight = "1";
    gradeEl.style.margin = "0.25rem 0";
    gradeEl.style.color = gradeColor;
    gradeEl.style.textShadow = `0 0 24px ${gradeColor}`;
    wrap.appendChild(gradeEl);

    const scoreEl = document.createElement("div");
    scoreEl.textContent = summary.score.toLocaleString();
    scoreEl.style.fontSize = "1.75rem";
    scoreEl.style.fontWeight = "700";
    scoreEl.style.color = "var(--accent)";
    scoreEl.style.textShadow = "0 0 12px rgba(255, 93, 200, 0.6)";
    wrap.appendChild(scoreEl);

    const badge = renderRankBadge(highscores, justFinishedAt);
    if (badge) wrap.appendChild(badge);

    return wrap;
  }

}

/** Section block with a `▌ TITLE` header and a list of label/value rows. */
function renderStatSection(title: string, rows: Array<[string, string]>): HTMLDivElement {
  const section = document.createElement("div");
  section.style.marginBottom = "0.85rem";

  const header = document.createElement("div");
  header.textContent = `▌ ${title}`;
  header.style.color = "var(--accent2)";
  header.style.fontSize = "0.7rem";
  header.style.letterSpacing = "0.12em";
  header.style.marginBottom = "0.3rem";
  section.appendChild(header);

  for (const [k, v] of rows) {
    section.appendChild(renderStatRow(k, v));
  }
  return section;
}

function renderStatRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "space-between";
  row.style.padding = "2px 0";
  row.style.fontSize = "0.85rem";
  row.innerHTML =
    `<span style="color:var(--muted)">${label}</span>` +
    `<strong>${value}</strong>`;
  return row;
}

/** Top-5 high scores. The just-finished run (matched by timestamp)
 *  is highlighted with an arrow and accent color. */
function renderTopRunsSection(
  highscores: HighscoreEntry[],
  justFinishedAt: number | null,
): HTMLDivElement {
  const section = document.createElement("div");
  section.style.marginBottom = "0.85rem";

  const header = document.createElement("div");
  header.textContent = "▌ TOP RUNS (this track)";
  header.style.color = "var(--accent2)";
  header.style.fontSize = "0.7rem";
  header.style.letterSpacing = "0.12em";
  header.style.marginBottom = "0.3rem";
  section.appendChild(header);

  const ol = document.createElement("ol");
  ol.style.paddingLeft = "1.4rem";
  ol.style.margin = "0";
  ol.style.fontSize = "0.8rem";
  for (const e of highscores.slice(0, 5)) {
    const li = document.createElement("li");
    const isCurrent = justFinishedAt != null && e.at === justFinishedAt;
    const name = e.name?.trim() || "—";
    li.textContent =
      `${e.score.toLocaleString()} — ${e.grade} (x${e.combo}) · ${name}` +
      (isCurrent ? "  ← YOU" : "");
    li.style.color = isCurrent ? "var(--accent2)" : "var(--muted)";
    if (isCurrent) li.style.fontWeight = "700";
    li.style.padding = "1px 0";
    ol.appendChild(li);
  }
  section.appendChild(ol);
  return section;
}

/** Returns a "NEW BEST" / "RANK #N" badge when the just-finished run
 *  placed in the top 5, otherwise null. */
function renderRankBadge(
  highscores: HighscoreEntry[],
  justFinishedAt: number | null,
): HTMLDivElement | null {
  if (justFinishedAt == null) return null;
  const rank = highscores.findIndex((e) => e.at === justFinishedAt);
  if (rank < 0 || rank >= 5) return null;

  const badge = document.createElement("div");
  badge.style.marginTop = "0.4rem";
  badge.style.letterSpacing = "0.18em";
  badge.style.fontSize = "0.8rem";
  if (rank === 0 && highscores.length > 1) {
    badge.textContent = "★ NEW BEST!";
    badge.style.color = "#fff066";
    badge.style.textShadow = "0 0 8px rgba(255, 240, 102, 0.6)";
  } else {
    badge.textContent = `RANK #${rank + 1}`;
    badge.style.color = "var(--accent2)";
  }
  return badge;
}
