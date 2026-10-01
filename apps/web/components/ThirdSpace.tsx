"use client";
import ChatTimestamp from "./ChatTimestamp";
import LiveSessions from "./LiveSessions";
import SessionInfo from "./SessionInfo";
import { rememberSessionPin, sessionPinStorage } from "../lib/session-pin";
import { parseRoomInvite } from "../lib/room-invite";
import WorldMap from "./WorldMap";
import { usePanelGameFocus } from "../lib/use-panel-game-focus";
import IdlePresence, { useIdleActivity } from "./IdlePresence";
import StaminaBar from "./StaminaBar";
import { canTouchBoost, queueTouchBoost } from "../lib/touch-boost";
import { gameHotkey, isEditingTarget, shouldOpenChat } from "../lib/game-keyboard";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Client, type Room } from "@colyseus/sdk";
import { HOME_MAP, GAME_CONFIG, getWorld } from "@third-space/config";
import { DEFAULT_AVATAR, EMOTE_IDS, SOUND_IDS } from "@third-space/contracts";
import {
  api,
  ApiError,
  type Avatar,
  type Identity,
  type Home,
  type Snapshot,
  type Message,
  type Note,
  type Effect,
  type WorldBridge,
} from "../lib/types";
import { SoundboardAudio } from "../lib/audio";
import { readPersonVolumes } from "../lib/person-volume";
import { browserStorage, readCustomization, saveCustomization, readVisits, recordVisit, uniqueHomes, suggestCampsiteName, type HomeVisit } from "../lib/local-persistence";
import PersonVolume from "./PersonVolume";
import WorldMenu from "./WorldMenu";
import DeathVeil from "./DeathVeil";
import ConnectionHealth from "./ConnectionHealth";
import SharedWatching from "./SharedWatching";
import { AvatarCustomizer } from "./AvatarPreview";
const World = dynamic(() => import("./World"), {
  ssr: false,
  loading: () => (
    <div className="world-loading">
      <span className="loading-spinner" aria-hidden="true"/> Making room for you…
    </div>
  ),
});
type Modal =
  | "board"
  | "portal"
  | "race-entry"
  | "settings"
  | "emotes"
  | "sound"
  | "person"
  | "people"
  | "host"
  | "tv"
  | null;
type Prefs = {
  theme:"light"|"dark";
  panel: boolean;
  bubbles: boolean;
  reducedMotion: boolean;
  soundVolume: number;
  effectsVolume: number;
  gameSoundsMuted: boolean;
  textMuted: string[];
  soundMuted: string[];
  personVolumes: Record<string, number>;
  announce: boolean;
};
const initialPrefs: Prefs = {
  theme:"dark",
  panel: true,
  bubbles: true,
  reducedMotion: false,
  soundVolume: 0.7,
  effectsVolume: 0.5,
  gameSoundsMuted: false,
  textMuted: [],
  soundMuted: [],
  personVolumes: {},
  announce: false,
};
function initials(name: string) {
  return name.slice(0, 1).toUpperCase();
}
function time(ms: number | null | undefined) {
  return ms == null ? "—" : `${(ms / 1000).toFixed(2)}s`;
}
function id() {
  return crypto.randomUUID();
}
export default function ThirdSpace() {
  const [identity, setIdentity] = useState<Identity | null>(null),
    [homes, setHomes] = useState<Home[]>([]),
    [visits, setVisits] = useState<HomeVisit[]>([]),
    [home, setHome] = useState<Home | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [connection, setConnection] = useState("Loading your profile"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<Modal>(null),
    [name, setName] = useState(""),
    [avatar, setAvatar] = useState<Avatar>(DEFAULT_AVATAR),
    [homeName, setHomeName] = useState("Ember Hollow"),
    [pin, setPin] = useState(""),
    [joinId, setJoinId] = useState(""),
    [entryMode, setEntryMode] = useState<"create" | "join">("create"),
    [prefs, setPrefs] = useState<Prefs>(initialPrefs),
    [prefsLoaded, setPrefsLoaded] = useState(false),
    [chatOpen, setChatOpen] = useState(true),
    [watchExpanded,setWatchExpanded]=useState(false),
    [peopleOpen, setPeopleOpen] = useState(false),
    [selectedPersonId, setSelectedPersonId] = useState(""),
    [draft, setDraft] = useState(""),
    [unread, setUnread] = useState(0),
    [pending, setPending] = useState<
      { commandId: string; text: string; failed: boolean }[]
    >([]),
    [notes, setNotes] = useState<Note[]>([]),
    [noteDraft, setNoteDraft] = useState(""),
    [noteLink, setNoteLink] = useState(""),
    [editing, setEditing] = useState<Note | null>(null),
    [conflict, setConflict] = useState<Note | null>(null),
    [target, setTarget] = useState(""),
    [toast, setToast] = useState(""),
    [voiceReason, setVoiceReason] = useState("Checking native voice service…"),
    [proposal, setProposal] = useState<Effect | null>(null),
    [invites, setInvites] = useState<{ id: string; url?: string }[]>([]),
    [inviteUrl, setInviteUrl] = useState(""),
    [replaceHome, setReplaceHome] = useState<Home | null>(null);
  const room = useRef<Room | null>(null),
    chatInput = useRef<HTMLInputElement>(null),
    bridgeRef = useRef<WorldBridge | null>(null),
    prefsRef = useRef(prefs),
    homeRef = useRef(home),
    identityRef = useRef(identity),
    chatOpenRef = useRef(chatOpen),
    seenChat = useRef(new Set<string>()),
    audio = useRef<SoundboardAudio | null>(null),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    lastInstance = useRef(""),
    leaving = useRef(false),
    pendingJoinInvite = useRef(false),
    inviteToken = useRef(""),
    snapshotUiAt = useRef(0),
    mounted = useRef(false),
    recovering = useRef(false),
    connectGeneration = useRef(0),
    savedSession = useRef("");
  const visitsRef = useRef<HomeVisit[]>([]), suggestedNameAssigned = useRef(false);
  usePanelGameFocus(!!modal, ".modal-backdrop");
  usePanelGameFocus(chatOpen && prefs.panel, ".chat-panel", ".chat-panel .chat-heading");
  function changeAvatar(selected: Avatar) {
    setAvatar(selected);
    saveCustomization(browserStorage(), identityRef.current?.id ?? null, selected);
  }
  function remember(targetHome: Home, connected: Room) {
    const userId=identityRef.current?.id;if(!userId||leaving.current||!mounted.current)return;
    const value=JSON.stringify({homeId:targetHome.id,userId,token:connected.reconnectionToken});
    if(value===savedSession.current)return;
    try{sessionStorage.setItem("third-space.session",value);savedSession.current=value;}catch{}
  }
  function forgetSession(){try{sessionStorage.removeItem("third-space.session");}catch{}savedSession.current="";}
  async function recover(targetHome: Home, token?: string) {
    if(recovering.current||leaving.current||!mounted.current)return;
    recovering.current=true;if(bridgeRef.current)bridgeRef.current.transportConnected=false;setHome(targetHome);
    if(!token){try{const previous=JSON.parse(sessionStorage.getItem("third-space.session")||"null");if(previous?.homeId===targetHome.id&&previous.userId===identityRef.current?.id)token=previous.token;}catch{}}
    try{
      for(let attempt=0;attempt<6&&mounted.current&&!leaving.current;attempt++){
        try{
          setConnection("Reconnecting…");
          if(token){const expectedGeneration=connectGeneration.current+1;try{await connect(targetHome,false,token,true);return;}catch{if(!mounted.current||leaving.current||connectGeneration.current!==expectedGeneration)return;}}
          if(!mounted.current||leaving.current)return;
          await connect(targetHome,false,undefined,true);return;
        }catch(e){
          if(!mounted.current||leaving.current)return;
          const message=(e as Error).message;
          if(/ACCESS_DENIED|UNAUTHENTICATED|access denied|access.*ended|403/i.test(message)){
            forgetSession();setHome(null);setSnapshot(null);setConnection("Ready to enter");setError("Your access to this room has ended.");return;
          }
          if(/SESSION_ACTIVE|active session/.test(message)){
            if(token&&attempt<3){await new Promise(resolve=>setTimeout(resolve,300));continue;}
            setReplaceHome(targetHome);setConnection("Session active in another tab");notify("Your room is open in another tab. You can explicitly move it here.");return;
          }
          setConnection("Reconnecting…");
          await new Promise(resolve=>setTimeout(resolve,Math.min(4000,500*2**attempt)));
        }
      }
      if(mounted.current&&!leaving.current){setConnection("Disconnected");notify("Your room is saved. Check your connection, then tap Rejoin.");}
    }finally{recovering.current=false;}
  }
  const notify = useCallback((text: string) => {
    setToast(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const send = useCallback((command: Record<string, unknown>) => {
    if (room.current) room.current.send("command", command.type==="input"?{...command,worldRevision:bridgeRef.current?.snapshot?.worldRevision,zoneRevision:bridgeRef.current?.snapshot?.players.find(p=>p.id===identityRef.current?.id)?.zoneRevision??0}:command);
  }, []);
  if (!bridgeRef.current)
    bridgeRef.current = {
      snapshot: null,
      selfId: "",
      blocked: false,
      transportConnected: false,
      touch: { axisX: 0, axisY: 0, jump: false },
      bubbles: true,
      mutedText: new Set(),
      reducedMotion: false,
      effects: [],
      liveBubbleIds: new Set(),
      send,
      interact: () => {},
      selectPerson: () => {},
    };
  useEffect(() => {
    if (!home || connection !== "Connected") return;
    const resume = () => { void audio.current?.resumeAfterGesture().catch(() => {}); };
    window.addEventListener("pointerdown", resume, { capture: true, passive: true });
    window.addEventListener("keydown", resume, true);
    return () => { window.removeEventListener("pointerdown", resume, true); window.removeEventListener("keydown", resume, true); };
  }, [home, connection]);
  const bridge = bridgeRef.current;
  useIdleActivity(send, !!home && connection === "Connected");
  if (!room.current) bridge.snapshot = snapshot;
  bridge.selfId = identity?.id || "";
  bridge.transportConnected = connection === "Connected";
  bridge.blocked = modal !== null || connection !== "Connected";
  bridge.bubbles = prefs.bubbles;
  bridge.mutedText = new Set(prefs.textMuted);
  bridge.reducedMotion = prefs.reducedMotion;
  bridge.interact = (object) => {
    if(object==="enter-asylum"||object==="exit-asylum"){send({type:"area.enter",area:object==="enter-asylum"?"asylum":"forest"});return;}
    if(object==="race-house"){setModal("race-entry");return;}
    if(object==="tv"){setWatchExpanded(true);return;}
    if(object==="campfire"){send({type:"roast",enabled:true});return;}
    if (object.startsWith("seat:")) {
      send({ type: "seat", seatId: object.split(":")[1] });
      return;
    }
    setModal(object === "seat" ? "people" : (object as Modal));
  };
  bridge.selectPerson = (personId) => {
    setSelectedPersonId(personId);
    setModal("person");
  };
  prefsRef.current = prefs;
  homeRef.current = home;
  identityRef.current = identity;
  chatOpenRef.current = chatOpen;
  useEffect(() => {
    mounted.current=true;leaving.current=false;
    let disposed=false;
    if (!suggestedNameAssigned.current) {
      suggestedNameAssigned.current = true;
      setHomeName(suggestCampsiteName(browserStorage()));
    }
    audio.current = new SoundboardAudio();
    const suspend=()=>{leaving.current=true;connectGeneration.current++;if(room.current){room.current.reconnection.enabled=false;room.current.connection.close(1000);}};
    const online=()=>{const current=homeRef.current;if(current&&!leaving.current&&!room.current)void recover(current);};
    window.addEventListener("pagehide",suspend);window.addEventListener("online",online);
    const fragment = new URLSearchParams(location.hash.slice(1));
    const receivedInvite = parseRoomInvite(location.hash);
    if (fragment.has("pin") || fragment.has("invite")) {
      pendingJoinInvite.current = true;
      history.replaceState(null, "", location.pathname + location.search);
      if (!receivedInvite) setError("This invite link is incomplete or invalid. Ask your friend for a new link.");
    }
    if (receivedInvite) {
      pendingJoinInvite.current = true;
      inviteToken.current = receivedInvite.inviteToken || "";
      setJoinId(receivedInvite.home);
      setPin(receivedInvite.pin || "");
      setEntryMode("join");
    }
    try {
      const saved = localStorage.getItem("third-space.preferences");
      if (saved) {
        const stored = JSON.parse(saved);
        setPrefs({
          ...initialPrefs,
          ...stored,
          personVolumes: readPersonVolumes(stored?.personVolumes),
        });
      }
    } catch {}
    setPrefsLoaded(true);
    void Promise.all([
      api<{ profile: Identity | null }>("/identity").catch(() => ({
        profile: null,
      })),
      api<{ homes: Home[] }>("/homes").catch((e) => {
        if (e instanceof ApiError && e.code === "UNAUTHENTICATED")
          return { homes: [] };
        throw e;
      }),
      api<{ configured: boolean; reason: string }>("/media/status"),
    ])
      .then(async ([profile, rooms, media]) => {
        if(disposed)return;
        setIdentity(profile.profile);
        identityRef.current = profile.profile;
        if (profile.profile) {
          setName(profile.profile.name);
          const restored = readCustomization(browserStorage(), profile.profile.id, profile.profile.avatar);
          setAvatar(restored);
          saveCustomization(browserStorage(), profile.profile.id, restored);
          visitsRef.current = readVisits(browserStorage(), profile.profile.id);
          setVisits(visitsRef.current);
        } else {
          setAvatar(readCustomization(browserStorage(), null));
        }
        setHomes(uniqueHomes(rooms.homes || []));
        setVoiceReason(
          media.reason ||
            "Native voice needs a configured, verified media service.",
        );
        setConnection("Ready to enter");
        if(!pendingJoinInvite.current&&!inviteToken.current&&profile.profile){
          try{const previous=JSON.parse(sessionStorage.getItem("third-space.session")||"null");
            const target=rooms.homes.find(h=>h.id===previous?.homeId);
            if(target&&previous.userId===profile.profile.id){identityRef.current=profile.profile;await recover(target,typeof previous.token==="string"?previous.token:undefined);}
            else if(previous)forgetSession();
          }catch{}
        }
      })
      .catch((e) => {
        if(disposed)return;
        setError(e.message);
        setConnection("Server unavailable");
      });
    return () => {
      disposed=true;mounted.current=false;suspend();
      window.removeEventListener("pagehide",suspend);window.removeEventListener("online",online);
      audio.current?.dispose();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);
  useEffect(() => {
    audio.current?.setMix(
      prefs.gameSoundsMuted ? 0 : prefs.soundVolume,
      prefs.personVolumes,
      new Set(prefs.soundMuted),
      prefs.gameSoundsMuted,
    );
    if (prefsLoaded) {
      try { localStorage.setItem("third-space.preferences", JSON.stringify(prefs)); } catch {}
    }
  }, [prefs, prefsLoaded]);
  useEffect(() => {
    if (!home) return;
    const onKey = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      const typing = isEditingTarget(element);
      if (gameHotkey(event, bridge.blocked || !!modal || connection !== "Connected") === "flashlight") {
        const self = bridge.snapshot?.players.find(player => player.id === bridge.selfId);
        if (self?.connected && self.mode === "home" && !self.respawnAt) {
          event.preventDefault();
          send({ type: "flashlight", enabled: !self.flashlightOn });
        }
        return;
      }
      if (event.key === "Escape") {
        if (modal) setModal(null);
        else if (typing && element.closest(".chat-panel")) setChatOpen(false);
        else if (typing) element.blur();
        return;
      }
      if (prefs.panel && shouldOpenChat(event, !!modal || connection !== "Connected")) {
        event.preventDefault();
        setChatOpen(true);
        setTimeout(() => chatInput.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    const reset = () => {
      bridge.touch = { axisX: 0, axisY: 0, jump: false };
      bridge.blocked = true;
      send({type:"input.stop"});
    };
    const focus = () => { bridge.blocked = !!modal || connection !== "Connected"; };
    window.addEventListener("focus", focus);
    window.addEventListener("blur", reset);
    window.addEventListener("orientationchange", reset);
    const visibility = () => {
      reset();
      if (document.hidden) setConnection("Session paused · tab in background");
      else if (room.current) setConnection("Connected");
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", reset);
      window.removeEventListener("orientationchange", reset);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [home, modal, connection, prefs.panel, bridge, send]);
  useEffect(() => {
    if (modal === "board" && home) {
      void api<{ notes: Note[] }>(`/homes/${home.id}/board`)
        .then((r) => setNotes(r.notes))
        .catch((e) => notify(e.message));
      const timer = setInterval(() => {
        void api<{ notes: Note[] }>(`/homes/${home.id}/board`)
          .then((r) => setNotes(r.notes))
          .catch(() => {});
      }, 2500);
      return () => clearInterval(timer);
    }
  }, [modal, home, notify]);
  useEffect(() => {
    if (!modal) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),textarea,select:not(:disabled),[tabindex="0"]',
        ),
      );
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0],
        last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
    };
  }, [modal]);
  useEffect(() => {
    const panel = document.querySelector(".chat-messages");
    if (panel && chatOpen) panel.scrollTop = panel.scrollHeight;
  }, [snapshot?.chat.length, chatOpen, pending.length]);
  useEffect(() => {
    if (modal === "host" && home) {
      void api<{ invites: { id: string }[] }>(`/homes/${home.id}/invites`)
        .then((r) => setInvites(r.invites))
        .catch((e) => notify(e.message));
    }
  }, [modal, home, notify]);
  async function connect(targetHome: Home, replaceExisting = false, resumeToken?: string, automatic=false, profileReady=false) {
    if(automatic&&(!mounted.current||leaving.current))throw new Error("Connection cancelled.");
    const generation=++connectGeneration.current;
    void audio.current?.unlock().catch(()=>{});
    setConnection("Joining your private home…");
    setError("");
    if(!automatic)leaving.current = false;
    // Saved-home buttons bypass the create/join form; send the restored/drafted
    // appearance before admission there too. Recovery retains the active profile.
    if (!automatic && !profileReady && identityRef.current) {
      const current = identityRef.current;
      const result = await api<{ profile: Identity }>("/identity", "PATCH", {
        name, avatar, expectedRevision: current.revision,
      });
      if(!mounted.current||leaving.current||generation!==connectGeneration.current)throw new Error("Connection cancelled.");
      identityRef.current = result.profile;
      setIdentity(result.profile);
      saveCustomization(browserStorage(), result.profile.id, avatar);
    }
    const ticket = resumeToken ? undefined : (await api<{ticket:string}>(`/homes/${targetHome.id}/ticket`,"POST",{})).ticket;
    if(!mounted.current||leaving.current||generation!==connectGeneration.current)throw new Error("Connection cancelled.");
    const endpoint =
      process.env.NEXT_PUBLIC_GAME_SERVER_URL ||
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
    const client = new Client(endpoint);
    const connected = resumeToken ? await client.reconnect(resumeToken) : await client.joinOrCreate("party", {
      ticket,
      homeId: targetHome.id,
      replaceExisting,
    });
    if(generation!==connectGeneration.current||leaving.current||!mounted.current){void connected.leave();throw new Error("Connection cancelled.");}
    connected.reconnection.minUptime=0;connected.reconnection.maxRetries=6;connected.reconnection.maxDelay=2000;
    room.current = connected;
    bridge.transportConnected = true;
    remember(targetHome,connected);
    setHome(targetHome);
    setConnection("Connected");
    const userId = identityRef.current?.id;
    // Count only successful intentional entries. Reconnect, refresh recovery,
    // session replacement, snapshots and rerenders are the same visit.
    if (userId && !automatic && !resumeToken && !replaceExisting) {
      visitsRef.current = recordVisit(browserStorage(), userId, targetHome.id, id(), Date.now(), visitsRef.current);
      setVisits(visitsRef.current);
    }
    lastInstance.current = "";
    seenChat.current.clear();
    bridge.liveBubbleIds.clear();
    setReplaceHome(null);
    connected.onMessage("welcome", (data: { selfId: string }) => {
      bridge.selfId = data.selfId;
    });
    connected.onMessage("snapshot", (data: Snapshot) => {
      if(room.current!==connected||leaving.current)return;
      remember(targetHome,connected);
      if (lastInstance.current && lastInstance.current !== data.instanceId) {
        setDraft("");
        setPending([]);
        setUnread(0);
        seenChat.current.clear();
        bridge.liveBubbleIds.clear();
      }
      const modeChanged = bridge.snapshot?.instanceId !== data.instanceId;
      lastInstance.current = data.instanceId;
      bridge.snapshot = data;
      audio.current?.setWorld(data,identityRef.current?.id||"",prefsRef.current.effectsVolume);
      if(modeChanged)setWatchExpanded(false);
      if (modeChanged || (!document.hidden && Date.now() - snapshotUiAt.current >= 200)) {
        snapshotUiAt.current = Date.now();
        setSnapshot(data);
      }
      setConnection(
        document.hidden ? "Session paused · tab in background" : "Connected",
      );
    });
    connected.onMessage("world.sound",(event:import("@third-space/contracts").WorldSoundEvent)=>{
      if(bridge.snapshot)audio.current?.playWorld(event,bridge.snapshot,identityRef.current?.id||"",prefsRef.current.effectsVolume);
    });
    connected.onMessage("chat", (message: Message) => {
      if (seenChat.current.has(message.id)) return;
      seenChat.current.add(message.id);
      bridge.liveBubbleIds.add(message.id);
      setPending((p) => p.filter((d) => d.commandId !== message.commandId));
      if (
        !chatOpenRef.current &&
        prefsRef.current.panel &&
        !prefsRef.current.textMuted.includes(message.senderId)
      )
        setUnread((n) => n + 1);
      setSnapshot((s) =>
        s
          ? {
              ...s,
              chat: [
                ...s.chat.filter((m) => m.id !== message.id),
                message,
              ].slice(-100),
            }
          : s,
      );
    });
    connected.onMessage("effect", (effect: Effect) => {
      if (effect.type === "proposal") {
        setProposal(effect);
        setTimeout(
          () => setProposal((p) => (p?.id === effect.id ? null : p)),
          Math.max(0, effect.expiresAt - Date.now()),
        );
        return;
      }
      if(!document.hidden){bridge.effects.push(effect);if(bridge.effects.length>64)bridge.effects.shift();}
      if (effect.type === "sound" && bridge.snapshot)
        audio.current?.play(
          effect,
          bridge.snapshot,
          identityRef.current?.id || "",
        );
    });
    connected.onMessage("board.changed", (event: { homeId: string }) => {
      if (homeRef.current?.id !== event.homeId) return;
      void api<{ notes: Note[] }>(`/homes/${event.homeId}/board`)
        .then((result) => {
          if (homeRef.current?.id === event.homeId) setNotes(result.notes);
        })
        .catch((e) => notify(e.message));
    });
    connected.onMessage("transition", () => {
      setDraft("");
      setPending([]);
      setUnread(0);
      setModal(null);
      setWatchExpanded(false);
      bridge.effects=[];
      bridge.liveBubbleIds.clear();
      bridge.touch = { axisX: 0, axisY: 0, jump: false };
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(".world-canvas")?.focus(),
      );
    });
    connected.onMessage(
      "notice",
      (data: { code: string; message: string; commandId?: string }) => {
        notify(data.message);
        if (data.commandId)
          setPending((p) =>
            p.map((d) =>
              d.commandId === data.commandId ? { ...d, failed: true } : d,
            ),
          );
      },
    );
    connected.onDrop(() => {
      if(room.current!==connected||leaving.current)return;
      bridge.transportConnected = false;
      setConnection("Reconnecting…");
      bridge.blocked = true;
      bridge.touch = { axisX: 0, axisY: 0, jump: false };
    });
    connected.onReconnect(() => {
      if(room.current!==connected||leaving.current)return;
      bridge.transportConnected = true;
      setConnection("Connected");
      bridge.liveBubbleIds.clear();
      notify("You’re back.");
    });
    connected.onLeave((code: number) => {
      if(room.current!==connected)return;
      room.current=null;bridge.transportConnected=false;audio.current?.setWorld(null,"",0);
      if(leaving.current||!mounted.current)return;
      if (code === 4012) {
        connectGeneration.current++; forgetSession(); setHome(null); setSnapshot(null); bridge.snapshot = null;
        bridge.blocked = true; bridge.touch = { axisX: 0, axisY: 0, jump: false };
        setConnection("Ready to enter"); setError("You left the session after 18 minutes of inactivity. Join again when you’re ready.");
        return;
      }
      if(code===4011){
        forgetSession();setConnection("Session replaced in another tab");
        notify("Your session moved to another tab.");return;
      }
      setConnection("Reconnecting…");void recover(targetHome,connected.reconnectionToken);
    });
    connected.onError((_code: number, message?: string) => {
      if(room.current!==connected||leaving.current)return;
      setConnection("Reconnecting…");notify(message||"Connection interrupted. Recovering your room…");
    });
  }

  async function enter(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let current = identity;
      if (!current) {
        const result = await api<{ profile: Identity }>("/identity", "POST", {
          name,
          avatar,
        });
        current = result.profile;
        setIdentity(current);
      } else {
        const result = await api<{ profile: Identity }>("/identity", "PATCH", {
          name,
          avatar,
          expectedRevision: current.revision,
        });
        current = result.profile;
        setIdentity(current);
      }
      identityRef.current = current;
      saveCustomization(browserStorage(), current.id, avatar);
      let selected: Home;
      if (entryMode === "create") {
        const result = await api<{ home: Home }>("/homes", "POST", {
          name: homeName,
          pin,
        });
        selected = result.home;
        setHomeName(suggestCampsiteName(browserStorage()));
      } else {
        const result = await api<{ home: Home }>(
          `/homes/${joinId.trim()}/join`,
          "POST",
          inviteToken.current ? { inviteToken: inviteToken.current } : { pin },
        );
        selected = result.home;
      }
      if (!inviteToken.current || entryMode === "create") rememberSessionPin(sessionPinStorage(), current.id, selected.id, selected.settingsRevision, pin);
      try {
        await connect(selected, false, undefined, false, true);
      } catch (e) {
        if (
          (e as Error).message?.includes("SESSION_ACTIVE") ||
          (e as Error).message?.includes("active session")
        )
          setReplaceHome(selected);
        throw e;
      }
      await audio.current?.unlock();
    } catch (e) {
      setError((e as Error).message);
      setConnection("Ready to enter");
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    audio.current?.setWorld(null,"",0);
    setWatchExpanded(false);
    leaving.current = true;bridge.transportConnected=false;connectGeneration.current++;forgetSession();
    await room.current?.leave();
    forgetSession();room.current = null;
    setHome(null);
    setSnapshot(null);
    setModal(null);
    setConnection("Ready to enter");
    setPending([]);
    try {
      const result = await api<{ homes: Home[] }>("/homes");
      setHomes(uniqueHomes(result.homes));
    } catch {}
  }
  function chat(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !room.current) return;
    const commandId = id();
    send({ type: "chat.send", commandId, text: draft.trim() });
    setPending((p) => [...p, { commandId, text: draft.trim(), failed: false }]);
    setDraft("");
    setTimeout(
      () =>
        setPending((p) =>
          p.map((m) =>
            m.commandId === commandId ? { ...m, failed: true } : m,
          ),
        ),
      8000,
    );
  }
  async function saveNote(event: React.FormEvent) {
    event.preventDefault();
    if (!home) return;
    setBusy(true);
    try {
      const body = {
        text: noteDraft,
        link: noteLink || null,
        x: editing?.x || 0.15,
        y: editing?.y || 0.15,
        ...(editing
          ? { expectedRevision: editing.revision }
          : { requestId: id() }),
      };
      await api(
        editing
          ? `/homes/${home.id}/board/${editing.id}`
          : `/homes/${home.id}/board`,
        editing ? "PATCH" : "POST",
        body,
      );
      const result = await api<{ notes: Note[] }>(`/homes/${home.id}/board`);
      setNotes(result.notes);
      setNoteDraft("");
      setNoteLink("");
      setEditing(null);
      setConflict(null);
      notify("Saved to your shared board.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        const detail = e.detail as {
          latest?: Note;
          error?: { latest?: Note; current?: Note };
        };
        setConflict(
          detail.latest ||
            detail.error?.current ||
            detail.error?.latest ||
            null,
        );
        notify("Someone edited this note. Your draft is preserved.");
      } else notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteNote(note: Note) {
    if (!home) return;
    try {
      await api(`/homes/${home.id}/board/${note.id}`, "DELETE", {
        expectedRevision: note.revision,
      });
      setNotes((n) => n.filter((v) => v.id !== note.id));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function moveNote(note: Note, direction: number) {
    if (!home) return;
    try {
      await api(`/homes/${home.id}/board/${note.id}`, "PATCH", {
        text: note.text,
        link: note.link,
        x: Math.min(0.95, Math.max(0, note.x + direction * 0.1)),
        y: note.y,
        expectedRevision: note.revision,
      });
      const result = await api<{ notes: Note[] }>(`/homes/${home.id}/board`);
      setNotes(result.notes);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function toggleMute(kind: "textMuted" | "soundMuted", person: string) {
    setPrefs((p) => ({
      ...p,
      [kind]: p[kind].includes(person)
        ? p[kind].filter((id) => id !== person)
        : [...p[kind], person],
    }));
  }
  function setPersonVolume(person: string, volume: number) {
    setPrefs((p) => ({
      ...p,
      personVolumes: readPersonVolumes({
        ...p.personVolumes,
        [person]: volume,
      }),
    }));
  }
  const selectedPerson = (snapshot?.members??snapshot?.players)?.find(
    (p) => p.id === selectedPersonId,
  );
  const self = snapshot?.players.find((p) => p.id === identity?.id),
    host = snapshot?.hostId === identity?.id,
    ready = !!identity && !!snapshot?.race?.readyIds.includes(identity.id),
    race = self?.mode === "race",
    messages = (snapshot?.chat || []).filter(
      (m) => !prefs.textMuted.includes(m.senderId),
    );
  useEffect(() => {
    if (!snapshot) return;
    setPending((p) =>
      p.filter(
        (item) =>
          !snapshot.chat.some(
            (message) => message.commandId === item.commandId,
          ),
      ),
    );
  }, [snapshot]);
  return (
    <main className={`app ${prefs.theme==="dark"?"dark-theme":""} ${prefs.reducedMotion ? "reduced-motion" : ""}`}>
      <IdlePresence snapshot={snapshot} send={send}/>
      <DeathVeil caughtBy={self?.caughtBy} avatar={self?.avatar} caughtAt={self?.caughtAt} serverTime={snapshot?.serverTime??0} worldRevision={snapshot?.worldRevision??0} epoch={snapshot?.epoch??""} reducedMotion={prefs.reducedMotion}/>
      <header className="masthead">
        <a className="brand" href="/" aria-label="Third Space home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            third space<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="tagline">a little closer, wherever you are</span>
        <div className="masthead-right">
          <span className="private-label">◇ PRIVATE BY DESIGN</span>
          {identity && (
            <span className="identity-pill">
              <i style={{ background: identity.avatar.color }} />
              {identity.name}
            </span>
          )}
        </div>
      </header>
      {!home ? (
        <div className="entry-layout">
          <section className="entry-story">
            <span className="eyebrow">YOUR FRIENDS. YOUR PLACE.</span>
            <h1>
              Somewhere to
              <br />
              just <em>be together.</em>
            </h1>
            <p>
              Make a little room for the big conversations,
              <br className="desktop-only" /> the silly moments, and one more
              game.
            </p>
            <div className="illustration" aria-hidden="true">
              <div className="sun" />
              <div className="window-art" />
              <div className="plant-art">
                <i />
                <i />
                <i />
                <b />
              </div>
              <div className="couch-art">
                <i />
                <i />
                <i />
              </div>
              <div className="rug-art" />
              <div className="table-art">
                <i />
              </div>
              <div className="pixel-person one" />
              <div className="pixel-person two" />
              <span className="art-bubble">glad you&apos;re here ♡</span>
              <span className="art-stars">✦</span>
            </div>
            <div className="story-bottom">
              <span>✦ hang out</span>
              <span>♡ make memories</span>
              <span>↗ play together</span>
            </div>
          </section>
          <section className="entry-card">
            <div className="card-heading">
              <span className="eyebrow">COME ON IN</span>
              <h2>Your space starts here.</h2>
              <p>Local development · private to this browser</p>
            </div>
            <form onSubmit={enter}>
              <fieldset disabled={connection === "Loading your profile"}>
                <label>
                  Your name
                  <input
                    required
                    maxLength={24}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="What should your friends call you?"
                    autoComplete="nickname"
                  />
                </label>
                <AvatarCustomizer
                  avatar={avatar}
                  name={name}
                  onChange={changeAvatar}
                />
                <div className="segmented">
                  <button
                    type="button"
                    className={entryMode === "create" ? "active" : ""}
                    onClick={() => setEntryMode("create")}
                  >
                    Create a home
                  </button>
                  <button
                    type="button"
                    className={entryMode === "join" ? "active" : ""}
                    onClick={() => setEntryMode("join")}
                  >
                    Join friends
                  </button>
                </div>
                {entryMode === "create" ? (
                  <label>
                    Home name
                    <input
                      required
                      value={homeName}
                      maxLength={60}
                      onChange={(e) => setHomeName(e.target.value)}
                    />
                  </label>
                ) : (
                  <>
                  <LiveSessions onSelect={(homeId)=>{setJoinId(homeId);setPin("");inviteToken.current="";}}/>
                  <label>
                    Home ID
                    <input
                      required
                      value={joinId}
                      onChange={(e) => setJoinId(e.target.value)}
                      placeholder="Short word from your friend (older IDs also work)"
                    />
                  </label>
                  </>
                )}
                <label>
                  {entryMode === "create" ? "Choose a private PIN" : "Room PIN"}
                  <input
                    required={!inviteToken.current}
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{6,12}"
                    minLength={6}
                    maxLength={12}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="6–12 digits"
                    autoComplete="off"
                  />
                </label>
                {error && (
                  <div className="error" role="alert">
                    {error}
                  </div>
                )}
                {replaceHome && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      void connect(replaceHome, true).catch((e) =>
                        setError(e.message),
                      );
                    }}
                  >
                    Use this tab · replaces your other session
                  </button>
                )}
                <button className="primary enter-button" disabled={busy}>
                  {busy && <span className="loading-spinner" aria-hidden="true"/>}
                  {busy
                    ? "Opening the door…"
                    : entryMode === "create"
                      ? "Create & enter home"
                      : "Join your friends"}
                  <span>↗</span>
                </button>
                <button
                  type="button"
                  className="google-disabled"
                  disabled
                  title="Supabase Google OAuth is not configured for this local build"
                >
                  Google sign-in · not configured
                </button>
              </fieldset>
            </form>
            {homes.length > 0 && (
              <div className="saved-homes">
                <span>Your homes</span>
                {homes.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      void connect(h).catch((e) => {
                        if(/SESSION_ACTIVE|active session/.test(e.message))setReplaceHome(h);
                        setError(e.message);
                      });
                    }}
                  >
                    {h.name}
                    <span>{visits.find(visit => visit.homeId === h.id)?.count ?? 0} {(visits.find(visit => visit.homeId === h.id)?.count ?? 0) === 1 ? "visit" : "visits"} · ↗</span>
                  </button>
                ))}
              </div>
            )}
            <p className="entry-footnote">
              Your local profile stays on this device. Invite friends with a
              home ID and PIN while the server is running.
            </p>
          </section>
        </div>
      ) : (
        <>
          <section className="room-header">
            <div>
              <span className="eyebrow">
                {race ? "GARDEN DASH" : "YOUR LITTLE CORNER OF THE INTERNET"}
              </span>
              <h1>
                {race ? "A little friendly competition." : snapshot?.worldId==="asylum"?"The abandoned asylum":snapshot?.worldId==="forest" ? "Midnight Pines" : home.name}
                <span className="room-flower">✦</span>
              </h1>
            </div>
            <div className="room-meta">
              <span
                className={`connection ${connection === "Connected" ? "live" : ""}`}
              >
                <i />
                {connection}
              </span>
              <ConnectionHealth room={room.current} connection={connection}/>
              {identity && <SessionInfo key={`${identity.id}:${home.id}`} home={home} profileId={identity.id}/>}
              {replaceHome && <button className="secondary" onClick={()=>{void connect(replaceHome,true).catch(e=>notify(e.message));}}>Use this tab · replaces your other session</button>}
              {connection === "Disconnected" && (
                <button
                  className="secondary"
                  onClick={() => {
                    void recover(home);
                  }}
                >
                  Rejoin
                </button>
              )}
              <button
                className="people-button"
                onClick={() => setModal("people")}
              >
                {(snapshot?.members??snapshot?.players)?.length || 0}/
                {Math.min(
                  home.capacity || GAME_CONFIG.partyCapacity,
                  GAME_CONFIG.partyCapacity,
                )}{" "}
                friends <span>↗</span>
              </button>
              <button
                className="icon-button"
                aria-label="Settings"
                onClick={() => setModal("settings")}
              >
                ⚙
              </button>
            </div>
          </section>
          <section className="play-area">
            <div className={`world-shell ${race ? "race-view" : "home-view"} ${snapshot?.worldId==="forest"&&!race?"forest-view":""}`}>
              <WorldMenu snapshot={snapshot} send={send}/>
              <div className="world-topline">
                <span>
                  ☀{" "}
                  {race
                    ? "A race through the garden"
                    : "An ordinary day, made better"}
                </span>
                <span>
                  {race
                    ? "← → MOVE · SPACE JUMP"
                    : "CLICK TO WALK · WASD / ARROWS · SPACE BOOST · F FLASHLIGHT"}
                </span>
              </div>
              <World bridge={bridge} />
              <WorldMap snapshot={snapshot} selfId={identity?.id??""}/>
              {snapshot && connection!=="Connected" && <div className="world-busy reconnecting-cover" role="status"><span className="loading-spinner" aria-hidden="true"/>{connection==="Disconnected"?"Your room is saved. Rejoin when ready.":connection}</div>}
              {!snapshot && (
                <div className="connecting-cover">
                  <span className="loading-spinner" aria-hidden="true"/> Waiting for the room state…
                </div>
              )}
              {race && snapshot?.race?.phase === "waiting" && <section className="race-lobby" aria-label="Race waiting lobby"><h2>Waiting for friends</h2><p>Join the same lobby, then ready up. The race starts when everyone here is ready.</p><ul>{snapshot.players.map(p=><li key={p.id}>{p.name} · {!p.connected?"reconnecting":snapshot.race?.readyIds.includes(p.id)?"ready":"waiting"}</li>)}</ul><button onClick={()=>send({type:"race.ready",ready:!ready})}>{ready?"Not ready yet":"Ready to race"}</button><button onClick={()=>send({type:"race.return"})}>Back to camp</button><small>While waiting, voice is shared with everyone outside at camp when native voice is configured.</small></section>}
              {race && snapshot?.race?.phase === "countdown" && (
                <div className="countdown">
                  <span>READY, SET…</span>
                  <strong>
                    {Math.max(
                      1,
                      Math.ceil(
                        (snapshot.race.startAt - snapshot.serverTime) / 1000,
                      ),
                    )}
                  </strong>
                </div>
              )}
              {race && (
                <div className="race-status">
                  <span>Checkpoint {self?.checkpoint || 0}/4</span>
                  <span>
                    {snapshot?.race?.phase === "running"
                      ? time(snapshot.serverTime - snapshot.race.startAt)
                      : snapshot?.race?.phase}
                  </span>
                  <button onClick={() => send({ type: "race.return" })}>
                    Return home
                  </button>
                </div>
              )}
              <SharedWatching snapshot={snapshot} getSnapshot={()=>bridge.snapshot} selfId={identity?.id||""} expanded={watchExpanded} onExpand={setWatchExpanded} send={send}/>
              <div className="world-bottomline">
                <StaminaBar snapshot={snapshot} selfId={identity?.id??""}/>
                <span>
                  ◇{" "}
                  {race
                    ? "Jump over coral obstacles. Flags save your progress."
                    : "HOVER FOR NAMES · CLICK A FRIEND · ENTER TO CHAT"}
                </span>
                <span>
                  {race
                    ? "SERVER-SCORED RACE"
                    : "A PRIVATE PLACE FOR YOUR PEOPLE"}
                </span>
              </div>
              <aside
                className={`people-panel ${peopleOpen ? "open" : "collapsed"}`}
                aria-label="People and volume"
              >
                <button
                  className="chat-heading"
                  aria-expanded={peopleOpen}
                  aria-controls="corner-people"
                  onClick={() => setPeopleOpen((open) => !open)}
                >
                  <span>
                    ♬ People &amp; volume{" "}
                    <b className="people-count">
                      {snapshot?.players.filter(
                        (p) => p.mode === self?.mode && p.id !== identity?.id,
                      ).length || 0}
                    </b>
                  </span>
                  <span>{peopleOpen ? "−" : "+"}</span>
                </button>
                {peopleOpen && (
                  <div id="corner-people" className="corner-people">
                    <small>
                      Only affects what you hear. Native voice is not connected.
                    </small>
                    {snapshot?.players
                      .filter(
                        (p) => p.mode === self?.mode && p.id !== identity?.id,
                      )
                      .map((p) => (
                        <article key={p.id}>
                          <button
                            className="person-link"
                            onClick={() => bridge.selectPerson(p.id)}
                          >
                            {p.name} <span>Interact ↗</span>
                          </button>
                          <PersonVolume
                            name={p.name}
                            value={prefs.personVolumes[p.id] ?? 1}
                            muted={prefs.soundMuted.includes(p.id)}
                            onChange={(volume) => setPersonVolume(p.id, volume)}
                            onMute={() => toggleMute("soundMuted", p.id)}
                          />
                        </article>
                      ))}
                    {!snapshot?.players.some(
                      (p) => p.mode === self?.mode && p.id !== identity?.id,
                    ) && (
                      <p>Friends will appear here when they join your world.</p>
                    )}
                  </div>
                )}
              </aside>
              {prefs.panel && (
                <aside
                  className={`chat-panel ${chatOpen ? "open" : "collapsed"}`}
                  aria-label="Room chat"
                >
                  <button
                    className="chat-heading"
                    onClick={() => {
                      setChatOpen((v) => !v);
                      setUnread(0);
                    }}
                  >
                    <span>
                      ☏ Little conversations {unread > 0 && <b>{unread}</b>}
                    </span>
                    <span>{chatOpen ? "−" : "+"}</span>
                  </button>
                  {chatOpen && (
                    <>
                      <div
                        className="chat-messages"
                        role="log"
                        aria-live={prefs.announce ? "polite" : "off"}
                      >
                        {messages.length === 0 && (
                          <p className="chat-empty">
                            Say hello. You&apos;re among friends.
                          </p>
                        )}
                        {messages.map((m) => (
                          <p key={m.id}>
                            <span className="chat-message-header">
                              <b>{m.senderName}</b>
                              <ChatTimestamp createdAt={m.createdAt}/>
                            </span>
                            <span>{m.text}</span>
                          </p>
                        ))}
                        {pending.map((m) => (
                          <p key={m.commandId} className="pending">
                            <b>
                              You · {m.failed ? "not delivered" : "sending"}
                            </b>
                            <span>{m.text}</span>
                            {m.failed && (
                              <button
                                onClick={() => {
                                  send({
                                    type: "chat.send",
                                    commandId: m.commandId,
                                    text: m.text,
                                  });
                                  setPending((p) =>
                                    p.map((v) =>
                                      v.commandId === m.commandId
                                        ? { ...v, failed: false }
                                        : v,
                                    ),
                                  );
                                }}
                              >
                                Retry
                              </button>
                            )}
                          </p>
                        ))}
                      </div>
                      <form className="chat-input" onSubmit={chat}>
                        <input
                          ref={chatInput}
                          aria-label="Message friends"
                          value={draft}
                          maxLength={280}
                          placeholder="Say something nice…"
                          onFocus={() => (bridge.blocked = true)}
                          onBlur={() =>
                            (bridge.blocked =
                              modal !== null || connection !== "Connected")
                          }
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing && e.key === "Enter")
                              e.preventDefault();
                          }}
                        />
                        <button
                          aria-label="Send message"
                          disabled={!draft.trim() || connection !== "Connected"}
                        >
                          ↑
                        </button>
                      </form>
                    </>
                  )}
                </aside>
              )}
              <div className="touch-controls">
                <div className="dpad">
                  {[
                    ["up", 0, -1, "↑"],
                    ["left", -1, 0, "←"],
                    ["down", 0, 1, "↓"],
                    ["right", 1, 0, "→"],
                  ].map(([key, x, y, label]) => (
                    <button
                      key={key}
                      className={String(key)}
                      aria-label={`Move ${key}`}
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        bridge.touch.axisX = Number(x);
                        bridge.touch.axisY = Number(y);
                      }}
                      onPointerUp={() =>
                        (bridge.touch = { axisX: 0, axisY: 0, jump: false })
                      }
                      onPointerCancel={() =>
                        (bridge.touch = { axisX: 0, axisY: 0, jump: false })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  className="touch-action"
                  aria-label={race ? "Jump" : "Boost"}
                  disabled={!race && (bridge.blocked || !canTouchBoost(self, snapshot?.serverTime ?? 0))}
                  onPointerDown={() => { if (race) bridge.touch.jump = true; }}
                  onPointerCancel={() => { bridge.touch.jump = false; }}
                  onClick={() => {
                    if (!race && !bridge.blocked)
                      queueTouchBoost(bridge.touch, self, snapshot?.serverTime ?? 0);
                  }}
                >
                  {race ? "Jump" : "Boost"}
                </button>
              </div>
            </div>
            <nav className="social-toolbar" aria-label="Hangout controls">
              <div className="audio-toolbar">
                <button
                  className="native-off"
                  onClick={() => notify(voiceReason)}
                >
                  <span>♩</span>
                  <div>
                    Native voice off
                    <small>Text & game audio are available</small>
                  </div>
                </button>
                <button
                  className="icon-button"
                  aria-label="Microphone unavailable"
                  onClick={() => notify(voiceReason)}
                >
                  ♩̸
                </button>
                <button
                  className="icon-button"
                  aria-label="Native listening unavailable"
                  onClick={() => notify(voiceReason)}
                >
                  ♧
                </button>
                <span className="voice-reach">Native voice unavailable</span>
              </div>
              <div className="social-buttons">
                {snapshot&&getWorld(snapshot.worldId).dark&&!race&&<><button aria-keyshortcuts="F" title="Toggle flashlight (F)" onClick={()=>send({type:"flashlight",enabled:!self?.flashlightOn})}>{self?.flashlightOn?"☀":"☾"} <span>Flashlight {self?.flashlightOn?"on":"off"} · {Math.ceil((self?.flashlightBattery??1)*100)}%</span></button></>}
                {snapshot&&getWorld(snapshot.worldId).mediaEnabled!==false&&<button aria-label="▣ Watch together" onClick={()=>setWatchExpanded(true)}>▣ <span>Watch together</span></button>}
                <button onClick={() => setModal("emotes")}>
                  ☺ <span>Emotes</span>
                </button>
                <button onClick={() => setModal("sound")}>
                  ♫ <span>Sounds</span>
                </button>
                <button onClick={() => setModal("board")}>
                  ▤ <span>Idea board</span>
                </button>
                <button
                  className="play-button"
                  onClick={() => setModal("portal")}
                >
                  ✦ <span>Let&apos;s play</span>
                </button>
              </div>
            </nav>
            <div className="room-note">
              <span>A place for the in-between moments.</span>
              <button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(home.joinAlias || home.id)
                    .then(() =>
                      notify("Home ID copied. Share the PIN separately."),
                    )
                    .catch(() => notify(`Home ID: ${home.joinAlias || home.id}`));
                }}
              >
                Copy home ID ↗
              </button>
              <button onClick={() => void leave()}>Leave home</button>
            </div>
          </section>
        </>
      )}
      {home && modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "board" ? "board-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={`${modal} controls`}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              ×
            </button>
            {modal === "race-entry" && <><span className="eyebrow">A LITTLE FRIENDLY COMPETITION</span><h2>Join the race?</h2><p>Join the shared Garden Dash waiting lobby. Ready up there, or wait for friends to join. Your friends can stay at camp.</p><div className="watching-actions"><button onClick={()=>{send({type:"race.enter"});setModal(null);}}>Join race</button><button onClick={()=>setModal(null)}>Cancel</button></div></>}
            {modal === "board" && (
              <>
                <span className="eyebrow">LITTLE THOUGHTS, SHARED</span>
                <h2>The idea board.</h2>
                <p>Plans, reminders, or whatever&apos;s on your mind.</p>
                <div className="board-notes">
                  {notes.map((n, i) => (
                    <article
                      key={n.id}
                      className={`sticky sticky-${i % 4}`}
                      style={{
                        transform: `rotate(${i % 2 ? 1 : -1}deg)`,
                        marginLeft: `${Math.round(n.x * 30)}px`,
                      }}
                    >
                      <p>{n.text}</p>
                      {n.link && (
                        <a
                          href={n.link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open link ↗
                        </a>
                      )}
                      <span>— {n.authorLabel}</span>
                      <div>
                        <button
                          onClick={() => {
                            setEditing(n);
                            setNoteDraft(n.text);
                            setNoteLink(n.link || "");
                            setConflict(null);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          aria-label="Move note left"
                          onClick={() => void moveNote(n, -1)}
                        >
                          ←
                        </button>
                        <button
                          aria-label="Move note right"
                          onClick={() => void moveNote(n, 1)}
                        >
                          →
                        </button>
                        {(n.authorId === identity?.id || host) && (
                          <button onClick={() => void deleteNote(n)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                  {notes.length === 0 && (
                    <div className="empty-state">
                      ✦
                      <p>
                        A blank board is an invitation.
                        <br />
                        Leave the first little thought.
                      </p>
                    </div>
                  )}
                </div>
                <form className="note-form" onSubmit={saveNote}>
                  <label>
                    {editing ? "Edit your thought" : "Add a little thought"}
                    <textarea
                      required
                      maxLength={1000}
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Movie night? A weekend adventure? Your next big idea?"
                    />
                  </label>
                  <input
                    type="url"
                    value={noteLink}
                    placeholder="Optional https:// link"
                    onChange={(e) => setNoteLink(e.target.value)}
                  />
                  {conflict && (
                    <div className="error">
                      <p>Latest version: {conflict.text}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(conflict);
                          setConflict(null);
                        }}
                      >
                        Keep my draft and use latest revision
                      </button>
                    </div>
                  )}
                  <div className="form-actions">
                    {editing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setNoteDraft("");
                          setNoteLink("");
                        }}
                      >
                        Cancel edit
                      </button>
                    )}
                    <button className="primary" disabled={busy}>
                      {busy && <span className="loading-spinner" aria-hidden="true"/>}
                      {busy
                        ? "Saving…"
                        : editing
                          ? "Save changes"
                          : "Pin it to the board"}{" "}
                      ↗
                    </button>
                  </div>
                </form>
              </>
            )}
            {modal === "portal" && (
              <>
                <span className="eyebrow">ONE MORE GAME?</span>
                <h2>Garden dash.</h2>
                <p>
                  A friendly obstacle race. Hop over hazards, pass every flag,
                  and meet at the finish.
                </p>
                <div className="game-card">
                  <span>✦</span>
                  <div>
                    <b>THE GARDEN IS CALLING</b>
                    <p>
                      1–{GAME_CONFIG.partyCapacity} friends · Arrow keys + Space
                      · Checkpoint respawns
                    </p>
                  </div>
                </div>
                <p className="ready-summary">
                  {snapshot?.race?.readyIds.length || 0} of{" "}
                  {snapshot?.players.length || 0} friends ready
                </p>
                <div
                  className="ready-list"
                  role="list"
                  aria-label="Race readiness"
                >
                  {snapshot?.players.map((p) => (
                    <div key={p.id} role="listitem">
                      <i style={{ background: p.avatar.color }} />
                      <span className="ready-person">{p.name}</span>
                      <span className="ready-state">
                        {snapshot.race?.readyIds.includes(p.id)
                          ? "✓ ready"
                          : "taking their time"}
                      </span>
                    </div>
                  ))}
                </div>
                {snapshot?.race?.phase === "results" && (
                  <div className="results">
                    <h3>Good race, friends.</h3>
                    {snapshot.race.results.map((r) => (
                      <p key={r.playerId}>
                        <b>
                          {r.rank ? `#${r.rank}` : "—"} {r.name}
                        </b>
                        <span>
                          {r.dnf ? "Did not finish" : time(r.elapsedMs)}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
                <div className="form-actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      send({
                        type: race ? "race.return" : "race.ready",
                        ...(!race ? { ready: !ready } : {}),
                      })
                    }
                  >
                    {race
                      ? "Back to our home"
                      : ready
                        ? "Not ready yet"
                        : "Count me in ✓"}
                  </button>
                  {host && !race && (
                    <button
                      className="primary"
                      disabled={!snapshot?.race?.readyIds.length}
                      onClick={() => {
                        send({ type: "race.start" });
                        setModal(null);
                      }}
                    >
                      Start the race ↗
                    </button>
                  )}
                </div>
                {!host && (
                  <small>Your host starts when everyone&apos;s ready.</small>
                )}
              </>
            )}
            {modal === "emotes" && (
              <>
                <span className="eyebrow">SAY IT WITHOUT WORDS</span>
                <h2>A little expression.</h2>
                <div className="emote-grid">
                  {EMOTE_IDS.slice(0, 4).map((e, i) => (
                    <button
                      key={e}
                      onClick={() => {
                        send({ type: "emote", assetId: e });
                        setModal(null);
                      }}
                    >
                      <span>{["👋", "♡", "☺", "♫"][i]}</span>
                      {e}
                    </button>
                  ))}
                  {snapshot?.worldId==="forest"&&<button onClick={()=>{send({type:"roast",enabled:!self?.roastingAt});setModal(null);}} disabled={!self?.roastingAt&&!!self&&Math.hypot(self.x-24,self.y-24)>4} title="Come near the campfire to roast"><span>♨</span>{self?.roastingAt?"Stop roasting":"Roast marshmallow"}</button>}
                </div>
                <label>
                  Say hello to
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">Choose a friend nearby</option>
                    {snapshot?.players
                      .filter((p) => p.id !== identity?.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="form-actions">
                  <button
                    disabled
                    title="Pokes need an opt-in preference; use a high five for now."
                    className="secondary"
                    onClick={() => {
                      send({
                        type: "emote",
                        assetId: "poke",
                        targetId: target,
                      });
                      setModal(null);
                    }}
                  >
                    Poke ☞
                  </button>
                  <button
                    disabled={!target}
                    className="primary"
                    onClick={() => {
                      send({
                        type: "emote",
                        assetId: "high-five",
                        targetId: target,
                      });
                      setModal(null);
                    }}
                  >
                    Offer high five ✋
                  </button>
                </div>
                <small>
                  Paired actions need your friend&apos;s acceptance.
                </small>
              </>
            )}
            {modal === "sound" && (
              <>
                <span className="eyebrow">A SMALL SOUND, A BIG MOOD</span>
                <h2>Soundboard.</h2>
                <p>
                  Original synthesized sounds, played from your avatar. Friends
                  further away hear less.
                </p>
                <div className="emote-grid">
                  {SOUND_IDS.map((s, i) => (
                    <button
                      key={s}
                      disabled={!snapshot?.soundboardEnabled}
                      onClick={() => {
                        void audio.current
                          ?.unlock()
                          .then(() => send({ type: "sound", assetId: s }));
                      }}
                    >
                      <span>{["♬", "◌", "✦", "♪"][i]}</span>
                      {s}
                    </button>
                  ))}
                </div>
                <label>
                  Soundboard volume{" "}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={prefs.soundVolume}
                    onChange={(e) =>
                      setPrefs({
                        ...prefs,
                        soundVolume: Number(e.target.value),
                      })
                    }
                  />
                </label>
                {host && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={snapshot?.soundboardEnabled || false}
                      onChange={(e) =>
                        send({
                          type: "sound.enabled",
                          enabled: e.target.checked,
                        })
                      }
                    />
                    Allow soundboard in this home
                  </label>
                )}
                <small>
                  One sound every three seconds. Native voice off keeps game
                  sounds available.
                </small>
              </>
            )}
            {modal === "person" && (
              <>
                <span className="eyebrow">A LITTLE HELLO</span>
                <h2>{selectedPerson?.name || "Your friend has left"}</h2>
                {selectedPerson && selectedPerson.id !== identity?.id ? (
                  <>
                    <p>
                      {selectedPerson.connected ? "Here" : "Reconnecting"} ·{" "}
                      {selectedPerson.mode === self?.mode
                        ? "In your world"
                        : "In another world"}
                    </p>
                    <PersonVolume
                      name={selectedPerson.name}
                      value={prefs.personVolumes[selectedPerson.id] ?? 1}
                      muted={prefs.soundMuted.includes(selectedPerson.id)}
                      onChange={(volume) =>
                        setPersonVolume(selectedPerson.id, volume)
                      }
                      onMute={() => toggleMute("soundMuted", selectedPerson.id)}
                    />
                    <small>
                      Your soundboard volume for this person is saved in this
                      browser. Native voice volume will be available when voice
                      is connected.
                    </small>
                    <div className="form-actions">
                      <button
                        className="secondary"
                        aria-pressed={prefs.textMuted.includes(
                          selectedPerson.id,
                        )}
                        onClick={() =>
                          toggleMute("textMuted", selectedPerson.id)
                        }
                      >
                        {prefs.textMuted.includes(selectedPerson.id)
                          ? "Unmute text"
                          : "Mute text"}
                      </button>
                      <button
                        className="primary"
                        disabled={
                          !self ||
                          !selectedPerson.connected ||
                          self.mode !== selectedPerson.mode ||
                          Math.hypot(
                            self.x - selectedPerson.x,
                            self.y - selectedPerson.y,
                          ) > GAME_CONFIG.socialTargetDistance
                        }
                        onClick={() => {
                          send({
                            type: "emote",
                            assetId: "high-five",
                            targetId: selectedPerson.id,
                          });
                          setModal(null);
                        }}
                      >
                        Offer high five ✋
                      </button>
                    </div>
                    <p>
                      Walk within two tiles to offer a high five. Your friend
                      chooses whether to accept.
                    </p>
                  </>
                ) : (
                  <p>Open the people menu to choose someone else.</p>
                )}
              </>
            )}
            {modal === "people" && (
              <>
                <span className="eyebrow">YOUR PEOPLE</span>
                <h2>Who&apos;s here.</h2>
                <p className="roster-summary">
                  {(snapshot?.members??snapshot?.players)?.length || 0} of{" "}
                  {Math.min(
                    home.capacity || GAME_CONFIG.partyCapacity,
                    GAME_CONFIG.partyCapacity,
                  )}{" "}
                  friends in this world
                </p>
                <div
                  className="roster"
                  role="list"
                  aria-label="Friends in this world"
                >
                  {(snapshot?.members??snapshot?.players)?.map((p) => (
                    <article key={p.id} role="listitem">
                      <span
                        className="roster-avatar"
                        style={{ background: p.avatar.color }}
                      >
                        {initials(p.name)}
                      </span>
                      <div className="roster-person">
                        <b>
                          {p.id === identity?.id ? (
                            `${p.name} (you)`
                          ) : (
                            <button
                              className="person-link"
                              onClick={() => bridge.selectPerson(p.id)}
                            >
                              {p.name} ↗
                            </button>
                          )}
                        </b>
                        <small>
                          {p.id === snapshot.hostId ? "Host · " : ""}
                          {p.connected ? p.zone?"In the asylum":"Outside / lounge" : "Reconnecting"} · Native voice{" "}
                          {p.nativeMode}
                        </small>
                      </div>
                      {p.id !== identity?.id && (
                        <div className="mute-controls">
                          <button
                            aria-pressed={prefs.textMuted.includes(p.id)}
                            onClick={() => toggleMute("textMuted", p.id)}
                          >
                            {prefs.textMuted.includes(p.id)
                              ? "Unmute text"
                              : "Mute text"}
                          </button>
                          <button
                            aria-pressed={prefs.soundMuted.includes(p.id)}
                            onClick={() => toggleMute("soundMuted", p.id)}
                          >
                            {prefs.soundMuted.includes(p.id)
                              ? "Unmute sounds"
                              : "Mute sounds"}
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
                {host && (
                  <button
                    className="secondary"
                    onClick={() => setModal("host")}
                  >
                    Manage private home ↗
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() =>
                    send({
                      type: "seat",
                      seatId: self?.seatId ? null : getWorld(snapshot?.worldId).map.seats[0].id,
                    })
                  }
                >
                  {self?.seatId ? "Stand up" : "Take a seat"}
                </button>
              </>
            )}
            {modal === "settings" && (
              <>
                <span className="eyebrow">MAKE IT FEEL LIKE YOU</span>
                <h2>Your preferences.</h2>
                <h3>Little conversations</h3>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.panel}
                    onChange={(e) =>
                      setPrefs({ ...prefs, panel: e.target.checked })
                    }
                  />
                  Show corner chat panel
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.bubbles}
                    onChange={(e) =>
                      setPrefs({ ...prefs, bubbles: e.target.checked })
                    }
                  />
                  Show avatar speech bubbles
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.announce}
                    onChange={(e) =>
                      setPrefs({ ...prefs, announce: e.target.checked })
                    }
                  />
                  Announce new chat to screen readers
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.reducedMotion}
                    onChange={(e) =>
                      setPrefs({ ...prefs, reducedMotion: e.target.checked })
                    }
                  />
                  Reduced motion
                </label>
                <h3>Game sounds</h3>
                <label>Appearance<select aria-label="Color theme" value={prefs.theme} onChange={e=>setPrefs({...prefs,theme:e.target.value as Prefs["theme"]})}><option value="dark">Dark</option><option value="light">Light</option></select></label>
                <label className="check"><input aria-label="Mute game sounds" type="checkbox" checked={prefs.gameSoundsMuted} onChange={e=>setPrefs({...prefs,gameSoundsMuted:e.target.checked})}/>Mute game sounds</label>
                <label>Ambience &amp; movement<input aria-label="Forest ambience volume" type="range" min="0" max="1" step=".05" value={prefs.effectsVolume} onChange={e=>setPrefs({...prefs,effectsVolume:Number(e.target.value)})}/></label>
                <p>Mute covers ambience, footsteps, clown sounds and soundboard effects. Voice and movie volume have separate controls.</p>
                <h3>Native voice</h3>
                <div className="service-notice">{voiceReason}</div>
                <p>
                  Microphone capture stays off until server-enforced voice
                  privacy is verified.
                </p>
                <div className="segmented">
                  <button
                    className="active"
                    onClick={() =>
                      send({
                        type: "voice.status",
                        nativeMode: "off",
                        manualMute: false,
                        deafened: false,
                      })
                    }
                  >
                    Native off
                  </button>
                  <button disabled>Listen only</button>
                  <button disabled>Enabled</button>
                </div>
                <label>
                  Soundboard volume
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={prefs.soundVolume}
                    onChange={(e) =>
                      setPrefs({
                        ...prefs,
                        soundVolume: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <h3>Room voice policy</h3>
                <div className="segmented">
                  <button
                    disabled={!host}
                    className={
                      snapshot?.voiceMode === "proximity" ? "active" : ""
                    }
                    onClick={() =>
                      send({ type: "voice.mode", mode: "proximity" })
                    }
                  >
                    Proximity
                  </button>
                  <button
                    disabled={!host}
                    className={snapshot?.voiceMode === "room" ? "active" : ""}
                    onClick={() => send({ type: "voice.mode", mode: "room" })}
                  >
                    Room-wide
                  </button>
                </div>
                <small>
                  Only the host changes this policy. Native voice is not
                  connected in local mode.
                </small>
              </>
            )}
            {modal === "host" && (
              <>
                <span className="eyebrow">KEEP YOUR PLACE PRIVATE</span>
                <h2>Home controls.</h2>
                <p>
                  Room ID: <code>{home.joinAlias || home.id}</code>
                </p>
                <label>
                  Rotate the PIN
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    type="password"
                    inputMode="numeric"
                    minLength={6}
                    maxLength={12}
                  />
                </label>
                <button
                  className="primary"
                  onClick={() => {
                    void api<{home:Home}>(`/homes/${home.id}/pin`, "PUT", { pin })
                      .then(({home:updated}) => {
                        rememberSessionPin(sessionPinStorage(), identity!.id, updated.id, updated.settingsRevision, pin);
                        setHome(updated);
                        notify("PIN rotated. Previous guest grants revoked.");
                      })
                      .catch((e) => notify(e.message));
                  }}
                >
                  Save new PIN
                </button>
                <h3>Invitations</h3>
                <button
                  className="secondary"
                  onClick={() => {
                    void api<{ id: string; token: string }>(
                      `/homes/${home.id}/invites`,
                      "POST",
                      {},
                    )
                      .then((r) => {
                        const url = `${location.origin}/#invite=${r.token}&home=${home.id}`;
                        setInviteUrl(url);
                        setInvites((v) => [...v, { id: r.id, url }]);
                      })
                      .catch((e) => notify(e.message));
                  }}
                >
                  Create invitation ↗
                </button>
                {inviteUrl && (
                  <input
                    aria-label="Created invitation"
                    readOnly
                    value={inviteUrl}
                  />
                )}
                <div className="invite-list">
                  {invites.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => {
                        void api(`/homes/${home.id}/invites/${i.id}`, "DELETE")
                          .then(() => {
                            setInvites((v) => v.filter((n) => n.id !== i.id));
                            notify("Invitation revoked.");
                          })
                          .catch((e) => notify(e.message));
                      }}
                    >
                      Revoke {i.id.slice(0, 8)}
                    </button>
                  ))}
                </div>
                <h3>Participants</h3>
                {snapshot?.players
                  .filter((p) => p.id !== identity?.id)
                  .map((p) => (
                    <div className="host-person" key={p.id}>
                      <span>{p.name}</span>
                      <button
                        onClick={() => {
                          void api(
                            `/homes/${home.id}/members/${p.id}`,
                            "DELETE",
                          )
                            .then(() => notify(`${p.name} removed.`))
                            .catch((e) => notify(e.message));
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
              </>
            )}
            {modal === "tv" && (
              <>
                <span className="eyebrow">SAVE A SEAT</span>
                <h2>Movie nights, coming later.</h2>
                <div className="tv-placeholder">
                  ▣<span>Watching together is the next chapter.</span>
                </div>
                <p>
                  Shared playback and video uploads belong to milestone M4. For
                  now, settle into the couch and enjoy the company.
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    send({ type: "seat", seatId: getWorld(snapshot?.worldId).map.seats[0].id });
                    setModal(null);
                  }}
                >
                  Take a seat ♡
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {proposal && (
        <div className="proposal" role="alert">
          <span>✋ A friend offered a high five!</span>
          <button
            className="primary"
            onClick={() => {
              send({ type: "social.accept", proposalId: proposal.id });
              setProposal(null);
            }}
          >
            High five
          </button>
          <button onClick={() => setProposal(null)}>Later</button>
        </div>
      )}
      {snapshot?.race?.phase === "results" && race && modal !== "portal" && (
        <div className="result-toast">
          <b>That was a good run. ✦</b>
          <button onClick={() => setModal("portal")}>See results ↗</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <footer className="footer">
        <span>THIRD SPACE</span>
        <span>Built for the moments that don&apos;t need a plan.</span>
        <span>made for your circle ♡</span>
      </footer>
    </main>
  );
}
