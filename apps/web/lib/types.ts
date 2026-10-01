export type {
  AvatarConfig as Avatar,
  PlayerState as Player,
  ChatMessage as Message,
  RaceState as Race,
  RoomSnapshot as Snapshot,
  BoardNote as Note,
  SocialEffect as Effect,
} from "@third-space/contracts";
import type {
  RoomSnapshot as Snapshot,
  SocialEffect as Effect,
} from "@third-space/contracts";
import type { AvatarConfig } from "@third-space/contracts";
export type Identity = {
  id: string;
  name: string;
  avatar: AvatarConfig;
  revision?: number;
};
export type Home = {
  id: string;
  name: string;
  ownerId: string;
  capacity: number;
  discordUrl?: string;
  settingsRevision?: number;
  pinEnabled?: boolean;
  joinAlias?: string;
};
export type WorldBridge = {
  exitRequest?:number;
  story?:import('../../../packages/contracts/src/forest-story').ForestStorySnapshot|null;
  snapshot: Snapshot | null;
  selfId: string;
  blocked: boolean;
  transportConnected: boolean;
  touch: { axisX: number; axisY: number; jump: boolean; sprint?: boolean };
  bubbles: boolean;
  mutedText: Set<string>;
  reducedMotion: boolean;
  effects: Effect[];
  liveBubbleIds: Set<string>;
  send: (command: Record<string, unknown>) => void;
  interact: (object: string) => void;
  selectPerson: (id: string) => void;
};
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail: unknown,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error?.code || data.code || "REQUEST_FAILED",
      data.error?.message || data.message || "That did not work. Try again.",
      data,
    );
  return data as T;
}
