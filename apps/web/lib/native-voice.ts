import { Room, RoomEvent, Track, createLocalAudioTrack, type LocalAudioTrack, type RemoteAudioTrack, type RemoteParticipant } from "livekit-client";
import type { NativeMode, VoiceSettings, VoiceState, VoiceToken } from "@third-space/contracts";

export type VoicePhase = "off" | "permission" | "connecting" | "connected" | "reconnecting" | "error";
export interface VoiceUIState { phase: VoicePhase; microphone: "off" | "pending" | "live" | "muted"; playbackBlocked: boolean; error: string; devices: MediaDeviceInfo[] }
export function micError(error: unknown): string {
  switch ((error as { name?: string })?.name) {
    case "NotAllowedError": case "SecurityError": return "Microphone permission was denied. Allow it for this site, then choose Enable microphone again.";
    case "NotFoundError": case "DevicesNotFoundError": return "No microphone is available. Connect one, then try again.";
    case "NotReadableError": case "TrackStartError": return "This microphone is busy or unavailable. Check another app or choose another device.";
    default: return "Voice could not connect. Check your connection and try again.";
  }
}
export interface VoiceDependencies {
  createRoom(): Room;
  capture(deviceId?: string): Promise<LocalAudioTrack>;
  devices(): Promise<MediaDeviceInfo[]>;
}
const defaults: VoiceDependencies = {
  createRoom: () => new Room({ disconnectOnPageLeave: true, publishDefaults: { audioPreset: { maxBitrate: 24000 }, dtx: true, red: true } }),
  capture: deviceId => createLocalAudioTrack({ deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
  // Listing never opens a capture stream. Labels remain private until browser consent.
  devices: async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"),
};
/** Independent from Phaser and game/media audio. No hidden-tab mute policy. */
export class NativeVoice {
  private generation = 0;
  private room: Room | null = null;
  private microphone: LocalAudioTrack | null = null;
  private tracks = new Map<string, { track: RemoteAudioTrack; element: HTMLAudioElement; userId: string }>();
  private state: VoiceState | null = null;
  private settings: VoiceSettings = { nativeMode: "off", manualMute: false, deafened: false };
  private master = .8;
  private volumes: Record<string, number> = {};
  private muted = new Set<string>();
  private seenStateAt = 0;
  private lastError = "";
  private microphoneStatus: VoiceUIState["microphone"] = "off";
  private phase: VoicePhase = "off";
  private deviceList: MediaDeviceInfo[] = [];
  private playbackBlocked = false;
  constructor(private token: () => Promise<VoiceToken>, private changed: (state: VoiceUIState) => void,
    private deps: VoiceDependencies = defaults, private acknowledge: (identity: string, version: number) => void = () => {}) {}
  private emit() { this.changed({ phase: this.phase, microphone: this.microphoneStatus, error: this.lastError, playbackBlocked: this.playbackBlocked, devices: this.deviceList }); }
  async refreshDevices() {
    try { this.deviceList = await this.deps.devices(); this.emit(); } catch { /* Device labels/list may be restricted. */ }
  }
  /** Must be called directly from Enable/Retry click; capture precedes token/network awaits. */
  async start(mode: Exclude<NativeMode, "off">, deviceId?: string) {
    this.stop(); const generation = this.generation;
    this.settings = { ...this.settings, nativeMode: mode };
    this.phase = mode === "enabled" ? "permission" : "connecting";
    this.microphoneStatus = mode === "enabled" ? "pending" : "off"; this.lastError = ""; this.emit();
    try {
      if (mode === "enabled") {
        const track = await this.deps.capture(deviceId);
        if (generation !== this.generation) { track.stop(); return; }
        this.microphone = track;
        // If hardware is unplugged, stop capture and require a fresh user gesture.
        track.mediaStreamTrack.addEventListener("ended", () => { if (this.microphone === track) this.fail("Microphone disconnected. Choose a device and enable it again."); }, { once: true });
        this.microphoneStatus = "muted";
        await track.mute();
        if (generation !== this.generation) return;
        void this.refreshDevices();
      }
      this.phase = "connecting"; this.emit();
      const grant = await this.token();
      if (generation !== this.generation) return;
      const room = this.deps.createRoom(); this.room = room;
      room.on(RoomEvent.TrackPublished, () => this.applySubscriptions());
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (this.room !== room || track.kind !== Track.Kind.Audio || (this.tracks.size >= 7 && !this.tracks.has(participant.identity))) return;
        this.attach(track as RemoteAudioTrack, participant);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        if (this.tracks.get(participant.identity)?.track === track) this.detach(participant.identity);
      });
      room.on(RoomEvent.ParticipantDisconnected, participant => this.detach(participant.identity));
      room.on(RoomEvent.Reconnecting, () => { if (this.room === room) { this.phase = "reconnecting"; this.denyPublishing(); this.silence(); this.emit(); } });
      room.on(RoomEvent.Reconnected, () => { if (this.room === room) { this.phase = "connected"; this.applyPolicy(); this.mix(); this.emit(); } });
      room.on(RoomEvent.Disconnected, () => { if (this.room === room) this.fail("Voice disconnected. Choose Listen or Enable microphone to reconnect."); });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (this.room === room) { this.playbackBlocked = !room.canPlaybackAudio; this.emit(); } });
      await room.connect(grant.url, grant.token, { autoSubscribe: false });
      if (generation !== this.generation || this.room !== room) { void room.disconnect(); return; }
      room.localParticipant.setTrackSubscriptionPermissions(false, []);
      this.applyPolicy();
      if (this.microphone) {
        // Publishing starts only after backend receives the connected ACL acknowledgement.
        const deadline = Date.now() + 8000;
        while (!room.localParticipant.permissions?.canPublish && generation === this.generation && Date.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 50));
        if (generation !== this.generation) return;
        if (!room.localParticipant.permissions?.canPublish) throw new Error("Voice publishing authorization timed out.");
        await room.localParticipant.publishTrack(this.microphone, { source: Track.Source.Microphone });
        if (generation !== this.generation) return;
        this.applyMicrophone();
      }
      this.phase = "connected"; this.mix(); this.emit();
    } catch (error) { if (generation === this.generation) this.fail(micError(error)); }
  }
  private fail(message: string) { this.stop(); this.phase = "error"; this.lastError = message; this.emit(); }
  updateState(state: VoiceState) {
    if (this.state?.identity === state.identity && state.policyVersion < this.state.policyVersion) return;
    this.state = state; this.seenStateAt = Date.now();
    if (!state.available && this.phase !== "off" && this.phase !== "error") { this.fail(state.reason ?? "Voice is unavailable."); return; }
    this.applyPolicy();
    if (this.phase === "connected") this.applyMicrophone();
    this.mix();
  }
  private applyPolicy() {
    const room = this.room, state = this.state;
    if (!room || room.state !== "connected" || !state || !state.available ||
        state.identity !== room.localParticipant.identity || !state.policyVersion || Date.now() - this.seenStateAt >= 2000) {
      room?.localParticipant.setTrackSubscriptionPermissions(false, []); return;
    }
    room.localParticipant.setTrackSubscriptionPermissions(false,
      state.publishTo.slice(0, 7).map(participantIdentity => ({ participantIdentity, allowAll: true })));
    this.acknowledge(state.identity, state.policyVersion);
    this.applySubscriptions();
  }
  private applySubscriptions() {
    const allowed = new Set(this.state?.receive.map(p => p.identity) ?? []);
    for (const peer of this.room?.remoteParticipants.values() ?? [])
      for (const publication of peer.trackPublications.values())
        publication.setSubscribed(!this.settings.deafened && allowed.has(peer.identity) && publication.kind === Track.Kind.Audio);
  }
  private denyPublishing() {
    this.room?.localParticipant.setTrackSubscriptionPermissions(false, []);
    if (this.microphone) { void this.microphone.mute(); this.microphoneStatus = "muted"; }
  }
  setSettings(settings: VoiceSettings) {
    this.settings = settings;
    if (settings.nativeMode === "off") { this.stop(); return; }
    this.applyMicrophone(); this.mix(); this.emit();
  }
  private applyMicrophone() {
    const track = this.microphone; if (!track) return;
    const muted = this.settings.manualMute || this.settings.deafened || this.settings.nativeMode !== "enabled";
    this.microphoneStatus = muted ? "muted" : "live";
    void (muted ? track.mute() : track.unmute()).catch(() => this.fail("Microphone could not resume. Enable it again."));
  }
  setMix(master: number, volumes: Record<string, number>, muted: Set<string>) {
    this.master = Math.max(0, Math.min(1, master)); this.volumes = volumes; this.muted = muted; this.mix();
  }
  private attach(track: RemoteAudioTrack, participant: RemoteParticipant) {
    this.detach(participant.identity);
    const entry = this.state?.receive.find(p => p.identity === participant.identity);
    // Attach muted before inserting into DOM; late state can never cause a loud first frame.
    track.setVolume(0); const element = track.attach(); element.volume = 0; track.setVolume(0); element.autoplay = true;
    element.setAttribute("playsinline", ""); element.hidden = true;
    document.body.append(element);
    this.tracks.set(participant.identity, { track, element, userId: entry?.id ?? "" }); this.mix();
  }
  private detach(identity: string) { const item = this.tracks.get(identity); if (!item) return; item.track.setVolume(0); item.track.detach(item.element); item.element.srcObject = null; item.element.remove(); this.tracks.delete(identity); }
  private silence() { for (const item of this.tracks.values()) item.track.setVolume(0); }
  /** Called by a 500ms timer, including when rendering sleeps. */
  checkFreshness(now = Date.now()) { if (now - this.seenStateAt >= 2000) { this.silence(); this.denyPublishing(); this.emit(); } }
  private mix() {
    for (const [identity, item] of this.tracks) {
      const peer = this.state?.receive.find(p => p.identity === identity); item.userId = peer?.id ?? "";
      const allowed = this.phase === "connected" && !this.settings.deafened && this.state?.available && Date.now() - this.seenStateAt < 2000 && peer;
      const volume = allowed && !this.muted.has(peer.id) ? peer.gain * this.master * Math.max(0, Math.min(1, this.volumes[peer.id] ?? 1)) : 0;
      item.track.setVolume(volume);
    }
  }
  async resumePlayback() { try { await this.room?.startAudio(); this.playbackBlocked = false; this.emit(); } catch { this.playbackBlocked = true; this.emit(); } }
  /** Leave/room switch/socket drop invalidates pending permission, token and connect work. */
  stop() {
    this.generation++; const room = this.room; this.room = null;
    if (this.microphone) { this.microphone.stop(); this.microphone = null; }
    for (const identity of this.tracks.keys()) this.detach(identity);
    if (room) { room.removeAllListeners(); void room.disconnect(); }
    this.state = null; this.phase = "off"; this.microphoneStatus = "off"; this.playbackBlocked = false; this.emit();
  }
}
