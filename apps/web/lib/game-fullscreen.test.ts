import {describe,expect,it,vi} from "vitest";
import {fullscreenBlocksGameFocus,toggleGameFullscreen} from "./game-fullscreen";
describe("full game fullscreen authority",()=>{
 it("requests only from explicit action and exits only its own surface",async()=>{
  const requestFullscreen=vi.fn().mockResolvedValue(undefined),exitFullscreen=vi.fn().mockResolvedValue(undefined);
  const element={requestFullscreen} as unknown as HTMLElement;
  const doc={fullscreenEnabled:true,fullscreenElement:null,exitFullscreen} as unknown as Document;
  expect(requestFullscreen).not.toHaveBeenCalled();
  await toggleGameFullscreen(element,doc);expect(requestFullscreen).toHaveBeenCalledOnce();
  (doc as unknown as {fullscreenElement:HTMLElement}).fullscreenElement=element;
  await toggleGameFullscreen(element,doc);expect(exitFullscreen).toHaveBeenCalledOnce();
 });
 it("rejects unsupported browser rather than promising fullscreen",async()=>{
  const requestFullscreen=vi.fn();
  await expect(toggleGameFullscreen({requestFullscreen} as unknown as HTMLElement,{fullscreenEnabled:false} as Document)).rejects.toThrow(/unavailable/);
  expect(requestFullscreen).not.toHaveBeenCalled();
 });
 it("propagates browser denial without changing application state",async()=>{
  const rejection=new Error("denied");
  await expect(toggleGameFullscreen({requestFullscreen:vi.fn().mockRejectedValue(rejection)} as unknown as HTMLElement,{fullscreenEnabled:true} as Document)).rejects.toBe(rejection);
 });
 it("permits focus restoration inside full game and blocks video-only fullscreen",()=>{
  const viewport={} as Element;
  expect(fullscreenBlocksGameFocus(null,viewport)).toBe(false);
  expect(fullscreenBlocksGameFocus({contains:()=>true} as unknown as Element,null)).toBe(true);
  expect(fullscreenBlocksGameFocus({contains:(el:Element)=>el===viewport} as Element,viewport)).toBe(false);
  expect(fullscreenBlocksGameFocus({contains:()=>false} as unknown as Element,viewport)).toBe(true);
 });
});
