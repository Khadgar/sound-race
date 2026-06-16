import { describe, it, expect } from "vitest";
import {
  createScoreState,
  onHazard,
  onPickup,
  onPickupMiss,
  summarize,
} from "../src/game/score.js";
import { integrateCurvature, sampleSeries } from "../src/game/track.js";

describe("scoring", () => {
  it("increments combo and score on pickup", () => {
    const s = createScoreState();
    onPickup(s, 0);
    onPickup(s, 1);
    expect(s.combo).toBe(2);
    expect(s.score).toBeGreaterThan(0);
    expect(s.maxCombo).toBe(2);
  });

  it("resets combo on miss and hazard", () => {
    const s = createScoreState();
    onPickup(s, 0);
    onPickup(s, 0);
    onPickupMiss(s);
    expect(s.combo).toBe(0);
    expect(s.colorStreak).toBe(0);
    onPickup(s, 0);
    onHazard(s);
    expect(s.combo).toBe(0);
    expect(s.health).toBeLessThan(1);
  });

  it("awards a cluster bonus for 3 same-color in a row", () => {
    const s = createScoreState();
    onPickup(s, 1);
    onPickup(s, 1);
    const scoreBefore = s.score;
    const r = onPickup(s, 1);
    expect(r.cluster).toBe(true);
    expect(r.clusterLen).toBe(3);
    expect(s.score - scoreBefore).toBeGreaterThan(100); // base + cluster bonus
    expect(s.clusterBonus).toBeGreaterThan(0);
  });

  it("breaks color streak on different color", () => {
    const s = createScoreState();
    onPickup(s, 2);
    onPickup(s, 2);
    onPickup(s, 0);
    expect(s.colorStreak).toBe(1);
  });

  it("grades a clean run as S", () => {
    const s = createScoreState();
    for (let i = 0; i < 20; i++) onPickup(s, i % 4);
    const summary = summarize(s);
    expect(summary.grade).toBe("S");
    expect(summary.accuracy).toBe(1);
  });
});

describe("track utilities", () => {
  it("interpolates series samples", () => {
    const arr = new Float32Array([0, 1, 2, 3]);
    expect(sampleSeries(arr, 1, 0)).toBeCloseTo(0);
    expect(sampleSeries(arr, 1, 1.5)).toBeCloseTo(1.5);
    expect(sampleSeries(arr, 1, 10)).toBeCloseTo(3);
    expect(sampleSeries(arr, 1, -5)).toBeCloseTo(0);
  });

  it("integrates curvature into a bounded path", () => {
    const curv = new Float32Array(1000);
    for (let i = 0; i < curv.length; i++) curv[i] = Math.sin(i / 50);
    const path = integrateCurvature(curv, 0.02);
    expect(path.length).toBe(curv.length);
    for (const v of path) expect(Number.isFinite(v)).toBe(true);
  });
});
