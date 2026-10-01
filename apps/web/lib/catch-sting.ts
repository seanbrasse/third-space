import type { WorldSoundEvent } from "@third-space/contracts";
export type CatchStingKind = "clown-scare" | "werewolf-scare";
/** A live victim event supplies the accent; snapshots and old/reconnected catches never do. */
export function catchStingKind(event: WorldSoundEvent, selfId: string, serverTime: number, reducedMotion: boolean): CatchStingKind | null {
  const age = serverTime - event.createdAt;
  if (reducedMotion || event.victimId !== selfId || age > 350 || age < -1000) return null;
  return event.kind === "slash" ? "clown-scare" : event.kind === "claw" ? "werewolf-scare" : null;
}
/** Original 320ms accent, five-millisecond attack and smooth release, hard sample bound .55. */
export function catchStingSamples(kind: CatchStingKind, sampleRate: number): Float32Array {
  const seconds = .32, data = new Float32Array(Math.ceil(sampleRate * seconds));
  let phase = 0, seed = kind === "clown-scare" ? 47 : 83, brown = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1; brown = (brown + noise * .15) / 1.15;
    const wolf = kind === "werewolf-scare";
    phase += 2 * Math.PI * (wolf ? 180 - 90 * t / seconds : 1100 - 800 * t / seconds) / sampleRate;
    const attack = Math.min(1, t / .005), tail = Math.min(1, (data.length - 1 - i) / (sampleRate * .055));
    const envelope = attack * Math.max(0, tail) ** 2 * Math.exp(-t * 9);
    data[i] = envelope * (Math.sin(phase) * .28 + Math.sin(phase * (wolf ? 1.48 : 1.414)) * .12 + (wolf ? brown : noise) * .15);
  }
  data[0]=0;data[data.length-1]=0;
  return data;
}
