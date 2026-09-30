import type { Effect, Snapshot } from "./types";
import { listenerGain } from "./person-volume";
export class SoundboardAudio {
  private context: AudioContext | null = null;
  private count = 0;
  private personVolumes: Record<string, number> = {};
  private master = 0.7;
  private muted = new Set<string>();
  private active = new Set<{
    sourceId: string;
    distance: number;
    output: GainNode;
  }>();
  setMix(
    master: number,
    personVolumes: Record<string, number>,
    muted: Set<string>,
  ) {
    this.master = master;
    this.personVolumes = personVolumes;
    this.muted = muted;
    for (const sound of this.active) {
      sound.output.gain.value = listenerGain(
        master,
        personVolumes[sound.sourceId] ?? 1,
        sound.distance,
        muted.has(sound.sourceId),
      );
    }
  }
  async unlock() {
    this.context ??= new AudioContext();
    await this.context.resume();
  }
  play(effect: Effect, snapshot: Snapshot, selfId: string) {
    const context = this.context;
    if (
      !context ||
      context.state !== "running" ||
      this.count >= 4 ||
      this.muted.has(effect.sourceId) ||
      this.master <= 0
    )
      return;
    const self = snapshot.players.find((p) => p.id === selfId);
    if (!self) return;
    const distance = Math.hypot(self.x - effect.x, self.y - effect.y);
    const gain = listenerGain(
      this.master,
      this.personVolumes[effect.sourceId] ?? 1,
      distance,
      false,
    );
    if (gain <= 0) return;
    this.count++;
    const tones: Record<string, number[]> = {
      chime: [523, 659, 784],
      pop: [280, 140],
      "ta-da": [392, 494, 587, 784],
      boop: [520, 420],
    };
    const frequencies = tones[effect.assetId] || tones.chime;
    const output = context.createGain();
    output.connect(context.destination);
    const sound = { sourceId: effect.sourceId, distance, output };
    this.active.add(sound);
    const envelope = context.createGain();
    envelope.connect(output);
    const pan = context.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, (effect.x - self.x) / 12));
    pan.connect(envelope);
    const now = context.currentTime;
    output.gain.value = gain;
    envelope.gain.setValueAtTime(1, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    frequencies.forEach((frequency, i) => {
      const tone = context.createOscillator();
      tone.type = effect.assetId === "pop" ? "sine" : "triangle";
      tone.frequency.value = frequency;
      tone.connect(pan);
      tone.start(now + i * 0.09);
      tone.stop(now + 0.65);
      tone.onended = () => tone.disconnect();
    });
    window.setTimeout(() => {
      pan.disconnect();
      envelope.disconnect();
      output.disconnect();
      this.active.delete(sound);
      this.count--;
    }, 800);
  }
  dispose() {
    void this.context?.close();
    this.context = null;
    this.active.clear();
  }
}
