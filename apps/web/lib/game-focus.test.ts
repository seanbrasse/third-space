import { describe, expect, it, vi, afterEach } from "vitest";
import { mayRestoreGameFocus, restoreGameFocus } from "./game-focus";
const element = (connected = true, children: unknown[] = []) => ({ isConnected: connected, contains: (child: unknown) => children.includes(child) }) as unknown as Element;
afterEach(() => vi.unstubAllGlobals());
describe("central panel dismissal focus policy", () => {
  it("returns viewport focus from close/toggle controls owned by dismissed panel", () => {
    const body=element(), toggle=element(), close=element(), panel=element(true,[close]);
    expect(mayRestoreGameFocus(toggle,body,[panel,toggle],false,false)).toBe(true);
    expect(mayRestoreGameFocus(close,body,[panel,toggle],false,false)).toBe(true);
    expect(mayRestoreGameFocus(body,body,[panel],false,false)).toBe(true);
    expect(mayRestoreGameFocus(element(false),body,[panel],false,false)).toBe(true);
  });
  it("never steals typing or deliberate keyboard navigation in another panel", () => {
    const body=element(), otherInput=element(), otherControl=element(), panel=element();
    expect(mayRestoreGameFocus(otherInput,body,[panel],false,false)).toBe(false);
    expect(mayRestoreGameFocus(otherControl,body,[panel],false,false)).toBe(false);
  });
  it("respects a nested/new modal and active fullscreen", () => {
    const body=element();
    expect(mayRestoreGameFocus(body,body,[],true,false)).toBe(false);
    expect(mayRestoreGameFocus(body,body,[],false,true)).toBe(false);
  });
  it("defers until DOM dismissal settles, with preventScroll and cancellation", () => {
    let callback=()=>{};const focus=vi.fn(),cancel=vi.fn();
    const body=element(),doc={body,activeElement:body,fullscreenElement:null,removeEventListener:vi.fn(),querySelector:vi.fn((selector:string)=>selector===".world-canvas"?{isConnected:true,focus}:null)};
    vi.stubGlobal("document",doc);vi.stubGlobal("requestAnimationFrame",(fn:()=>void)=>{callback=fn;return 7;});vi.stubGlobal("cancelAnimationFrame",cancel);
    const stop=restoreGameFocus([]);expect(focus).not.toHaveBeenCalled();callback();
    expect(focus).toHaveBeenCalledWith({preventScroll:true});stop();expect(cancel).toHaveBeenCalledWith(7);
  });
  it("checks live focus so clicking another input during close wins", () => {
    let callback=()=>{};const focus=vi.fn(),body=element();
    const doc={body,activeElement:body,fullscreenElement:null,removeEventListener:vi.fn(),querySelector:(selector:string)=>selector===".world-canvas"?{isConnected:true,focus}:null};
    vi.stubGlobal("document",doc);vi.stubGlobal("requestAnimationFrame",(fn:()=>void)=>{callback=fn;return 1;});
    vi.stubGlobal("cancelAnimationFrame",vi.fn());
    restoreGameFocus([]);doc.activeElement=element();callback();expect(focus).not.toHaveBeenCalled();
  });
});


describe("dismissal before lazy viewport mount", () => {
  function setup() {
    let frame=()=>{}, changed=()=>{}, focusChanged=()=>{};
    const body=element(),scope=element(),focus=vi.fn(),disconnect=vi.fn();
    const state={viewport:null as {isConnected:boolean;focus:typeof focus}|null,modal:null as Element|null};
    const doc={body,activeElement:body,fullscreenElement:null,querySelector:(selector:string)=>selector===".world-canvas"?state.viewport:selector===".world-shell"?scope:state.modal,
      addEventListener:(_name:string,fn:()=>void)=>{focusChanged=fn;},removeEventListener:vi.fn()};
    vi.stubGlobal("document",doc);vi.stubGlobal("requestAnimationFrame",(fn:()=>void)=>{frame=fn;return 1;});vi.stubGlobal("cancelAnimationFrame",vi.fn());
    vi.stubGlobal("MutationObserver",class{constructor(fn:()=>void){changed=fn;}observe(){}disconnect=disconnect;});
    return {doc,scope,state,focus,disconnect,frame:()=>frame(),changed:()=>changed(),focusChanged:()=>focusChanged()};
  }
  it("restores on viewport insertion, without requiring renderer readiness or a delay",()=>{
    const s=setup();restoreGameFocus([]);s.frame();expect(s.focus).not.toHaveBeenCalled();
    s.state.viewport={isConnected:true,focus:s.focus};s.changed();
    expect(s.focus).toHaveBeenCalledWith({preventScroll:true});expect(s.disconnect).toHaveBeenCalled();
  });
  it("cancels if another input takes focus while renderer loads",()=>{
    const s=setup();restoreGameFocus([]);s.frame();s.doc.activeElement=element();s.focusChanged();
    s.state.viewport={isConnected:true,focus:s.focus};s.changed();expect(s.focus).not.toHaveBeenCalled();expect(s.disconnect).toHaveBeenCalled();
  });
  it("cancels when the original shell disappears or another modal opens",()=>{
    for(const reason of ["shell","modal"]){const s=setup();restoreGameFocus([]);s.frame();
      if(reason==="shell")Object.assign(s.scope,{isConnected:false});else s.state.modal=element();
      s.changed();s.state.viewport={isConnected:true,focus:s.focus};s.changed();expect(s.focus).not.toHaveBeenCalled();expect(s.disconnect).toHaveBeenCalled();}
  });
});
