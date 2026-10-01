import { describe, expect, it } from "vitest";
import { GameKeyboard, ownsActivation, shouldOpenChat, isGameInputBlocked, gameHotkey } from "./game-keyboard";
function target(kind: string) {
  return { isContentEditable: kind === "editable", closest: (selector: string) =>
    kind === "input" ? selector.includes("input,") :
    kind === "button" ? selector.includes("button,") :
    kind === "dialog" ? selector.includes('[role="dialog"]') :
    kind === "slider" ? selector.includes('[role="slider"]') : false } as unknown as EventTarget;
}
function key(code: string, node = target("world"), repeat = false) {
  return { code, key: code === "Space" ? " " : code, repeat, target: node, altKey: false, ctrlKey: false, metaKey: false };
}
describe("game keyboard ownership", () => {
  it("F toggles flashlight once per press while preserving typing, modal and browser shortcuts", () => {
    const f = { ...key("KeyF"), key: "f", defaultPrevented: false };
    expect(gameHotkey(f, false)).toBe("flashlight");
    expect(gameHotkey({ ...f, target: target("button") }, false)).toBe("flashlight");
    for (const patch of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { defaultPrevented: true }])
      expect(gameHotkey({ ...f, ...patch }, false)).toBeNull();
    for (const kind of ["input", "editable", "dialog", "slider"])
      expect(gameHotkey({ ...f, target: target(kind) }, false)).toBeNull();
    expect(gameHotkey(f, true)).toBeNull();
    expect(gameHotkey({ ...f, code: "KeyG" }, false)).toBeNull();
  });
  it("uses arrows and physical WASD consistently after ordinary button clicks", () => {
    const keyboard = new GameKeyboard();
    for (const code of ["ArrowRight", "KeyD"]) {
      expect(keyboard.keydown(key(code, target("button")), false)).toBe(true);
      expect(keyboard.read().axisX).toBe(1);
      keyboard.keyup(key(code));
      expect(keyboard.read().axisX).toBe(0);
    }
  });
  it("preserves typing, editable fields, composite/modal controls and button activation", () => {
    const keyboard = new GameKeyboard();
    for (const kind of ["input", "editable", "dialog", "slider"]) {
      expect(isGameInputBlocked(target(kind))).toBe(true);
      for (const code of ["ArrowRight", "KeyD", "Space"])
        expect(keyboard.keydown(key(code, target(kind)), false)).toBe(false);
    }
    expect(ownsActivation(target("button"))).toBe(true);
    expect(keyboard.keydown(key("Space", target("button")), false)).toBe(false);
    expect(keyboard.read().sprint).toBe(false);
  });
  it("Space is edge-triggered, with held/repeated keys unable to rearm after reset", () => {
    const keyboard = new GameKeyboard();
    keyboard.keydown(key("Space"), false);
    expect(keyboard.takeSprintTap()).toBe(true);
    keyboard.keydown(key("Space", target("world"), true), false);
    expect(keyboard.takeSprintTap()).toBe(false);
    keyboard.reset();
    expect(keyboard.keydown(key("Space", target("world"), true), false)).toBe(false);
    expect(keyboard.read().jump).toBe(false);
    keyboard.keyup(key("Space"));
    keyboard.keydown(key("Space"), false);
    expect(keyboard.takeSprintTap()).toBe(true);
  });
  it("keeps Enter activation on all watching controls and opens chat only in game context", () => {
    const enter = { key: "Enter", repeat: false, defaultPrevented: false, target: target("button") };
    expect(shouldOpenChat(enter, false)).toBe(false);
    expect(shouldOpenChat({ ...enter, target: target("world") }, true)).toBe(false);
    expect(shouldOpenChat({ ...enter, target: target("input") }, false)).toBe(false);
    expect(shouldOpenChat({ ...enter, target: target("world") }, false)).toBe(true);
  });
});
