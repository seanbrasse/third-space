import { mimicSpriteCanvas } from "./mimic-art";
import { mimicPresentation } from "./mimic-presentation";
import { chatTextMetrics } from "./chat-presentation";
import { darknessFill } from "./forest-visibility";
import { FOREST_TORCHES, torchLight, torchSpriteCanvas } from "./forest-torches";
import { ASYLUM_WAYFINDING_LIGHTS, asylumChargerCanvas } from "./asylum-wayfinding";
import { RacePresentation } from "./race-presentation";
import { InputSequence } from "./input-sequence";
import { GameKeyboard, isGameInputBlocked } from "./game-keyboard";
import {asylumFloorCanvas,asylumObjectCanvas} from "./asylum-art";
import * as Phaser from "phaser";
import type { WorldBridge, Player } from "./types";
import {
  HOME_MAP,
  getWorld,
  RACE_MAP,
  type Furniture,
  type Point,
} from "@third-space/config";
import {
  stepHome,

  stepRace,
  findHomePath,
  isHomeSegmentWalkable,
  isHomeWalkable,
} from "@third-space/simulation";
import type { PlayerInput } from "@third-space/contracts";
import { avatarPixelCanvas, furnitureCanvas } from "./pixel-art";
import { homeFloorCanvas } from "./home-art";
import { cameraFollowX, decayCorrection } from "./presentation";
import { clownGreetingPresentation, greetingViewportPoint } from "./clown-greeting";
import { werewolfLeapPresentation } from "./werewolf-leap-presentation";
import { werewolfSpriteCanvas } from "./werewolf-art";
import { forestFloorCanvas, forestObjectCanvas, flashlightContains, clownSpriteCanvas } from "./forest-art";
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
    private racePresentation: RacePresentation | null = null;
    private nodes = new Map<string, Node>();
    private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
    private movement = new GameKeyboard();
    private snapshotReceivedAt = 0;
    private currentInstance = "";
    private hoveredId = "";
    private clickedId = "";
    private seq = 0;
    private inputSequence = new InputSequence();
    private lastInput = 0;
    private currentMode = "";
    private currentWorld = "";
    private currentRevision = -1;
    private stalkerSprite: Phaser.GameObjects.Image | null = null;
    private stalkerId="";
    private clownGreeting: Phaser.GameObjects.Text | null = null;
    private mimicAvatar: Phaser.GameObjects.Image | null = null;
    private mimicMonster: Phaser.GameObjects.Image | null = null;
    private werewolfSprite: Phaser.GameObjects.Image | null = null;
    private werewolfId="";
    private werewolfFeet: Point | null = null;
    private werewolfLeapTell: Phaser.GameObjects.Graphics | null = null;
    private pathTorches: Phaser.GameObjects.Image[] = [];
    private fireArt: Phaser.GameObjects.Graphics | null = null;
    private roastArt: Phaser.GameObjects.Graphics | null = null;
    private lightImage: Phaser.GameObjects.Image | null = null;
    private lightCanvas: HTMLCanvasElement | null = null;
    private lastLightAt = 0;
    private get map() { return getWorld(bridge.snapshot?.worldId || "living-room").map; }
    private get dark(){return getWorld(bridge.snapshot?.worldId).dark&&this.currentMode!=="race";}
    private get forest() { return bridge.snapshot?.worldId === "forest" && this.currentMode !== "race"; }
    private mapObjects: Phaser.GameObjects.GameObject[] = [];
    private prediction: Player | null = null;
    private authoritativeTime = 0;
    private inputHistory: { input: PlayerInput; dt: number; at: number }[] = [];
    private correction = { x: 0, y: 0 };
    private path: Point[] = [];
    private destination: Point | null = null;
    private pendingInteraction = "";
    private racePromptArmed=true;
    private target!: Phaser.GameObjects.Graphics;
    private marker!: Phaser.GameObjects.Graphics;
    private prompt!: Phaser.GameObjects.Text;
    private hoveredFurniture: Furniture | null = null;
    private textureIds = new Map<string, string>();
    private avatarTextureSequence = 0;
    constructor() {
      super("home");
    }
    create() {
      this.cameras.main.setBackgroundColor("#e8e6d8").setRoundPixels(true);
      // Camera follow is finalized during preRender. Project after canvas rendering,
      // before browser paint, so the DOM screen uses that exact final transform.
      this.events.on(Phaser.Scenes.Events.RENDER,()=>{
        const snapshot=bridge.snapshot;if(!snapshot)return;
        const camera=this.cameras.main,surface=getWorld(snapshot.worldId).mediaSurface;
        const origin=camera.getWorldPoint(0,0);
        const point={x:(surface.x*TILE-origin.x)*camera.zoom,y:(surface.y*TILE-origin.y)*camera.zoom};
        parent.dataset.cameraScrollX=String(camera.scrollX+camera.width/2-camera.width/(2*camera.zoom));
        parent.dataset.cameraScrollY=String(camera.scrollY+camera.height/2-camera.height/(2*camera.zoom));
        parent.dispatchEvent(new CustomEvent("third-space:projection",{bubbles:true,detail:{instanceId:snapshot.instanceId,x:point.x,y:point.y,width:surface.width*TILE*camera.zoom,height:surface.height*TILE*camera.zoom}}));
      });
      if (this.input.keyboard) {
        this.keys = this.input.keyboard.addKeys(
          "W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E,ESC",
          false,
        ) as typeof this.keys;
        const keyboard=this.input.keyboard;
        keyboard.addCapture("UP,DOWN,LEFT,RIGHT,SPACE");
        // Let Phaser process the key before its own browser-default cancellation.
        // Cancelling earlier makes Phaser ignore the event entirely.
        const capturePolicy = (event: KeyboardEvent) => {
          const blocked = bridge.blocked || document.hidden || !bridge.snapshot?.players.some(p => p.id === bridge.selfId && p.connected && !p.respawnAt);
          if (event.type === "keyup") this.movement.keyup(event);
          const owned = event.type === "keydown" && this.movement.keydown(event, blocked);
          if(keyboard.manager)keyboard.manager.preventDefault = owned;
        };
        const resetKeys = () => { this.movement.reset(); if(keyboard.manager)keyboard.resetKeys(); };
        const focusPolicy = (event: FocusEvent) => { if (isGameInputBlocked(event.target)) resetKeys(); };
        window.addEventListener("keydown", capturePolicy, true);
        window.addEventListener("keyup", capturePolicy, true);
        window.addEventListener("blur", resetKeys);
        document.addEventListener("visibilitychange", resetKeys);
        document.addEventListener("focusin", focusPolicy);
        const releaseKeys = () => {
          window.removeEventListener("keydown", capturePolicy, true);
          window.removeEventListener("keyup", capturePolicy, true);
          window.removeEventListener("blur", resetKeys);
          document.removeEventListener("visibilitychange", resetKeys);
          document.removeEventListener("focusin", focusPolicy);
          this.events.off(Phaser.Scenes.Events.SHUTDOWN, releaseKeys);
          this.events.off(Phaser.Scenes.Events.DESTROY, releaseKeys);
        };
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, releaseKeys);
        this.events.once(Phaser.Scenes.Events.DESTROY, releaseKeys);
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
      // DOM scrolling/layout shifts do not always update Phaser's cached input bounds.
      // Refresh before the manager converts the native touch/mouse event.
      const refreshBounds=()=>{ if(this.scale?.canvas?.isConnected) this.scale.updateBounds(); };
      const canvas=this.game.canvas;
      for(const type of ["mousedown","touchstart","pointerdown"])canvas.addEventListener(type,refreshBounds,{capture:true,passive:true});
      document.addEventListener("scroll",refreshBounds,true);
      const releaseBounds=()=>{
        for(const type of ["mousedown","touchstart","pointerdown"])canvas.removeEventListener(type,refreshBounds,true);
        document.removeEventListener("scroll",refreshBounds,true);
        this.events.off(Phaser.Scenes.Events.SHUTDOWN,releaseBounds);
        this.events.off(Phaser.Scenes.Events.DESTROY,releaseBounds);
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN,releaseBounds);
      this.events.once(Phaser.Scenes.Events.DESTROY,releaseBounds);
      refreshBounds();
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
      if(this.forest) this.cameras.main.setZoom(Math.min(width/(22*TILE),height/(22*TILE)));
      if (!race && !this.forest) this.cameras.main.centerOn(W / 2, H / 2);
    }
    clearMap() {
      this.racePresentation = null;
      for (const object of this.mapObjects) object.destroy();
      this.mapObjects = [];
      this.stalkerSprite=null;this.stalkerId="";this.clownGreeting=null;this.mimicAvatar=null;this.mimicMonster=null;
      this.werewolfSprite=null;this.werewolfId="";this.werewolfFeet=null;this.werewolfLeapTell=null;
      this.pathTorches=[];
      this.fireArt=null;this.roastArt=null;this.lightImage=null;
      this.hoveredFurniture = null;
      this.prompt.setVisible(false);
    }
    texture(key: string, canvas: HTMLCanvasElement) {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, canvas);
      return key;
    }
    drawHome() {
      this.clearMap();
      const canvas = this.textures.exists("home-floor-v2") ? null : homeFloorCanvas(TILE);
      this.mapObjects.push(
        this.add
          .image(0, 0, canvas ? this.texture("home-floor-v2", canvas) : "home-floor-v2")
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
        [4.5, 2.8, "MOVIE NIGHT"],
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
    drawForest() {
        this.clearMap();
        this.mapObjects.push(this.add.image(0, 0, this.textures.exists(this.forest?"forest-floor-v2":"asylum-floor-v1") ? (this.forest?"forest-floor-v2":"asylum-floor-v1") : this.texture(this.forest?"forest-floor-v2":"asylum-floor-v1", this.forest?forestFloorCanvas(TILE):asylumFloorCanvas(TILE))).setOrigin(0).setDepth(0));
        for (const item of this.map.furniture) {
            if (item.kind === "campfire")
                continue;
            const f = item.footprint, charger=!this.forest&&item.id==="charger", key = charger?"asylum-charger-dock-v1":`${this.forest?"forest":"asylum"}-object:${item.kind}:${f.width}:${f.height}`;
            const image = this.add.image(f.x * TILE, f.y * TILE, this.textures.exists(key) ? key : this.texture(key, charger?asylumChargerCanvas():this.forest?forestObjectCanvas(item, TILE):asylumObjectCanvas(item,TILE))).setOrigin(0).setDepth((f.y + f.height - .4) * TILE);
            this.mapObjects.push(image);
            if (item.usePoints.length) {
                image.setInteractive({ useHandCursor: true });
                image.on("pointerdown", () => { if (!bridge.blocked)
                    this.useFurniture(item); });
            }
        }
        if(this.forest){
          for(let i=0;i<3;i++){const key="forest-path-torch-"+i;if(!this.textures.exists(key))this.texture(key,torchSpriteCanvas(i));}
          for(const post of FOREST_TORCHES){
            const image=this.add.image(post.x*TILE,post.y*TILE,"forest-path-torch-1").setOrigin(.5,1).setDepth(post.y*TILE);
            this.pathTorches.push(image);this.mapObjects.push(image);
          }
        }else{
          for(const marker of [{x:16.5,y:8.35,text:"FLASHLIGHT CHARGER"},{x:10,y:18.9,text:"EXIT · FOREST ↓"}]){
            this.mapObjects.push(this.add.text(marker.x*TILE,marker.y*TILE,marker.text,{fontFamily:"monospace",fontSize:"9px",color:"#bdceb0",backgroundColor:"#172820",padding:{x:4,y:2}}).setOrigin(.5,1).setDepth(1801));
          }
        }
        this.stalkerSprite=this.add.image(0,0,this.texture("forest-clown-0",clownSpriteCanvas(0))).setOrigin(.5,.96).setScale(32*AVATAR_SCALE/38).setVisible(false);
        for(let i=1;i<4;i++)this.texture("forest-clown-"+i,clownSpriteCanvas(i));
        this.mapObjects.push(this.stalkerSprite);
        this.clownGreeting=this.add.text(0,0,"",{fontFamily:"system-ui,sans-serif",fontSize:"13px",color:"#f1e6d4",backgroundColor:"#251b25",align:"center",padding:{x:8,y:5},wordWrap:{width:164,useAdvancedWrap:true}}).setOrigin(.5,1).setScrollFactor(0).setDepth(1900).setVisible(false);
        this.mapObjects.push(this.clownGreeting);
        this.mimicAvatar=this.add.image(0,0,this.stalkerSprite.texture.key).setOrigin(.5,.96).setScale(AVATAR_SCALE).setVisible(false);
        this.mimicMonster=this.add.image(0,0,this.texture("forest-mimic-0",mimicSpriteCanvas(0))).setOrigin(.5,.98).setScale(32*AVATAR_SCALE/38).setVisible(false);
        for(let i=1;i<4;i++)this.texture("forest-mimic-"+i,mimicSpriteCanvas(i));
        this.mapObjects.push(this.mimicAvatar,this.mimicMonster);
        this.werewolfSprite=this.add.image(0,0,this.texture("forest-werewolf-0",werewolfSpriteCanvas(0))).setOrigin(.5,.96).setScale(32*AVATAR_SCALE/38).setVisible(false);
        for(let i=1;i<6;i++)this.texture("forest-werewolf-"+i,werewolfSpriteCanvas(i));
        this.mapObjects.push(this.werewolfSprite);
        this.werewolfLeapTell=this.add.graphics();
        this.mapObjects.push(this.werewolfLeapTell);
        this.fireArt = this.add.graphics().setDepth((this.forest?24.5:10.5) * TILE);
        this.mapObjects.push(this.fireArt);
        this.roastArt = this.add.graphics().setDepth(1100);
        this.mapObjects.push(this.roastArt);
        this.lightCanvas ??= document.createElement("canvas");
        this.lightCanvas.width = this.lightCanvas.height = 320;
        const initialMask=this.lightCanvas.getContext("2d")!;initialMask.fillStyle=darknessFill(this.forest);initialMask.fillRect(0,0,320,320);
        this.lightImage = this.add.image(0, 0, this.texture("forest-darkness", this.lightCanvas)).setOrigin(0).setDepth(1800);
        this.mapObjects.push(this.lightImage);
    }
    lightForest(time: number, self: Player, players: Player[]) {
        const source=getWorld(bridge.snapshot?.worldId).fire!, fxTile=source.x,fyTile=source.y;
        const fire = this.fireArt!, r = this.roastArt!, c = this.lightCanvas!, g = c.getContext("2d")!;
        fire.clear();
        const flicker = bridge.reducedMotion ? 1 : 1 + Math.sin(time / 137) * .08 + Math.sin(time / 71) * .04;
        if(this.forest){
        fire.fillStyle(0x493e32);
        fire.fillEllipse(24 * TILE, 24.3 * TILE, 56, 25);
        fire.lineStyle(7, 0x765136);
        fire.lineBetween(23.45 * TILE, 24.2 * TILE, 24.55 * TILE, 24.6 * TILE);
        fire.lineBetween(24.55 * TILE, 24.2 * TILE, 23.45 * TILE, 24.6 * TILE);
        fire.fillStyle(0xd56839);
        fire.fillTriangle(23.5 * TILE, 24.4 * TILE, 24 * TILE, 24.4 * TILE - 42 * flicker, 24.5 * TILE, 24.4 * TILE);
        fire.fillStyle(0xf1b75a);
        fire.fillTriangle(23.65 * TILE, 24.4 * TILE, 24.05 * TILE, 24.4 * TILE - 30 * flicker, 24.35 * TILE, 24.4 * TILE);
        fire.fillStyle(0xffe0a0);
        fire.fillTriangle(23.82 * TILE, 24.4 * TILE, 24 * TILE, 24.4 * TILE - 18 * flicker, 24.18 * TILE, 24.4 * TILE);
        }else{fire.fillStyle(0x352f27);fire.fillEllipse(10*TILE,10*TILE,18,8);fire.fillStyle(0xe0d6ae);fire.fillRect(10*TILE-3,10*TILE-16,6,15);fire.fillStyle(0xffc673);fire.fillEllipse(10*TILE,10*TILE-20,5*flicker,10*flicker);}
        r.clear();
        for (const p of players)
            if (p.roastingAt) {
                const dx = 24 - p.x, dy = 24 - p.y, len = Math.hypot(dx, dy);
                const x = p.x * TILE, y = p.y * TILE - 17, ex = x + dx / len * 38, ey = y + dy / len * 38;
                r.lineStyle(2, 0xb39369);
                r.lineBetween(x, y, ex, ey);
                r.fillStyle(bridge.snapshot!.serverTime - p.roastingAt > 7000 ? 0xdca66c : 0xffe6bd);
                r.fillRect(ex - 4, ey - 4, 8, 7);
            }
        for(const p of players){
          const remaining=(p.haloUntil??0)-bridge.snapshot!.serverTime;
          if(remaining>0){r.lineStyle(2,0xffe6a5,Math.min(1,remaining/1500));r.strokeEllipse(p.x*TILE,p.y*TILE-58,20,6);}
        }
        if (time - this.lastLightAt < 33)
            return;
        const view = this.cameras.main.worldView;
        // An active forest can be the very first frame after rejoining. Camera
        // worldView is finalized by preRender; do not divide by its initial zero size.
        if(!Number.isFinite(view.width)||!Number.isFinite(view.height)||view.width<=0||view.height<=0)return;
        this.lastLightAt = time;
        g.clearRect(0, 0, c.width, c.height);
        g.fillStyle = darknessFill(this.forest);
        g.fillRect(0, 0, c.width, c.height);
        const sx = c.width / view.width, sy = c.height / view.height;
        const glow = (x: number, y: number, radius: number, strength: number, cone?: string) => {
            const px = (x * TILE - view.x) * sx, py = (y * TILE - view.y) * sy, rad = radius * TILE * sx;
            g.save();
            if (cone) {
                const a = cone === "up" ? -Math.PI / 2 : cone === "down" ? Math.PI / 2 : cone === "left" ? Math.PI : 0;
                g.beginPath();
                g.moveTo(px, py);
                g.arc(px, py, rad, a - .55, a + .55);
                g.closePath();
                g.clip();
            }
            const grad = g.createRadialGradient(px, py, 0, px, py, rad);
            grad.addColorStop(0, `rgba(0,0,0,${strength})`);
            grad.addColorStop(.38, `rgba(0,0,0,${strength * .85})`);
            grad.addColorStop(1, "rgba(0,0,0,0)");
            g.globalCompositeOperation = "destination-out";
            g.fillStyle = grad;
            g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
            g.restore();
        };
        const fireDistance = Math.hypot(self.x - fxTile, self.y - fyTile);
        glow(fxTile, fyTile, (this.forest?9.6:4.5) * flicker, Math.max(0, Math.min(1, (18 - fireDistance) / 10)));
        if(this.forest){
          FOREST_TORCHES.forEach((post,i)=>{
            const light=torchLight(time,i,bridge.reducedMotion);
            this.pathTorches[i]?.setTexture("forest-path-torch-"+light.frame);
            // Same darkness-canvas compositing and 33 ms budget as fire/candles.
            if(post.x*TILE<view.x-2*TILE||post.x*TILE>view.right+2*TILE||post.y*TILE<view.y-2*TILE||post.y*TILE>view.bottom+2*TILE)return;
            glow(post.x,post.y-.45,light.radius,light.strength);
          });
        }else{
          for(const light of ASYLUM_WAYFINDING_LIGHTS)glow(light.x,light.y,light.radius,light.strength*(.98+.02*flicker));
        }
        glow(self.x, self.y, 1.3, .28);
        const stalker=bridge.snapshot?.stalker;if(stalker)glow(stalker.x,stalker.y,.8,.07);
        if(!this.forest){const ceiling=bridge.reducedMotion?.18:.12+Math.sin(time/113)*.05+Math.sin(time/37)*.035;glow(6,5,4,ceiling);glow(15,14,4,ceiling);glow(16.4,8.5,1.2,.14);}
        for (const p of players)
            if (p.flashlightOn && Math.hypot(p.x - self.x, p.y - self.y) < 12)
                glow(p.x, p.y, 7, .92, p.facing);
        // Warm compositing colours avatars, ground and trees in the same light field.
        g.globalCompositeOperation = "source-over";
        const fx = (fxTile * TILE - view.x) * sx, fy = (fyTile * TILE - view.y) * sy, rr = (this.forest?9.2:4.2) * TILE * sx;
        const warm = g.createRadialGradient(fx, fy, 0, fx, fy, rr);
        warm.addColorStop(0, "rgba(255,145,58,.25)");
        warm.addColorStop(.45, "rgba(234,113,43,.12)");
        warm.addColorStop(1, "rgba(240,130,60,0)");
        g.fillStyle = warm;
        g.fillRect(fx - rr, fy - rr, rr * 2, rr * 2);
        if(stalker){const x=(stalker.x*TILE-view.x)*sx,y=(stalker.y*TILE-view.y)*sy,rad=.85*TILE*sx;const red=g.createRadialGradient(x,y,0,x,y,rad);red.addColorStop(0,"rgba(110,4,15,.10)");red.addColorStop(1,"rgba(100,0,10,0)");g.fillStyle=red;g.fillRect(x-rad,y-rad,rad*2,rad*2);}
        (this.textures.get("forest-darkness") as Phaser.Textures.CanvasTexture).refresh();
        this.lightImage!.setPosition(view.x, view.y).setDisplaySize(view.width, view.height);
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
      this.racePresentation = new RacePresentation(this, TILE, this.mapObjects);
    }
    cancelWalk() {
      this.path = [];
      this.destination = null;
      this.pendingInteraction = "";
    }
    walkTo(goal: Point, interaction = "") {
      const self = this.prediction;
      if (!self || self.mode !== "home") return;
      const path = findHomePath(self, goal, this.map);
      if (!path) {
        this.cancelWalk();
        this.prompt
          .setText(
            isHomeWalkable(goal, this.map)
              ? "No clear path there. Try a nearby spot."
              : "Something is in the way. Click beside it.",
          )
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
        : item.usePoints.map((p) => ({ ...p, action: item.id==="abandoned-cabin"?"race-house":item.id==="asylum-entrance"?"enter-asylum":item.id==="asylum-exit"?"exit-asylum":item.kind }));
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
        isGameInputBlocked(document.activeElement)
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
      const candidates = this.map.furniture
        .flatMap<Point & { action: string }>((item) =>
          item.seats.length
            ? item.seats
                .filter((s) => !occupied.has(s.id))
                .map((s) => ({ ...s, action: `seat:${s.id}` }))
            : item.usePoints.map((p) => ({ ...p, action: item.id==="abandoned-cabin"?"race-house":item.id==="asylum-entrance"?"enter-asylum":item.id==="asylum-exit"?"exit-asylum":item.kind })),
        )
        .filter((point) => isHomeSegmentWalkable(self, point, this.map))
        .sort((a, b) => distance(self, a) - distance(self, b));
      if (candidates[0] && distance(self, candidates[0]) <= 1.5)
        bridge.interact(candidates[0].action);
    }
    avatarTexture(player: Player, frame: number) {
      const signature =
        JSON.stringify(player.avatar) + player.facing + frame + !!player.seatId;
      let key = this.textureIds.get(signature);
      if (!key) {
        if(this.textureIds.size>=256){
          const visible=new Set([...this.nodes.values()].map(node=>node.texture));
          if(this.mimicAvatar?.visible)visible.add(this.mimicAvatar.texture.key);
          for(const [signature,key] of this.textureIds){
            if(!visible.has(key)){this.textures.remove(key);this.textureIds.delete(signature);}
            if(this.textureIds.size<=192)break;
          }
        }
        key = `avatar:${this.avatarTextureSequence++}`;
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
      if (self && this.inputSequence.observe(snapshot.epoch + ":" + snapshot.instanceId, self.lastInputSeq, self.connected && bridge.transportConnected)) {
        this.seq = self.lastInputSeq;
        this.inputHistory = []; this.correction = { x: 0, y: 0 }; this.prediction = null;
      }
      if (mode !== this.currentMode || snapshot.worldId!==this.currentWorld || snapshot.worldRevision!==this.currentRevision || snapshot.instanceId!==this.currentInstance) {
        this.currentInstance=snapshot.instanceId;this.movement.reset();
        this.currentWorld=snapshot.worldId;this.currentRevision=snapshot.worldRevision;
        this.currentMode = mode;
        this.cancelWalk();
        this.inputHistory = [];
        this.correction = { x: 0, y: 0 };
        this.prediction = null;
        mode === "race" ? this.drawRace() : this.dark ? this.drawForest() : this.drawHome();
        this.fit();
      }
      if (self && mode === "race") this.racePresentation?.update(self, bridge.reducedMotion ? 0 : time, this.scale.height);
      const typing = isGameInputBlocked(document.activeElement);
      const active =
        !bridge.blocked &&
        !typing &&
        document.visibilityState === "visible" &&
        !!self?.connected && !self.respawnAt;
      if (!active) { this.cancelWalk(); this.movement.reset(); bridge.touch.sprint = false; }
      if (self && snapshot.serverTime !== this.authoritativeTime) {
        this.authoritativeTime = snapshot.serverTime;
        this.snapshotReceivedAt = time;
        this.seq = Math.max(this.seq, self.lastInputSeq);
        if((self.respawnCount??0)!==(this.prediction?.respawnCount??0)){
          this.cancelWalk();this.inputHistory=[];this.correction={x:0,y:0};this.prediction=null;
        }
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
          else if (mode === "home") {
            this.prediction = stepHome(this.prediction, h.input, h.dt, this.map, h.at);
          }
        }
        this.correction =
          previous && distance(previous, this.prediction) < 3 && !self.seatId
            ? {
                x: previous.x - this.prediction.x,
                y: previous.y - this.prediction.y,
              }
            : { x: 0, y: 0 };
      }
      const controls = this.movement.read();
      if(mode==="home"&&this.forest&&this.prediction){
        const d=distance(this.prediction,{x:15,y:14.5});
        if(d>2)this.racePromptArmed=true;
        else if(active&&d<1&&this.racePromptArmed){this.racePromptArmed=false;this.cancelWalk();bridge.interact("race-house");}
      }
      const predictedNow = snapshot.serverTime + Math.max(0, time - this.snapshotReceivedAt);
      let axisX = active ? controls.axisX || bridge.touch.axisX : 0;
      let axisY = active ? controls.axisY || bridge.touch.axisY : 0;
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
      const jump = active && (controls.jump || bridge.touch.jump);
      const sprint = active && mode === "home" && (controls.sprint || bridge.touch.sprint === true);
      if (this.prediction) {
        const input = { seq: this.seq, axisX, axisY, jump, sprint };
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
            this.map,
            predictedNow,
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
                fontSize: "13px",
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
        if (local && mode === "home" && !isHomeSegmentWalkable(p, rendered, this.map)) {
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
        const canSee=!this.forest || local || (!!self && Math.hypot(p.x-self.x,p.y-self.y)<14 && (Math.hypot(p.x-24,p.y-24)<9 || snapshot.players.some(light=>flashlightContains(light,p))));
        node.sprite.setVisible(canSee);if(node.sprite.input)node.sprite.input.enabled=canSee;
        const showName = canSee && (this.hoveredId === p.id || this.clickedId === p.id);
        const textMetrics = chatTextMetrics(window.devicePixelRatio, this.cameras.main.zoom);
        // Resize textures only when DPR changes; avoid regenerating text each frame.
        for (const text of [node.label, node.bubble]) {
          if (text.style.resolution !== textMetrics.resolution) {
            // CanvasRenderer reads the texture source density independently of TextStyle.
            text.frame.source.resolution = textMetrics.resolution;
            text.setResolution(textMetrics.resolution);
          }
          text.setScale(textMetrics.scale);
        }
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
            node.sprite.y - AVATAR_HEAD - (showName ? 26 * textMetrics.scale : 0),
          )
          .setText(
            bridge.bubbles
              ? messages
                  .slice(-2)
                  .map((m) => m.text)
                  .join("\n")
              : "",
          )
          .setVisible(canSee && bridge.bubbles && messages.length > 0);
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
      if(this.dark && localNode && self){
        const camera=this.cameras.main,vw=this.scale.width/camera.zoom,vh=this.scale.height/camera.zoom;
        if(this.forest)camera.centerOn(cameraFollowX(localNode.sprite.x,this.map.width*TILE,vw),cameraFollowX(localNode.sprite.y,this.map.height*TILE,vh));
        this.lightForest(time,{...self,x:localNode.sprite.x/TILE,y:localNode.sprite.y/TILE},snapshot.players);
      }
      const mimic=this.forest?snapshot.mimic:null;
      if(this.mimicAvatar&&this.mimicMonster){
        const avatar=this.mimicAvatar,monster=this.mimicMonster;
        avatar.setVisible(!!mimic);monster.setVisible(!!mimic);
        if(mimic){
          const presentation=mimicPresentation(mimic,snapshot.serverTime,bridge.reducedMotion);
          const target=snapshot.players.find(p=>p.id===mimic.targetId),dx=(target?.x??mimic.x)-mimic.x,dy=(target?.y??mimic.y)-mimic.y;
          const facing=Math.abs(dx)>Math.abs(dy)?dx<0?"left":"right":dy<0?"up":"down";
          // A cosmetic node never enters players/names/roster or receives an input identity.
          const visual={...snapshot.players[0]!,avatar:mimic.disguise,facing,seatId:undefined} as Player;
          avatar.setTexture(this.avatarTexture(visual,bridge.reducedMotion?0:Math.floor(snapshot.serverTime/250)%2));
          avatar.setPosition(mimic.x*TILE,mimic.y*TILE).setDepth(mimic.y*TILE+.1).setAlpha(presentation.avatarAlpha*(mimic.phase==="retreat"?Math.max(0,(mimic.phaseUntil-snapshot.serverTime)/900):1));
          monster.setTexture("forest-mimic-"+presentation.frame).setPosition(mimic.x*TILE,mimic.y*TILE).setDepth(mimic.y*TILE+.2).setAlpha(presentation.monsterAlpha).setRotation(presentation.rotation);
        }
      }
      const wolf=this.forest?snapshot.werewolf:null;
      if(this.werewolfSprite){
        const sprite=this.werewolfSprite,tell=this.werewolfLeapTell;
        sprite.setVisible(!!wolf);tell?.clear();
        if(wolf){
          if(this.werewolfId!==wolf.id||!this.werewolfFeet){this.werewolfId=wolf.id;this.werewolfFeet={x:wolf.x*TILE,y:wolf.y*TILE};}
          const feet=this.werewolfFeet,t=snapshot.serverTime-wolf.startedAt,target=snapshot.players.find(p=>p.id===wolf.targetId);
          feet.x+=(wolf.x*TILE-feet.x)*(1-Math.exp(-delta/60));
          feet.y+=(wolf.y*TILE-feet.y)*(1-Math.exp(-delta/60));
          const leap=werewolfLeapPresentation(wolf.leap,snapshot.serverTime,bridge.reducedMotion);
          sprite.setPosition(feet.x,feet.y-leap.elevation).setScale(32*AVATAR_SCALE/38*leap.scaleX,32*AVATAR_SCALE/38*leap.scaleY);
          sprite.setTexture("forest-werewolf-"+(leap.frame??(wolf.phase!=="chase"||bridge.reducedMotion?0:Math.floor(t/75)%6)));
          if(target)sprite.setFlipX(target.x<wolf.x);
          // Depth always follows ground feet, never the decorative airborne offset.
          sprite.setDepth(feet.y).setAlpha(wolf.phase==="retreat"?Math.max(0,(wolf.phaseUntil-snapshot.serverTime)/900):.95);
          if(tell&&leap.tell){
            const aim=leap.tell,fromX=aim.fromX*TILE,fromY=aim.fromY*TILE,toX=aim.toX*TILE,toY=aim.toY*TILE;
            // The danger tell stays readable above darkness, only for an already visible enemy.
            tell.setDepth(1801);
            tell.lineStyle(2,0xffba83,.95);
            tell.lineBetween(fromX,fromY,toX,toY);
            tell.strokeEllipse(toX,toY,28,12);
            tell.lineBetween(toX-5,toY,toX+5,toY);tell.lineBetween(toX,toY-4,toX,toY+4);
            tell.fillStyle(0x070907,.55);tell.fillEllipse(feet.x,feet.y+1,24,8);
          }
        }else{this.werewolfFeet=null;this.werewolfId="";}
      }
      const stalker=this.forest?snapshot.stalker:null;
      if(this.stalkerSprite){
        this.stalkerSprite.setVisible(!!stalker);
        if(stalker){
          if(this.stalkerId!==stalker.id){this.stalkerId=stalker.id;this.stalkerSprite.setPosition(stalker.x*TILE,stalker.y*TILE);}
          const t=snapshot.serverTime-stalker.startedAt,peek=stalker.phase==="peek",motion=bridge.reducedMotion?0:Math.sin(t/(peek?230:95));
          this.stalkerSprite.x+=(stalker.x*TILE-this.stalkerSprite.x)*(1-Math.exp(-delta/75));
          this.stalkerSprite.y+=(stalker.y*TILE-this.stalkerSprite.y)*(1-Math.exp(-delta/75));
          this.stalkerSprite.setTexture("forest-clown-"+(peek||bridge.reducedMotion?0:Math.floor(t/110)%4));
          this.stalkerSprite.setRotation(motion*(peek?.05:.10)).setDepth(this.stalkerSprite.y).setAlpha(stalker.phase==="retreat"?Math.max(0,(stalker.phaseUntil-snapshot.serverTime)/900):.92);
        }
      }
      if(this.clownGreeting){
        const greeting=clownGreetingPresentation(stalker,snapshot.serverTime),text=this.clownGreeting,camera=this.cameras.main;
        text.setVisible(!!greeting);
        if(greeting&&this.stalkerSprite){
          const metrics=chatTextMetrics(window.devicePixelRatio,camera.zoom);
          if(text.style.resolution!==metrics.resolution){text.frame.source.resolution=metrics.resolution;text.setResolution(metrics.resolution);}
          text.setScale(metrics.scale).setText(greeting.text).setAlpha(greeting.alpha);
          const origin=camera.getWorldPoint(0,0);
          const point=greetingViewportPoint((this.stalkerSprite.x-origin.x)*camera.zoom,(this.stalkerSprite.y-AVATAR_HEAD-origin.y)*camera.zoom,text.width,text.height,camera.width,camera.height);
          // Scroll factor zero still applies camera zoom, so positions undo zoom explicitly.
          text.setPosition(camera.width/2+(point.x-camera.width/2)/camera.zoom,camera.height/2+(point.y-camera.height/2)/camera.zoom);
        }
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
        mode,
        avatarScale: String(AVATAR_SCALE),
        avatarHeight: String(32 * AVATAR_SCALE),
        roomTheme: this.forest ? "midnight-pines" : "walnut-velvet",
        worldId: snapshot.worldId,
        worldRevision: String(snapshot.worldRevision),
        renderFrame: String(this.game.loop.frame),
        avatarTextureCount: String(this.textureIds.size),
        sprintUntil: String(self?.sprintUntil ?? 0),
        sprintReadyAt: String(self?.sprintReadyAt ?? 0),
        stamina: String(self?.stamina ?? 1),
        sprinting: String(self?.sprinting ?? false),
        sprintExhaustedUntil: String(self?.sprintExhaustedUntil ?? 0),
        flashlightOn: String(self?.flashlightOn),
        flashlightBattery:String(self?.flashlightBattery),
        zoneRevision:String(self?.zoneRevision??0),
        roastingAt: String(self?.roastingAt??0),
        respawnCount: String(self?.respawnCount??0),
        caughtAt: String(self?.caughtAt??0),
        respawnAt: String(self?.respawnAt??0),
        haloUntil: String(self?.haloUntil??0),
        haloVisible: String((self?.haloUntil??0)>snapshot.serverTime),
        stalkerId: snapshot.stalker?.id??"",
        werewolfId: snapshot.werewolf?.id??"",
        mimicId: snapshot.mimic?.id??"",
        mimicPhase: snapshot.mimic?.phase??"",
        mimicDisguiseAlpha: String(this.mimicAvatar?.alpha??0),
        mimicMonsterAlpha: String(this.mimicMonster?.alpha??0),
        werewolfPhase: snapshot.werewolf?.phase??"",
        stalkerPhase: snapshot.stalker?.phase??"",
        clownGreeting: this.clownGreeting?.visible?this.clownGreeting.text:"",
        clownGreetingResolution: String(this.clownGreeting?.frame.source.resolution??0),
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
        worldWidth: String(mode === "home" ? this.map.width : RACE_MAP.width),
        worldHeight: String(
          mode === "home" ? this.map.height : RACE_MAP.height,
        ),
        hoveredPlayerId: this.hoveredId,
        visibleNameCount: String(visibleNames),
        chatTextResolution: String(localNode?.bubble.style.resolution ?? 0),
        chatTextureResolution: String(localNode?.bubble.frame.source.resolution ?? 0),
        chatScreenWidth: String(localNode ? localNode.bubble.frame.width / localNode.bubble.frame.source.resolution * localNode.bubble.scaleX * camera.zoom : 0),
        chatTextScale: String(localNode?.bubble.scaleX ?? 0),
        moveTargetX: this.destination ? String(this.destination.x) : "",
        moveTargetY: this.destination ? String(this.destination.y) : "",
      });
      const nextInputSeq = time - this.lastInput > 33 && self
        ? this.inputSequence.next(document.visibilityState === "visible") : null;
      if (nextInputSeq !== null && self) {
        this.seq = nextInputSeq;
        const dt = Math.min((time - this.lastInput) / 1000, 0.05);
        this.lastInput = time;
        const input = { seq: this.seq, axisX, axisY, jump, sprint };
        this.inputHistory.push({ input, dt, at: predictedNow });

        if (this.inputHistory.length > 100) this.inputHistory.shift();
        bridge.send({ type: "input", input, lifeRevision:self.respawnCount??0 });
        bridge.touch.jump = false;
      }
      for (const effect of bridge.effects.splice(0)) {
        if(effect.expiresAt<Date.now())continue;
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
  const game=new Phaser.Game({
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
  // Rendering sleeps independently; the room socket, voice and media remain alive.
  const visibility=()=>{if(document.hidden)game.loop.sleep();else game.loop.wake();};
  document.addEventListener("visibilitychange",visibility);
  game.events.once(Phaser.Core.Events.READY,visibility);
  game.events.once(Phaser.Core.Events.DESTROY,()=>document.removeEventListener("visibilitychange",visibility));
  return game;
}
