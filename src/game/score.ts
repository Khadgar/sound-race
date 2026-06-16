/**
 * Score / combo tracking, color-cluster bonuses, and end-of-song summary.
 *
 * Audiosurf-style: collecting same-colored blocks in a row builds a cluster.
 * Each cluster of 3 or more awards a bonus proportional to its size.
 */

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  pickupsHit: number;
  pickupsMissed: number;
  hazardsHit: number;
  hazardsDodged: number;
  hazardsDeflected: number;
  health: number;
  /** Last collected color index (-1 = none). */
  lastColor: number;
  /** Current run-length of same-color collections. */
  colorStreak: number;
  /** Total cluster bonuses awarded so far. */
  clusterBonus: number;
  /** Last collected colors, newest at the end (max QUEUE_LEN). */
  recentColors: number[];
  /** Number of shield charges left (consumed on activation). */
  shieldsRemaining: number;
}

export interface ScoreSummary extends ScoreState {
  accuracy: number;
  grade: "S" | "A" | "B" | "C" | "D";
}

const PICKUP_BASE = 100;
const HAZARD_PENALTY = 0.18;
const QUEUE_LEN = 9;
const CLUSTER_MIN = 3;
/** Number of shields the player starts each race with. */
export const STARTING_SHIELDS = 3;

export function createScoreState(): ScoreState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    pickupsHit: 0,
    pickupsMissed: 0,
    hazardsHit: 0,
    hazardsDodged: 0,
    hazardsDeflected: 0,
    health: 1,
    lastColor: -1,
    colorStreak: 0,
    clusterBonus: 0,
    recentColors: [],
    shieldsRemaining: STARTING_SHIELDS,
  };
}

export interface PickupResult {
  /** True if this pickup just completed (or extended) a cluster bonus. */
  cluster: boolean;
  /** Current cluster length after this pickup (only meaningful if cluster=true). */
  clusterLen: number;
}

export function onPickup(state: ScoreState, color: number): PickupResult {
  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  state.pickupsHit += 1;

  if (color === state.lastColor) state.colorStreak += 1;
  else state.colorStreak = 1;
  state.lastColor = color;

  state.recentColors.push(color);
  if (state.recentColors.length > QUEUE_LEN) state.recentColors.shift();

  const base = PICKUP_BASE * Math.min(8, 1 + Math.floor(state.combo / 4));
  state.score += base;

  let cluster = false;
  if (state.colorStreak >= CLUSTER_MIN) {
    const bonus = 200 * state.colorStreak;
    state.score += bonus;
    state.clusterBonus += bonus;
    cluster = true;
  }
  return { cluster, clusterLen: state.colorStreak };
}

export function onPickupMiss(state: ScoreState): void {
  state.combo = 0;
  state.colorStreak = 0;
  state.lastColor = -1;
  state.pickupsMissed += 1;
}

export function onHazard(state: ScoreState): void {
  state.combo = 0;
  state.colorStreak = 0;
  state.lastColor = -1;
  state.hazardsHit += 1;
  state.health = Math.max(0, state.health - HAZARD_PENALTY);
}

export function onHazardDodged(state: ScoreState): void {
  state.hazardsDodged += 1;
}

/** Hazard blocked by an active shield — no health damage and no combo
 *  break. Tracked for the post-race summary. */
export function onHazardDeflected(state: ScoreState): void {
  state.hazardsDeflected += 1;
}

/** Consume one shield charge. Returns true if a charge was available. */
export function consumeShield(state: ScoreState): boolean {
  if (state.shieldsRemaining <= 0) return false;
  state.shieldsRemaining -= 1;
  return true;
}

export function summarize(state: ScoreState): ScoreSummary {
  const totalPickups = state.pickupsHit + state.pickupsMissed;
  const accuracy = totalPickups === 0 ? 0 : state.pickupsHit / totalPickups;
  let grade: ScoreSummary["grade"] = "D";
  if (accuracy >= 0.95 && state.health > 0.5) grade = "S";
  else if (accuracy >= 0.85) grade = "A";
  else if (accuracy >= 0.7) grade = "B";
  else if (accuracy >= 0.5) grade = "C";
  return { ...state, accuracy, grade };
}
