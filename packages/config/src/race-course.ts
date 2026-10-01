import type { Checkpoint, Rect } from './index';

export type RacePickupKind = 'speed' | 'jump';
export interface RacePickup { id: string; kind: RacePickupKind; x: number; y: number; }
/** Fixed map shared by authority/prediction; pickups belong to each racer. */
export const RACE_BOOST = Object.freeze({
  speedMultiplier: 1.25,
  jumpMultiplier: 1.18,
  durationSeconds: 4.5,
  maxSeconds: 6,
  pickupRadius: .65,
});
export const RACE_STAGES = [
  { x: 0, name: 'Garden warm-up', difficulty: 1, blockHeight: 1, hazardWidth: 1, gapWidth: 0 },
  { x: 90, name: 'Creek hop', difficulty: 2, blockHeight: 1.1, hazardWidth: 1.15, gapWidth: 1.2 },
  { x: 180, name: 'Stone steps', difficulty: 3, blockHeight: 1.2, hazardWidth: 1.3, gapWidth: 1.5 },
  { x: 270, name: 'Bramble sprint', difficulty: 4, blockHeight: 1.3, hazardWidth: 1.45, gapWidth: 1.8 },
] as const;
// Gaps are separated from spikes and blocks; checkpoints always have safe ground.
const gaps = RACE_STAGES.filter(s => s.gapWidth).map(s => ({ x: s.x + 78, width: s.gapWidth }));
const ground: Rect[] = [];
let cursor = 0;
for (const gap of gaps) {
  ground.push({ x: cursor, y: 16, width: gap.x - cursor, height: 2 });
  cursor = gap.x + gap.width;
}
ground.push({ x: cursor, y: 16, width: 360 - cursor, height: 2 });
export const RACE_MAP = {
  id: 'garden-dash-v3', width: 360, height: 18, spawn: { x: 2, y: 15.7 },
  stages: RACE_STAGES,
  gaps,
  platforms: [
    ...ground,
    ...RACE_STAGES.flatMap(s => [13, 29, 46, 64].map(x => ({
      x: s.x + x, y: 16 - s.blockHeight, width: 2 - (s.difficulty - 1) * .15, height: s.blockHeight,
    }))),
  ] satisfies Rect[],
  hazards: RACE_STAGES.flatMap(s => [9, 24, 40, 58, 71].map((x, i) => ({
    x: s.x + x, y: 15.4 - (s.difficulty - 1) * .025,
    width: s.hazardWidth + Math.min(i, 2) * .1, height: .6 + (s.difficulty - 1) * .025,
  }))) satisfies Rect[],
  pickups: RACE_STAGES.flatMap((s, i) => [
    { id: `speed-${i}`, kind: 'speed' as const, x: s.x + 5, y: 15.4 },
    { id: `jump-${i}`, kind: 'jump' as const, x: s.x + 34, y: 15.4 },
  ]) satisfies RacePickup[],
  checkpoints: [83, 173, 263, 350].map((x, i) => ({
    id: `checkpoint-${i + 1}`, x, y: 0, width: 1, height: 16, spawn: { x: x + 1.5, y: 15.7 },
  })) satisfies Checkpoint[],
  finish: { id: 'finish', x: 357, y: 0, width: 2, height: 16 },
} as const;
