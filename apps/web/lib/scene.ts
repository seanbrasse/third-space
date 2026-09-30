import * as Phaser from "phaser";
import type { WorldBridge, Player } from "./types";
import {
  HOME_MAP,
  RACE_MAP,
  type Furniture,
  type Point,
} from "@third-space/config";
import {
  stepHome,
  stepRace,
  findHomePath,
  isHomeSegmentWalkable,
} from "@third-space/simulation";
import type { PlayerInput } from "@third-space/contracts";
import { avatarPixelCanvas, furnitureCanvas } from "./pixel-art";
import { homeFloorCanvas } from "./home-art";
import { cameraFollowX, decayCorrection } from "./presentation";
const AVATAR_SCALE = 1.65,
  AVATAR_HEAD = 32 * AVATAR_SCALE + 7;
const TILE = 32,
  W = HOME_MAP.width * TILE,
  H = HOME_MAP.height * TILE;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
type Node = {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  texture: string;
};
function snapshotSeats(bridge: WorldBridge, selfId: string) {
  return (
    bridge.snapshot?.players
      .filter((p) => p.id !== selfId && p.seatId)
      .map((p) => p.seatId!) || []
  );
}
export async function createWorld(parent: HTMLElement, bridge: WorldBridge) {
  class HomeScene extends Phaser.Scene {
    private nodes = new Map<string, Node>();
    private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
    private hoveredId = "";
    private clickedId = "";
    private seq = 0;
    private lastInput = 0;
    private currentMode = "";
    private mapObjects: Phaser.GameObjects.GameObject[] = [];
    private prediction: Player | null = null;
    private authoritativeTime = 0;
    private inputHistory: { input: PlayerInput; dt: number }[] = [];
    private correction = { x: 0, y: 0 };
    private path: Point[] = [];
    private destination: Point | null = null;
    private pendingInteraction = "";
    private target!: Phaser.GameObjects.Graphics;
    private marker!: Phaser.GameObjects.Graphics;
    private prompt!: Phaser.GameObjects.Text;
    private hoveredFurniture: Furniture | null = null;
    private textureIds = new Map<string, string>();
    constructor() {
      super("home");
    }
    create() {
      this.cameras.main.setBackgroundColor("#e8e6d8").setRoundPixels(true);
      if (this.input.keyboard) {
        this.keys = this.input.keyboard.addKeys(
          "W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E,ESC",
          false,
        ) as typeof this.keys;
        this.input.keyboard.on("keydown-E", () => this.interact());
        this.input.keyboard.on("keydown-ESC", () => {
          this.cancelWalk();
          this.clickedId = "";
        });
      }
      this.target = this.add.graphics().setDepth(1);
      this.marker = this.add.graphics().setDepth(900);
      this.prompt = this.add
        .text(0, 0, "", {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#f8efda",
          backgroundColor: "#403a43",
          padding: { x: 6, y: 4 },
        })
        .setOrigin(0.5, 1)
        .setDepth(2100)
        .setVisible(false);
      this.input.on(
        "pointerdown",
        (
          pointer: Phaser.Input.Pointer,
          objects: Phaser.GameObjects.GameObject[],
        ) => {
          if (objects.length || bridge.blocked || this.currentMode !== "home")
            return;
          this.clickedId = "";
          this.walkTo({ x: pointer.worldX / TILE, y: pointer.worldY / TILE });
        },
      );
      this.scale.on("resize", () => this.fit());
      this.drawHome();
      this.fit();
    }
    fit() {
      const race = this.currentMode === "race";
      const width = this.scale.width,
        height = this.scale.height;
      this.cameras.main
        .setViewport(0, 0, width, height)
        .setZoom(
          Math.min(
            width / (race ? 800 : W),
            height / (race ? RACE_MAP.height * TILE : H),
          ),
        );
      if (!race) this.cameras.main.centerOn(W / 2, H / 2);
    }
    clearMap() {
      for (const object of this.mapObjects) object.destroy();
      this.mapObjects = [];
      this.hoveredFurniture = null;
      this.prompt.setVisible(false);
    }
    texture(key: string, canvas: HTMLCanvasElement) {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, canvas);
      return key;
    }
    drawHome() {
      this.clearMap();
      const canvas = homeFloorCanvas(TILE);
      this.mapObjects.push(
        this.add
          .image(0, 0, this.texture("home-floor-v2", canvas))
          .setOrigin(0)
          .setDepth(0),
      );
      for (const item of HOME_MAP.furniture) {
        if (item.kind === "rug") continue;
        const f = item.footprint;
        const kind = item.kind === "bookcase" ? "bookshelf" : item.kind;
        const image = this.add
          .image(
            f.x * TILE,
            f.y * TILE,
            this.texture(
              `furniture:${item.id}`,
              furnitureCanvas(
                kind,
                Math.round(f.width * TILE),
                Math.round(f.height * TILE),
                item.id,
              ),
            ),
          )
          .setOrigin(0)
          .setDepth((f.y + f.height - 0.4) * TILE);
        this.mapObjects.push(image);
        if (!item.usePoints.length) continue;
        image.setInteractive({ useHandCursor: true });
        image.on("pointerover", () => {
          this.hoveredFurniture = item;
          image.setTint(0xffefc7);
        });
        image.on("pointerout", () => {
          if (this.hoveredFurniture === item) this.hoveredFurniture = null;
          image.clearTint();
        });
        image.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          if (!bridge.blocked)
            this.useFurniture(item, {
              x: pointer.worldX / TILE,
              y: pointer.worldY / TILE,
            });
        });
      }
      for (const [x, y, kind] of [
        [1.5, 3.2, "plant"],
        [17.5, 16.5, "plant"],
        [2, 12, "plant"],
        [7.3, 5.1, "lamp"],
      ] as const) {
        const h = kind === "plant" ? 48 : 42;
        this.mapObjects.push(
          this.add
            .image(
              x * TILE,
              y * TILE,
              this.texture(`decor:${kind}`, furnitureCanvas(kind, 24, h)),
            )
            .setOrigin(0)
            .setDepth(y * TILE + h),
        );
      }
      for (const [x, y, t] of [
        [9.5, 2.1, "IDEAS"],
        [17, 15.2, "GARDEN DASH"],
        [4.5, 2.8, "TV · SOON"],
      ] as const) {
        this.mapObjects.push(
          this.add
            .text(x * TILE, y * TILE, t, {
              fontFamily: "monospace",
              fontSize: "8px",
              color: "#ead0a2",
              backgroundColor: "#432b29",
              padding: { x: 3, y: 2 },
            })
            .setOrigin(0.5)
            .setDepth(2),
        );
      }
    }
    drawRace() {
      this.clearMap();
      const g = this.add.graphics().setDepth(0);
      this.mapObjects.push(g);
      const r = (x: number, y: number, w: number, h: number, c: number) => {
        g.fillStyle(c);
        g.fillRect(x, y, w, h);
      };
      r(0, 0, RACE_MAP.width * TILE, RACE_MAP.height * TILE, 0xb6d4c5);
      for (let i = 0; i < 65; i++) {
        const x = i * 180;
        r(x + 35, 55 + (i % 3) * 24, 90, 12, 0xe9e7cf);
        r(x + 47, 47 + (i % 3) * 24, 63, 12, 0xe9e7cf);
        r(x, 12 * TILE, 120, 4 * TILE, 0x96b691);
        r(x + 35, 11 * TILE, 60, 5 * TILE, 0x96b691);
        r(x + 12, 13 * TILE, 70, 3 * TILE, 0x729b78);
      }
      for (const p of RACE_MAP.platforms) {
        r(p.x * TILE, p.y * TILE, p.width * TILE, p.height * TILE, 0x88674e);
        r(p.x * TILE, p.y * TILE, p.width * TILE, 6, 0x4e7954);
        r(p.x * TILE, p.y * TILE, p.width * TILE, 3, 0xa6bb78);
        for (let x = p.x * TILE + 4; x < (p.x + p.width) * TILE; x += 24) {
          r(x, p.y * TILE + 15, 7, 3, 0xa5825c);
          r(x + 9, p.y * TILE + 30, 6, 2, 0x6e523f);
          r(x + 2, p.y * TILE + 4, 1, 3, 0xcad28f);
        }
      }
      for (const h of RACE_MAP.hazards)
        for (let x = h.x * TILE; x < (h.x + h.width) * TILE; x += 8) {
          g.fillStyle(0x99545b);
          g.fillTriangle(
            x,
            (h.y + h.height) * TILE,
            x + 4,
            h.y * TILE,
            x + 8,
            (h.y + h.height) * TILE,
          );
        }
      for (const [i, p] of [
        ...RACE_MAP.checkpoints,
        RACE_MAP.finish,
      ].entries()) {
        r(p.x * TILE, 14 * TILE, 3, 2 * TILE, 0x4b654d);
        r(p.x * TILE + 3, 14 * TILE, 28, 18, i === 4 ? 0xe6c371 : 0xb399ba);
        this.mapObjects.push(
          this.add
            .text(
              p.x * TILE,
              14 * TILE - 15,
              i === 4 ? "FINISH" : `CHECKPOINT ${i + 1}`,
              { fontFamily: "monospace", fontSize: "8px", color: "#405d4a" },
            )
            .setDepth(1),
        );
      }
    }
    cancelWalk() {
      this.path = [];
      this.destination = null;
      this.pendingInteraction = "";
    }
    walkTo(goal: Point, interaction = "") {
      const self = this.prediction;
      if (!self || self.mode !== "home") return;
      const path = findHomePath(self, goal);
      if (!path) {
        this.cancelWalk();
        this.prompt
          .setText("Choose a clear spot on the floor")
          .setPosition(self.x * TILE, self.y * TILE - 35)
          .setVisible(true);
        this.time.delayedCall(1600, () => {
          if (!this.hoveredFurniture) this.prompt.setVisible(false);
        });
        return;
      }
      this.path = path;
      this.destination = goal;
      this.pendingInteraction = interaction;
    }
    useFurniture(item: Furniture, clicked?: Point) {
      const self = this.prediction;
      if (!self) return;
      const occupied = new Set(
        bridge.snapshot?.players
          .filter((p) => p.id !== self.id && p.seatId)
          .map((p) => p.seatId),
      );
      const options = item.seats.length
        ? item.seats
            .filter((s) => !occupied.has(s.id))
            .map((s) => ({ ...s, action: `seat:${s.id}` }))
        : item.usePoints.map((p) => ({ ...p, action: item.kind }));
      options.sort(
        (a, b) => distance(clicked || self, a) - distance(clicked || self, b),
      );
      const selected = options[0];
      if (!selected) return;
      this.clickedId = "";
      this.walkTo(selected, selected.action);
    }
    interact() {
      if (
        bridge.blocked ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (document.activeElement as HTMLElement)?.tagName,
        )
      )
        return;
      const self = bridge.snapshot?.players.find((p) => p.id === bridge.selfId);
      if (!self) return;
      if (self.mode === "race") {
        bridge.touch.jump = true;
        return;
      }
      this.cancelWalk();
      if (self.seatId) {
        bridge.send({ type: "seat", seatId: null });
        return;
      }
      const occupied = new Set(snapshotSeats(bridge, self.id));
      const candidates = HOME_MAP.furniture
        .flatMap<Point & { action: string }>((item) =>
          item.seats.length
            ? item.seats
                .filter((s) => !occupied.has(s.id))
                .map((s) => ({ ...s, action: `seat:${s.id}` }))
            : item.usePoints.map((p) => ({ ...p, action: item.kind })),
        )
        .filter((point) => isHomeSegmentWalkable(self, point))
        .sort((a, b) => distance(self, a) - distance(self, b));
      if (candidates[0] && distance(self, candidates[0]) <= 1.5)
        bridge.interact(candidates[0].action);
    }
    avatarTexture(player: Player, frame: number) {
      const signature =
        JSON.stringify(player.avatar) + player.facing + frame + !!player.seatId;
      let key = this.textureIds.get(signature);
      if (!key) {
        key = `avatar:${this.textureIds.size}`;
        this.textureIds.set(signature, key);
        this.texture(
          key,
          avatarPixelCanvas(
            player.avatar,
            player.facing,
            frame,
            !!player.seatId,
          ),
        );
      }
      return key;
    }
    update(time: number, delta: number) {
      const snapshot = bridge.snapshot;
      if (!snapshot) return;
      const self = snapshot.players.find((p) => p.id === bridge.selfId);
      const mode = self?.mode || "home";
      if (mode !== this.currentMode) {
        this.currentMode = mode;
        this.cancelWalk();
        this.inputHistory = [];
        this.correction = { x: 0, y: 0 };
        this.prediction = null;
        mode === "race" ? this.drawRace() : this.drawHome();
        this.fit();
      }
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
        (document.activeElement as HTMLElement)?.tagName,
      );
      const active =
        !bridge.blocked &&
        !typing &&
        document.visibilityState === "visible" &&
        !!self?.connected;
      if (!active) this.cancelWalk();
      if (self && snapshot.serverTime !== this.authoritativeTime) {
        this.authoritativeTime = snapshot.serverTime;
        this.seq = Math.max(this.seq, self.lastInputSeq);
        const previous = this.prediction
          ? {
              x: this.prediction.x + this.correction.x,
              y: this.prediction.y + this.correction.y,
            }
          : null;
        this.prediction = { ...self, avatar: { ...self.avatar } };
        this.inputHistory = this.inputHistory.filter(
          (h) => h.input.seq > self.lastInputSeq,
        );
        for (const h of this.inputHistory) {
          if (mode === "race" && snapshot.race?.phase === "running")
            this.prediction = stepRace(this.prediction, h.input, h.dt);
          else if (mode === "home")
            this.prediction = stepHome(this.prediction, h.input, h.dt);
        }
        this.correction =
          previous && distance(previous, this.prediction) < 3 && !self.seatId
            ? {
                x: previous.x - this.prediction.x,
                y: previous.y - this.prediction.y,
              }
            : { x: 0, y: 0 };
      }
      let axisX = active
        ? Number(this.keys.D?.isDown || this.keys.RIGHT?.isDown) -
            Number(this.keys.A?.isDown || this.keys.LEFT?.isDown) ||
          bridge.touch.axisX
        : 0;
      let axisY = active
        ? Number(this.keys.S?.isDown || this.keys.DOWN?.isDown) -
            Number(this.keys.W?.isDown || this.keys.UP?.isDown) ||
          bridge.touch.axisY
        : 0;
      if (axisX || axisY) this.cancelWalk();
      if (active && this.prediction && this.path.length) {
        while (
          this.path.length &&
          distance(this.prediction, this.path[0]) < 0.085
        )
          this.path.shift();
        if (this.path.length) {
          const point = this.path[0],
            dx = point.x - this.prediction.x,
            dy = point.y - this.prediction.y,
            len = Math.hypot(dx, dy);
          axisX = dx / Math.max(len, 0.001);
          axisY = dy / Math.max(len, 0.001);
        } else {
          const action = this.pendingInteraction;
          this.cancelWalk();
          if (action) bridge.interact(action);
        }
      }
      const jump = active && (!!this.keys.SPACE?.isDown || bridge.touch.jump);
      if (this.prediction) {
        const input = { seq: this.seq, axisX, axisY, jump };
        if (mode === "race" && snapshot.race?.phase === "running")
          this.prediction = stepRace(
            this.prediction,
            input,
            Math.min(delta / 1000, 0.04),
          );
        else if (mode === "home")
          this.prediction = stepHome(
            this.prediction,
            input,
            Math.min(delta / 1000, 0.04),
          );
      }
      this.correction.x = decayCorrection(
        this.correction.x,
        delta,
        bridge.reducedMotion,
      );
      this.correction.y = decayCorrection(
        this.correction.y,
        delta,
        bridge.reducedMotion,
      );
      const ids = new Set(
        snapshot.players.filter((p) => p.mode === mode).map((p) => p.id),
      );
      for (const [id, node] of this.nodes)
        if (!ids.has(id)) {
          node.sprite.destroy();
          node.label.destroy();
          node.bubble.destroy();
          this.nodes.delete(id);
        }
      let visibleNames = 0;
      for (const remote of snapshot.players.filter((p) => p.mode === mode)) {
        const local = remote.id === bridge.selfId,
          p = local && this.prediction ? this.prediction : remote;
        const walking = local
          ? !!(axisX || axisY)
          : Math.hypot(p.vx, p.vy) > 0.1;
        const frame = walking && !p.seatId ? Math.floor(time / 140) % 4 : 0;
        const texture = this.avatarTexture(p, frame);
        let node = this.nodes.get(p.id);
        if (!node) {
          node = {
            sprite: this.add
              .image(p.x * TILE, p.y * TILE, texture)
              .setOrigin(0.5, 0.94)
              .setScale(AVATAR_SCALE)
              .setInteractive({ useHandCursor: true }),
            label: this.add
              .text(0, 0, "", {
                fontFamily: "monospace",
                fontSize: "10px",
                color: "#f9f0d9",
                backgroundColor: "#403a43",
                padding: { x: 5, y: 3 },
              })
              .setOrigin(0.5, 1)
              .setDepth(2000)
              .setVisible(false),
            bubble: this.add
              .text(0, 0, "", {
                fontFamily: "sans-serif",
                fontSize: "11px",
                color: "#403c42",
                backgroundColor: "#fff7e2",
                wordWrap: { width: 130 },
                padding: { x: 6, y: 4 },
              })
              .setOrigin(0.5, 1)
              .setDepth(2001),
            texture,
          };
          node.sprite.on("pointerover", () => {
            this.hoveredId = p.id;
          });
          node.sprite.on("pointerout", () => {
            if (this.hoveredId === p.id) this.hoveredId = "";
          });
          node.sprite.on("pointerdown", () => {
            if (bridge.blocked) return;
            this.cancelWalk();
            this.clickedId = p.id;
            if (!local) bridge.selectPerson(p.id);
          });
          this.nodes.set(p.id, node);
        }
        if (node.texture !== texture) {
          node.sprite.setTexture(texture);
          node.texture = texture;
        }
        const rendered = {
          x: p.x + (local ? this.correction.x : 0),
          y: p.y + (local ? this.correction.y : 0),
        };
        if (local && mode === "home" && !isHomeSegmentWalkable(p, rendered)) {
          this.correction = { x: 0, y: 0 };
          rendered.x = p.x;
          rendered.y = p.y;
        }
        const x = rendered.x * TILE,
          y = rendered.y * TILE;
        const fraction =
          local || bridge.reducedMotion ? 1 : 1 - Math.exp(-delta / 65);
        node.sprite.x += (x - node.sprite.x) * fraction;
        node.sprite.y += (y - node.sprite.y) * fraction;
        node.sprite
          .setDepth(node.sprite.y + (local ? 0.01 : 0))
          .setAlpha(p.connected ? (mode === "race" && !local ? 0.78 : 1) : 0.4);
        const showName = this.hoveredId === p.id || this.clickedId === p.id;
        node.label
          .setText(`${p.name} · ${local ? "You" : "Click to interact"}`)
          .setPosition(node.sprite.x, node.sprite.y - AVATAR_HEAD)
          .setVisible(showName);
        if (showName) visibleNames++;
        const messages = snapshot.chat.filter(
          (m) =>
            bridge.liveBubbleIds.has(m.id) &&
            m.senderId === p.id &&
            !bridge.mutedText.has(p.id) &&
            Date.now() - (m.createdAt || 0) < 8000,
        );
        node.bubble
          .setPosition(
            node.sprite.x,
            node.sprite.y - (showName ? AVATAR_HEAD + 26 : AVATAR_HEAD),
          )
          .setText(
            bridge.bubbles
              ? messages
                  .slice(-2)
                  .map((m) => m.text)
                  .join("\n")
              : "",
          )
          .setVisible(bridge.bubbles && messages.length > 0);
      }
      const localNode = this.nodes.get(bridge.selfId);
      this.marker.clear();
      if (localNode) {
        this.marker.lineStyle(1, 0xf8e0a0, 1);
        this.marker.strokeEllipse(
          localNode.sprite.x,
          localNode.sprite.y + 1,
          36,
          12,
        );
        this.marker.fillStyle(0xeac36f);
        this.marker.fillTriangle(
          localNode.sprite.x - 3,
          localNode.sprite.y - AVATAR_HEAD - 2,
          localNode.sprite.x + 3,
          localNode.sprite.y - AVATAR_HEAD - 2,
          localNode.sprite.x,
          localNode.sprite.y - AVATAR_HEAD + 3,
        );
        if (mode === "race")
          this.cameras.main.centerOn(
            cameraFollowX(
              localNode.sprite.x,
              RACE_MAP.width * TILE,
              this.scale.width / this.cameras.main.zoom,
            ),
            (RACE_MAP.height * TILE) / 2,
          );
      }
      this.target.clear();
      if (this.destination) {
        this.target.lineStyle(1, 0xf7e6b6);
        this.target.strokeEllipse(
          this.destination.x * TILE,
          this.destination.y * TILE,
          14,
          7,
        );
      }
      if (this.hoveredFurniture) {
        const f = this.hoveredFurniture.footprint;
        const text = this.hoveredFurniture.seats.length
          ? "Click to sit"
          : this.hoveredFurniture.kind === "portal"
            ? "Click to play Garden Dash"
            : this.hoveredFurniture.kind === "board"
              ? "Click to open the idea board"
              : "Click to explore";
        this.prompt
          .setText(text)
          .setPosition((f.x + f.width / 2) * TILE, f.y * TILE - 4)
          .setVisible(true);
      } else if (this.prompt.text.startsWith("Click"))
        this.prompt.setVisible(false);
      const camera = this.cameras.main;
      Object.assign(parent.dataset, {
        localId: bridge.selfId,
        avatarScale: String(AVATAR_SCALE),
        avatarHeight: String(32 * AVATAR_SCALE),
        roomTheme: "walnut-velvet",
        selfAvatar: JSON.stringify(self?.avatar || {}),
        seatId: self?.seatId || "",
        authoritativeX: String(self?.x || 0),
        authoritativeY: String(self?.y || 0),
        renderX: String((localNode?.sprite.x || 0) / TILE),
        renderY: String((localNode?.sprite.y || 0) / TILE),
        cameraScrollX: String(
          camera.scrollX + camera.width / 2 - camera.width / (2 * camera.zoom),
        ),
        cameraScrollY: String(
          camera.scrollY +
            camera.height / 2 -
            camera.height / (2 * camera.zoom),
        ),
        cameraZoom: String(camera.zoom),
        tileSize: String(TILE),
        worldWidth: String(mode === "home" ? HOME_MAP.width : RACE_MAP.width),
        worldHeight: String(
          mode === "home" ? HOME_MAP.height : RACE_MAP.height,
        ),
        hoveredPlayerId: this.hoveredId,
        visibleNameCount: String(visibleNames),
        moveTargetX: this.destination ? String(this.destination.x) : "",
        moveTargetY: this.destination ? String(this.destination.y) : "",
      });
      if (time - this.lastInput > 33 && self) {
        const dt = Math.min((time - this.lastInput) / 1000, 0.05);
        this.lastInput = time;
        const input = { seq: ++this.seq, axisX, axisY, jump };
        this.inputHistory.push({ input, dt });
        if (this.inputHistory.length > 100) this.inputHistory.shift();
        bridge.send({ type: "input", input });
        bridge.touch.jump = false;
      }
      for (const effect of bridge.effects.splice(0)) {
        const p = snapshot.players.find((p) => p.id === effect.sourceId);
        if (!p || p.mode !== mode) continue;
        const emoji =
          (
            {
              wave: "👋",
              heart: "♥",
              laugh: "☺",
              dance: "♫",
              "high-five": "✋",
              poke: "☞",
            } as Record<string, string>
          )[effect.assetId] || "✦";
        const text = this.add
          .text(p.x * TILE, p.y * TILE - 50, emoji, {
            fontSize: "22px",
            color: "#c87e7f",
          })
          .setOrigin(0.5)
          .setDepth(3000);
        if (bridge.reducedMotion)
          this.time.delayedCall(1300, () => text.destroy());
        else
          this.tweens.add({
            targets: text,
            y: p.y * TILE - 75,
            alpha: 0,
            duration: 1600,
            onComplete: () => text.destroy(),
          });
      }
    }
  }
  return new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: parent.clientWidth,
    height: parent.clientHeight,
    pixelArt: true,
    antialias: false,
    scene: HomeScene,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { roundPixels: true },
    audio: { noAudio: true },
  });
}
