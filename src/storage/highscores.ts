/**
 * Local high-score persistence, keyed by audio hash.
 */

const KEY = "sound-race.highscores.v1";
const MAX_PER_TRACK = 10;

export interface HighscoreEntry {
  score: number;
  combo: number;
  accuracy: number;
  grade: string;
  at: number;
  /** Optional player name. Older entries (pre-name feature) will not
   *  have this — renderers should fall back to a placeholder. */
  name?: string;
}

type Store = Record<string, HighscoreEntry[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Store;
    return {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota — ignore */
  }
}

export function getHighscores(trackId: string): HighscoreEntry[] {
  return read()[trackId] ?? [];
}

export function recordHighscore(trackId: string, entry: HighscoreEntry): HighscoreEntry[] {
  const store = read();
  const list = (store[trackId] ?? []).concat(entry);
  list.sort((a, b) => b.score - a.score);
  store[trackId] = list.slice(0, MAX_PER_TRACK);
  write(store);
  return store[trackId]!;
}
