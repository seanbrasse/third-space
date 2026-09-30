import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { GAME_CONFIG } from "@third-space/config";
import {
  Router,
  json,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  AvatarSchema,
  DEFAULT_AVATAR,
  type AvatarConfig,
} from "@third-space/contracts";

export type Role = "owner" | "moderator" | "member";
export interface Profile {
  id: string;
  userId: string;
  name: string;
  avatar: AvatarConfig;
  preferences: Record<string, unknown>;
  revision: number;
  provider: "local";
}
export interface Home {
  id: string;
  name: string;
  ownerId: string;
  capacity: number;
  settingsRevision: number;
  pinEnabled: boolean;
}
export interface BoardNote {
  id: string;
  homeId: string;
  authorId: string;
  authorLabel: string;
  text: string;
  link: string | null;
  x: number;
  y: number;
  revision: number;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface AccessEvent {
  homeId: string;
  userIds: string[];
  reason: string;
}
export interface BoardEvent {
  homeId: string;
  noteId: string;
  revision: number;
}
export interface TicketIdentity {
  userId: string;
  homeId: string;
  name: string;
  avatar: AvatarConfig;
  role: Role;
}
export class DataError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const fail = (
  code: string,
  message: string,
  status = 400,
  details: Record<string, unknown> = {},
): never => {
  throw new DataError(code, message, status, details);
};
function text(value: unknown, max: number, field = "text"): string {
  if (typeof value !== "string")
    return fail("INVALID_INPUT", `${field} is required.`);
  const clean = value.trim();
  const len = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(clean),
  ).length;
  if (
    !len ||
    len > max ||
    (field === "name" && /[\u0000-\u001f\u007f]/.test(clean)) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(clean)
  )
    return fail("INVALID_INPUT", `${field} must contain 1–${max} characters.`);
  return clean;
}
function avatar(value: unknown): AvatarConfig {
  const parsed = AvatarSchema.safeParse(value);
  if (!parsed.success) return fail("INVALID_INPUT", "Invalid avatar option.");
  return parsed.data;
}
function pinVerifier(pin: unknown): string {
  if (typeof pin !== "string" || !/^\d{6,12}$/.test(pin))
    return fail("INVALID_INPUT", "PIN must contain 6–12 digits.");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}
function pinMatches(pin: unknown, verifier: string): boolean {
  if (typeof pin !== "string" || !/^\d{6,12}$/.test(pin)) return false;
  const [salt, expected] = verifier.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(pin, salt, 32);
  const wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
function safeLink(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 2048)
    return fail("INVALID_INPUT", "Invalid HTTPS link.");
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return fail("INVALID_INPUT", "Invalid HTTPS link.");
  }
  if (u.protocol !== "https:" || u.username || u.password)
    return fail("INVALID_INPUT", "Use an HTTPS link without credentials.");
  return u.toString();
}
function coordinate(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    return fail("INVALID_INPUT", "Coordinates must be finite numbers.");
  return Math.max(0, Math.min(1, value));
}
type Row = Record<string, any>;
const LOCAL_SCHEMA_VERSION = 1;

/** A single-process development provider. Every sensitive mutation rechecks current grants. */
export class LocalStore {
  readonly db: DatabaseSync;
  private now: () => number;
  private accessListeners = new Set<(event: AccessEvent) => void>();
  private boardListeners = new Set<(event: BoardEvent) => void>();
  constructor(options: { path?: string; now?: () => number } = {}) {
    const path = options.path ?? ".data/third-space.sqlite";
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.now = options.now ?? Date.now;
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,avatar TEXT NOT NULL,preferences TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES profiles(id),expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS homes(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES profiles(id),capacity INTEGER NOT NULL DEFAULT ${GAME_CONFIG.partyCapacity},settings_revision INTEGER NOT NULL DEFAULT 1,pin_verifier TEXT,pin_version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS members(home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),role TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',PRIMARY KEY(home_id,user_id));
      CREATE INDEX IF NOT EXISTS members_user ON members(user_id,status,home_id);
      CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,home_id TEXT NOT NULL REFERENCES homes(id),token_hash TEXT UNIQUE NOT NULL,expires_at INTEGER NOT NULL,max_uses INTEGER NOT NULL,use_count INTEGER NOT NULL DEFAULT 0,revoked_at INTEGER);
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),kind TEXT NOT NULL,invite_id TEXT REFERENCES invites(id),pin_version INTEGER,revoked_at INTEGER);
      CREATE INDEX IF NOT EXISTS grants_access ON grants(home_id,user_id,revoked_at);
      CREATE INDEX IF NOT EXISTS grants_invite ON grants(invite_id);
      CREATE TABLE IF NOT EXISTS tickets(token_hash TEXT PRIMARY KEY,home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),expires_at INTEGER NOT NULL,consumed_at INTEGER);
      CREATE TABLE IF NOT EXISTS rate_limits(key_hash TEXT NOT NULL,window INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(key_hash,window));
      CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,home_id TEXT NOT NULL REFERENCES homes(id),author_id TEXT NOT NULL REFERENCES profiles(id),author_label TEXT NOT NULL,text TEXT NOT NULL,link TEXT,x REAL NOT NULL,y REAL NOT NULL,revision INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS notes_home ON notes(home_id,deleted,updated_at);
      CREATE TABLE IF NOT EXISTS idempotency(home_id TEXT NOT NULL,user_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,note_id TEXT NOT NULL REFERENCES notes(id),PRIMARY KEY(home_id,user_id,request_id));
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,home_id TEXT,actor_id TEXT,action TEXT NOT NULL,target_id TEXT,created_at INTEGER NOT NULL);
    `);
    this.transaction(() => {
      const version = Number(this.one("PRAGMA user_version")!.user_version);
      if (version < LOCAL_SCHEMA_VERSION) {
        // Version-zero databases used a fixed four-person default. Apply this
        // once, so future intentional capacity settings survive restarts.
        this.run(
          "UPDATE homes SET capacity=?,settings_revision=settings_revision+1 WHERE capacity=4",
          GAME_CONFIG.partyCapacity,
        );
        this.db.exec(`PRAGMA user_version=${LOCAL_SCHEMA_VERSION}`);
      }
    });
    // A fresh process may never admit a ticket minted by an old live authority.
    this.db.prepare("DELETE FROM tickets").run();
  }
  close() {
    this.db.close();
  }
  private one(
    sql: string,
    ...params: (string | number | null)[]
  ): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  private all(sql: string, ...params: (string | number | null)[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  private run(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).run(...params);
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private audit(
    homeId: string,
    actorId: string,
    action: string,
    targetId: string | null = null,
  ) {
    this.run(
      "INSERT INTO audit VALUES(?,?,?,?,?,?)",
      randomUUID(),
      homeId,
      actorId,
      action,
      targetId,
      this.now(),
    );
  }
  onAccessChanged(listener: (event: AccessEvent) => void): () => void {
    this.accessListeners.add(listener);
    return () => this.accessListeners.delete(listener);
  }
  onBoardChanged(listener: (event: BoardEvent) => void): () => void {
    this.boardListeners.add(listener);
    return () => this.boardListeners.delete(listener);
  }
  private accessChanged(event: AccessEvent) {
    for (const fn of this.accessListeners) {
      try {
        fn(event);
      } catch {
        /* Reconciliation by caller is required. */
      }
    }
  }
  private boardChanged(note: BoardNote) {
    for (const fn of this.boardListeners) {
      try {
        fn({ homeId: note.homeId, noteId: note.id, revision: note.revision });
      } catch {
        /* Durable snapshot remains available. */
      }
    }
  }
  createIdentity(input: { name: unknown; avatar?: unknown }) {
    const id = randomUUID(),
      session = token();
    const name = text(input.name, 24, "name"),
      config =
        input.avatar === undefined ? DEFAULT_AVATAR : avatar(input.avatar);
    this.transaction(() => {
      this.run(
        "INSERT INTO profiles(id,name,avatar) VALUES(?,?,?)",
        id,
        name,
        JSON.stringify(config),
      );
      this.run(
        "INSERT INTO sessions VALUES(?,?,?)",
        hash(session),
        id,
        this.now() + 30 * 86400000,
      );
    });
    return { profile: this.getProfile(id)!, session };
  }
  getIdentity(session: string | undefined): Profile | undefined {
    if (!session || session.length > 128) return undefined;
    const row = this.one(
      "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
      hash(session),
      this.now(),
    );
    return row ? this.getProfile(row.user_id) : undefined;
  }
  getProfile(userId: string): Profile | undefined {
    const row = this.one("SELECT * FROM profiles WHERE id=?", userId);
    return row
      ? {
          id: row.id,
          userId: row.id,
          name: row.name,
          avatar: AvatarSchema.parse(JSON.parse(row.avatar)),
          preferences: JSON.parse(row.preferences),
          revision: row.revision,
          provider: "local",
        }
      : undefined;
  }
  updateProfile(userId: string, input: Record<string, unknown>): Profile {
    const current =
      this.getProfile(userId) ??
      fail("UNAUTHENTICATED", "Create a local profile first.", 401);
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== current.revision
    )
      return fail(
        "REVISION_CONFLICT",
        "Profile changed. Reload before saving.",
        409,
        { currentRevision: current.revision },
      );
    const name =
      input.name === undefined ? current.name : text(input.name, 24, "name");
    const config =
      input.avatar === undefined ? current.avatar : avatar(input.avatar);
    const prefs =
      input.preferences === undefined ? current.preferences : input.preferences;
    if (
      !prefs ||
      typeof prefs !== "object" ||
      Array.isArray(prefs) ||
      JSON.stringify(prefs).length > 8192
    )
      return fail(
        "INVALID_INPUT",
        "Preferences must be an object no larger than 8 KiB.",
      );
    this.run(
      "UPDATE profiles SET name=?,avatar=?,preferences=?,revision=revision+1 WHERE id=?",
      name,
      JSON.stringify(config),
      JSON.stringify(prefs),
      userId,
    );
    return this.getProfile(userId)!;
  }
  getHome(homeId: string): Home | undefined {
    const row = this.one("SELECT * FROM homes WHERE id=?", homeId);
    return row
      ? {
          id: row.id,
          name: row.name,
          ownerId: row.owner_id,
          capacity: row.capacity,
          settingsRevision: row.settings_revision,
          pinEnabled: !!row.pin_verifier,
        }
      : undefined;
  }
  getRole(homeId: string, userId: string): Role | undefined {
    return this.canAccess(homeId, userId)
      ? this.one(
          "SELECT role FROM members WHERE home_id=? AND user_id=? AND status='active'",
          homeId,
          userId,
        )?.role
      : undefined;
  }
  canAccess(homeId: string, userId: string): boolean {
    return !!this.one(
      `SELECT 1 FROM members m JOIN grants g ON g.home_id=m.home_id AND g.user_id=m.user_id JOIN homes h ON h.id=m.home_id LEFT JOIN invites i ON i.id=g.invite_id WHERE m.home_id=? AND m.user_id=? AND m.status='active' AND g.revoked_at IS NULL AND (g.kind IN ('owner','manual') OR (g.kind='pin' AND h.pin_verifier IS NOT NULL AND g.pin_version=h.pin_version) OR (g.kind='invite' AND i.revoked_at IS NULL)) LIMIT 1`,
      homeId,
      userId,
    );
  }
  requireAccess(homeId: string, userId: string): Home {
    if (!this.canAccess(homeId, userId))
      return fail("ACCESS_DENIED", "Home unavailable or access denied.", 404);
    return this.getHome(homeId)!;
  }
  private requireOwner(homeId: string, userId: string): Home {
    const home = this.requireAccess(homeId, userId);
    if (home.ownerId !== userId)
      return fail("ACCESS_DENIED", "Only the home owner can do that.", 403);
    return home;
  }
  createHome(userId: string, input: { name: unknown; pin?: unknown }): Home {
    if (!this.getProfile(userId))
      return fail("UNAUTHENTICATED", "Create a local profile first.", 401);
    const id = randomUUID(),
      name = text(input.name, 60, "home name"),
      verifier =
        input.pin === undefined || input.pin === ""
          ? null
          : pinVerifier(input.pin);
    this.transaction(() => {
      this.run(
        "INSERT INTO homes(id,name,owner_id,pin_verifier,capacity) VALUES(?,?,?,?,?)",
        id,
        name,
        userId,
        verifier,
        GAME_CONFIG.partyCapacity,
      );
      this.run("INSERT INTO members VALUES(?,?, 'owner','active')", id, userId);
      this.run(
        "INSERT INTO grants VALUES(?,?,?,'owner',NULL,NULL,NULL)",
        randomUUID(),
        id,
        userId,
      );
      this.audit(id, userId, "home.create");
    });
    return this.getHome(id)!;
  }
  listHomes(userId: string): (Home & { role: Role })[] {
    return this.all(
      "SELECT home_id,role FROM members WHERE user_id=? AND status='active'",
      userId,
    )
      .filter((r) => this.canAccess(r.home_id, userId))
      .map((r) => ({ ...this.getHome(r.home_id)!, role: r.role }));
  }
  listMembers(homeId: string, userId: string) {
    this.requireAccess(homeId, userId);
    return this.all(
      "SELECT user_id,role,status FROM members WHERE home_id=? AND status='active'",
      homeId,
    )
      .filter((r) => this.canAccess(homeId, r.user_id))
      .map((r) => ({
        userId: r.user_id,
        name: this.getProfile(r.user_id)!.name,
        avatar: this.getProfile(r.user_id)!.avatar,
        role: r.role,
      }));
  }
  /** Atomic persisted fixed-window limiter, before scrypt work. Failed attempts consume quota. */
  limit(key: string, maximum: number, windowMs = 900000) {
    const now = this.now(),
      window = Math.floor(now / windowMs) * windowMs;
    this.transaction(() => {
      this.run("DELETE FROM rate_limits WHERE window<?", now - 86400000);
      const row = this.one(
        "SELECT count FROM rate_limits WHERE key_hash=? AND window=?",
        hash(key),
        window,
      );
      if (row && row.count >= maximum)
        return fail(
          "RATE_LIMITED",
          "Too many attempts. Try again later.",
          429,
          { retryAfterMs: window + windowMs - now },
        );
      this.run(
        "INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET count=count+1",
        hash(key),
        window,
      );
    });
  }
  joinHome(
    homeId: string,
    userId: string,
    input: { pin?: unknown; inviteToken?: unknown },
    ip = "local",
  ): Home {
    if (!this.getProfile(userId))
      return fail("UNAUTHENTICATED", "Create a local profile first.", 401);
    if (this.canAccess(homeId, userId)) return this.getHome(homeId)!;
    this.limit(`join:user:${homeId}:${userId}`, 5);
    this.limit(`join:ip:${homeId}:${ip}`, 20);
    this.limit(`join:global:${ip}`, 100);
    const home = this.one("SELECT * FROM homes WHERE id=?", homeId);
    if (
      !home ||
      this.one(
        "SELECT 1 FROM members WHERE home_id=? AND user_id=? AND status='banned'",
        homeId,
        userId,
      )
    )
      return fail(
        "INVALID_CREDENTIAL",
        "Unable to join with those credentials.",
        403,
      );
    this.transaction(() => {
      let kind = "pin",
        inviteId: string | null = null,
        pinVersion: number | null = home.pin_version;
      if (
        typeof input.inviteToken === "string" &&
        input.inviteToken.length <= 128
      ) {
        const invite = this.one(
          "SELECT * FROM invites WHERE home_id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>? AND use_count<max_uses",
          homeId,
          hash(input.inviteToken),
          this.now(),
        );
        if (!invite)
          return fail(
            "INVALID_CREDENTIAL",
            "Unable to join with those credentials.",
            403,
          );
        kind = "invite";
        inviteId = invite.id;
        pinVersion = null;
        this.run(
          "UPDATE invites SET use_count=use_count+1 WHERE id=?",
          invite.id,
        );
      } else if (
        !home.pin_verifier ||
        !pinMatches(input.pin, home.pin_verifier)
      )
        return fail(
          "INVALID_CREDENTIAL",
          "Unable to join with those credentials.",
          403,
        );
      this.run(
        "INSERT INTO members(home_id,user_id,role,status) VALUES(?,?,'member','active') ON CONFLICT(home_id,user_id) DO UPDATE SET status='active'",
        homeId,
        userId,
      );
      this.run(
        "INSERT INTO grants VALUES(?,?,?,?,?,?,NULL)",
        randomUUID(),
        homeId,
        userId,
        kind,
        inviteId,
        pinVersion,
      );
      this.audit(homeId, userId, "home.join");
    });
    return this.getHome(homeId)!;
  }
  issueTicket(homeId: string, userId: string) {
    this.requireAccess(homeId, userId);
    this.limit(`ticket:${userId}`, 30, 60000);
    const raw = token();
    this.run(
      "INSERT INTO tickets VALUES(?,?,?,?,NULL)",
      hash(raw),
      homeId,
      userId,
      this.now() + 30000,
    );
    return { ticket: raw, homeId, expiresAt: this.now() + 30000 };
  }
  consumeTicket(raw: string): TicketIdentity {
    if (typeof raw !== "string" || raw.length > 128)
      return fail("INVALID_CREDENTIAL", "Invalid join ticket.", 403);
    return this.transaction(() => {
      const ticket = this.one(
        "SELECT * FROM tickets WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?",
        hash(raw),
        this.now(),
      );
      if (!ticket)
        return fail(
          "INVALID_CREDENTIAL",
          "Join ticket expired or already used.",
          403,
        );
      this.requireAccess(ticket.home_id, ticket.user_id);
      this.run(
        "UPDATE tickets SET consumed_at=? WHERE token_hash=?",
        this.now(),
        hash(raw),
      );
      const p = this.getProfile(ticket.user_id)!;
      return {
        userId: p.id,
        homeId: ticket.home_id,
        name: p.name,
        avatar: p.avatar,
        role: this.getRole(ticket.home_id, p.id)!,
      };
    });
  }
  createInvite(
    homeId: string,
    userId: string,
    input: { expiresInHours?: unknown; maxUses?: unknown } = {},
  ) {
    this.requireOwner(homeId, userId);
    const hours = input.expiresInHours ?? 168,
      maxUses = input.maxUses ?? 20;
    if (
      typeof hours !== "number" ||
      !Number.isFinite(hours) ||
      hours < 1 ||
      hours > 720 ||
      typeof maxUses !== "number" ||
      !Number.isInteger(maxUses) ||
      maxUses < 1 ||
      maxUses > 1000
    )
      return fail("INVALID_INPUT", "Invalid invite lifetime or use limit.");
    const id = randomUUID(),
      raw = token(),
      expiresAt = this.now() + hours * 3600000;
    this.run(
      "INSERT INTO invites VALUES(?,?,?,?,?,0,NULL)",
      id,
      homeId,
      hash(raw),
      expiresAt,
      maxUses,
    );
    this.audit(homeId, userId, "invite.create", id);
    return { id, inviteId: id, token: raw, homeId, expiresAt, maxUses };
  }
  listInvites(homeId: string, userId: string) {
    this.requireOwner(homeId, userId);
    return this.all(
      "SELECT id,expires_at,max_uses,use_count,revoked_at FROM invites WHERE home_id=?",
      homeId,
    ).map((r) => ({
      id: r.id,
      expiresAt: r.expires_at,
      maxUses: r.max_uses,
      useCount: r.use_count,
      revokedAt: r.revoked_at,
    }));
  }
  revokeInvite(homeId: string, userId: string, inviteId: string) {
    this.requireOwner(homeId, userId);
    const affected = this.all(
      "SELECT DISTINCT user_id FROM grants WHERE home_id=? AND invite_id=? AND revoked_at IS NULL",
      homeId,
      inviteId,
    ).map((r) => r.user_id as string);
    this.transaction(() => {
      const result = this.run(
        "UPDATE invites SET revoked_at=? WHERE id=? AND home_id=?",
        this.now(),
        inviteId,
        homeId,
      );
      if (!result.changes) return fail("NOT_FOUND", "Invite unavailable.", 404);
      this.run(
        "UPDATE grants SET revoked_at=? WHERE home_id=? AND invite_id=?",
        this.now(),
        homeId,
        inviteId,
      );
      this.audit(homeId, userId, "invite.revoke", inviteId);
    });
    this.accessChanged({ homeId, userIds: affected, reason: "invite.revoked" });
    return { revoked: true };
  }
  rotatePin(homeId: string, userId: string, pin: unknown) {
    this.requireOwner(homeId, userId);
    const verifier = pin === null || pin === "" ? null : pinVerifier(pin),
      affected = this.all(
        "SELECT DISTINCT user_id FROM grants WHERE home_id=? AND kind='pin' AND revoked_at IS NULL",
        homeId,
      ).map((r) => r.user_id as string);
    this.transaction(() => {
      this.run(
        "UPDATE homes SET pin_verifier=?,pin_version=pin_version+1,settings_revision=settings_revision+1 WHERE id=?",
        verifier,
        homeId,
      );
      this.run(
        "UPDATE grants SET revoked_at=? WHERE home_id=? AND kind='pin'",
        this.now(),
        homeId,
      );
      this.audit(homeId, userId, "pin.rotate");
    });
    this.accessChanged({ homeId, userIds: affected, reason: "pin.rotated" });
    return this.getHome(homeId)!;
  }
  banMember(homeId: string, actorId: string, targetId: string) {
    this.requireAccess(homeId, actorId);
    const actorRole = this.getRole(homeId, actorId),
      targetRole = this.getRole(homeId, targetId);
    if (
      actorId === targetId ||
      !["owner", "moderator"].includes(actorRole!) ||
      targetRole === "owner" ||
      (actorRole === "moderator" && targetRole === "moderator")
    )
      return fail("ACCESS_DENIED", "You cannot remove that participant.", 403);
    this.transaction(() => {
      if (
        !this.one(
          "SELECT 1 FROM members WHERE home_id=? AND user_id=?",
          homeId,
          targetId,
        )
      )
        return fail("NOT_FOUND", "Participant unavailable.", 404);
      this.run(
        "UPDATE members SET status='banned' WHERE home_id=? AND user_id=?",
        homeId,
        targetId,
      );
      this.run(
        "UPDATE grants SET revoked_at=? WHERE home_id=? AND user_id=?",
        this.now(),
        homeId,
        targetId,
      );
      this.audit(homeId, actorId, "member.ban", targetId);
    });
    this.accessChanged({
      homeId,
      userIds: [targetId],
      reason: "member.banned",
    });
    return { removed: true, enforcement: "committed" };
  }
  private note(row: Row): BoardNote {
    return {
      id: row.id,
      homeId: row.home_id,
      authorId: row.author_id,
      authorLabel: row.author_label,
      text: row.text,
      link: row.link,
      x: row.x,
      y: row.y,
      revision: row.revision,
      deleted: !!row.deleted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  getBoard(homeId: string): BoardNote[] {
    return this.all(
      "SELECT * FROM notes WHERE home_id=? AND deleted=0 ORDER BY created_at,id",
      homeId,
    ).map((r) => this.note(r));
  }
  private noteInput(input: Record<string, unknown>, current?: BoardNote) {
    return {
      text:
        input.text === undefined && current
          ? current.text
          : text(input.text, 1000),
      link:
        input.link === undefined && current
          ? current.link
          : safeLink(input.link),
      x: coordinate(input.x, current?.x ?? 0.5),
      y: coordinate(input.y, current?.y ?? 0.5),
    };
  }
  createNote(
    homeId: string,
    userId: string,
    input: Record<string, unknown>,
  ): BoardNote {
    this.requireAccess(homeId, userId);
    const requestId = text(input.requestId, 128, "requestId"),
      data = this.noteInput(input),
      fingerprint = hash(JSON.stringify(data));
    const result = this.transaction(() => {
      this.requireAccess(homeId, userId);
      const saved = this.one(
        "SELECT * FROM idempotency WHERE home_id=? AND user_id=? AND request_id=?",
        homeId,
        userId,
        requestId,
      );
      if (saved) {
        if (saved.payload_hash !== fingerprint)
          return fail(
            "IDEMPOTENCY_CONFLICT",
            "Request ID was already used for a different note.",
            409,
          );
        return this.note(
          this.one("SELECT * FROM notes WHERE id=?", saved.note_id)!,
        );
      }
      if (
        this.one(
          "SELECT COUNT(*) AS count FROM notes WHERE home_id=? AND deleted=0",
          homeId,
        )!.count >= 200
      )
        return fail("BOARD_FULL", "This board already has 200 notes.", 409);
      const id = randomUUID(),
        now = this.now();
      this.run(
        "INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,1,0,?,?)",
        id,
        homeId,
        userId,
        this.getProfile(userId)!.name,
        data.text,
        data.link,
        data.x,
        data.y,
        now,
        now,
      );
      this.run(
        "INSERT INTO idempotency VALUES(?,?,?,?,?)",
        homeId,
        userId,
        requestId,
        fingerprint,
        id,
      );
      return this.note(this.one("SELECT * FROM notes WHERE id=?", id)!);
    });
    this.boardChanged(result);
    return result;
  }
  updateNote(
    homeId: string,
    userId: string,
    noteId: string,
    input: Record<string, unknown>,
    remove = false,
  ): BoardNote {
    const result = this.transaction(() => {
      this.requireAccess(homeId, userId);
      const row = this.one(
        "SELECT * FROM notes WHERE id=? AND home_id=?",
        noteId,
        homeId,
      );
      if (!row) return fail("NOT_FOUND", "Note unavailable.", 404);
      const current = this.note(row);
      if (
        remove &&
        current.authorId !== userId &&
        !["owner", "moderator"].includes(this.getRole(homeId, userId)!)
      )
        return fail(
          "ACCESS_DENIED",
          "Only its author or a host can delete this note.",
          403,
        );
      if (
        !Number.isInteger(input.expectedRevision) ||
        input.expectedRevision !== current.revision ||
        current.deleted
      )
        return fail(
          "REVISION_CONFLICT",
          "Note changed. Merge your draft with the latest version.",
          409,
          { currentRevision: current.revision, current: current },
        );
      const data = remove ? current : this.noteInput(input, current);
      const changed = this.run(
        "UPDATE notes SET text=?,link=?,x=?,y=?,revision=revision+1,deleted=?,updated_at=? WHERE id=? AND home_id=? AND revision=?",
        data.text,
        data.link,
        data.x,
        data.y,
        remove ? 1 : 0,
        this.now(),
        noteId,
        homeId,
        current.revision,
      );
      if (!changed.changes)
        return fail("REVISION_CONFLICT", "Note changed.", 409);
      return this.note(this.one("SELECT * FROM notes WHERE id=?", noteId)!);
    });
    this.boardChanged(result);
    return result;
  }
}

export function createDataRouter(
  store: LocalStore,
  options: { allowedOrigins: string[]; secureCookies?: boolean },
): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!req.headers.origin ||
        !options.allowedOrigins.includes(req.headers.origin))
    )
      return res.status(403).json({
        error: {
          code: "ORIGIN_DENIED",
          message: "Request origin is not allowed.",
        },
      });
    next();
  });
  router.use(json({ limit: "16kb" }));
  const cookieName = "ts_local";
  const profile = (req: Request): Profile => {
    const match = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${cookieName}=`));
    const p = store.getIdentity(match?.slice(cookieName.length + 1));
    return p ?? fail("UNAUTHENTICATED", "Create a local profile first.", 401);
  };
  const route =
    (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        fn(req, res);
      } catch (e) {
        next(e);
      }
    };
  const param = (req: Request, key: string) => String(req.params[key]);
  router.post(
    "/identity",
    route((req, res) => {
      store.limit(`identity:${req.ip}`, 30, 60000);
      const current = (() => {
        try {
          return profile(req);
        } catch {
          return undefined;
        }
      })();
      if (current) return res.json({ profile: current });
      const { profile: p, session } = store.createIdentity(req.body ?? {});
      res.cookie(cookieName, session, {
        httpOnly: true,
        sameSite: "strict",
        secure: options.secureCookies ?? false,
        path: "/",
        maxAge: 30 * 86400000,
      });
      res.status(201).json({ profile: p });
    }),
  );
  router.get(
    "/identity",
    route((req, res) => res.json({ profile: profile(req) })),
  );
  router.patch(
    "/identity",
    route((req, res) =>
      res.json({
        profile: store.updateProfile(profile(req).id, req.body ?? {}),
      }),
    ),
  );
  router.post(
    "/homes",
    route((req, res) =>
      res
        .status(201)
        .json({ home: store.createHome(profile(req).id, req.body ?? {}) }),
    ),
  );
  router.get(
    "/homes",
    route((req, res) => res.json({ homes: store.listHomes(profile(req).id) })),
  );
  router.post(
    "/homes/:id/join",
    route((req, res) =>
      res.json({
        home: store.joinHome(
          param(req, "id"),
          profile(req).id,
          req.body ?? {},
          req.ip,
        ),
      }),
    ),
  );
  router.get(
    "/homes/:id",
    route((req, res) => {
      const p = profile(req),
        id = param(req, "id");
      const home = store.requireAccess(id, p.id);
      res.json({
        home,
        profile: p,
        role: store.getRole(id, p.id),
        members: store.listMembers(id, p.id),
        board: store.getBoard(id),
      });
    }),
  );
  router.post(
    "/homes/:id/ticket",
    route((req, res) =>
      res.json(store.issueTicket(param(req, "id"), profile(req).id)),
    ),
  );
  router.post(
    "/homes/:id/invites",
    route((req, res) =>
      res
        .status(201)
        .json(
          store.createInvite(param(req, "id"), profile(req).id, req.body ?? {}),
        ),
    ),
  );
  router.get(
    "/homes/:id/invites",
    route((req, res) =>
      res.json({
        invites: store.listInvites(param(req, "id"), profile(req).id),
      }),
    ),
  );
  router.delete(
    "/homes/:id/invites/:inviteId",
    route((req, res) =>
      res.json(
        store.revokeInvite(
          param(req, "id"),
          profile(req).id,
          param(req, "inviteId"),
        ),
      ),
    ),
  );
  router.put(
    "/homes/:id/pin",
    route((req, res) =>
      res.json({
        home: store.rotatePin(param(req, "id"), profile(req).id, req.body?.pin),
      }),
    ),
  );
  router.delete(
    "/homes/:id/members/:userId",
    route((req, res) =>
      res.json(
        store.banMember(
          param(req, "id"),
          profile(req).id,
          param(req, "userId"),
        ),
      ),
    ),
  );
  router.get(
    "/homes/:id/board",
    route((req, res) => {
      store.requireAccess(param(req, "id"), profile(req).id);
      res.json({ notes: store.getBoard(param(req, "id")) });
    }),
  );
  router.post(
    "/homes/:id/board",
    route((req, res) =>
      res.status(201).json({
        note: store.createNote(
          param(req, "id"),
          profile(req).id,
          req.body ?? {},
        ),
      }),
    ),
  );
  router.patch(
    "/homes/:id/board/:noteId",
    route((req, res) =>
      res.json({
        note: store.updateNote(
          param(req, "id"),
          profile(req).id,
          param(req, "noteId"),
          req.body ?? {},
        ),
      }),
    ),
  );
  router.delete(
    "/homes/:id/board/:noteId",
    route((req, res) =>
      res.json({
        note: store.updateNote(
          param(req, "id"),
          profile(req).id,
          param(req, "noteId"),
          req.body ?? {},
          true,
        ),
      }),
    ),
  );
  router.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof DataError)
        return res.status(err.status).json({
          error: { code: err.code, message: err.message, ...err.details },
        });
      const e = err as { type?: string };
      if (e.type === "entity.too.large")
        return res.status(413).json({
          error: {
            code: "BODY_TOO_LARGE",
            message: "Request exceeds 16 KiB.",
          },
        });
      if (e.type === "entity.parse.failed")
        return res
          .status(400)
          .json({ error: { code: "INVALID_INPUT", message: "Invalid JSON." } });
      return res.status(500).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Data operation failed.",
        },
      });
    },
  );
  return router;
}
