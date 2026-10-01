import {afterEach, expect, it, vi} from 'vitest';
import {observeSurvivalHUD} from './survival-hud-layout';

afterEach(() => vi.unstubAllGlobals());
it('moves clearance with effects, finisher rows, safe-area offsets and resized canvases; cleans up on room exit', () => {
  const values = new Map<string,string>();
  const scope = {style:{getPropertyValue:(key:string)=>values.get(key)??'',setProperty:(key:string,value:string)=>values.set(key,value),removeProperty:(key:string)=>values.delete(key)}};
  let top=180,bottom=300,width=264,changed=()=>{};
  let promptHeight=0,childChanged=()=>{};
  const prompt={getBoundingClientRect:()=>({height:promptHeight})};
  const canvas={closest:()=>scope,getBoundingClientRect:()=>({bottom}),querySelector:()=>promptHeight?prompt:null};
  const hud={parentElement:canvas,getBoundingClientRect:()=>({top,width})};
  const observe=vi.fn(),disconnect=vi.fn(),removeEventListener=vi.fn();
  const unobserve=vi.fn(),disconnectChildren=vi.fn();
  vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){changed=callback;}observe=observe;unobserve=unobserve;disconnect=disconnect;});
  vi.stubGlobal('MutationObserver',class{constructor(callback:()=>void){childChanged=callback;}observe=vi.fn();disconnect=disconnectChildren;});
  vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener});
  const stop=observeSurvivalHUD(hud as unknown as HTMLElement);
  expect(values.get('--survival-hud-clearance')).toBe('128px');
  expect(observe.mock.calls.map(call=>call[0])).toEqual([hud,canvas]);
  top=127.5;changed();expect(values.get('--survival-hud-clearance')).toBe('181px');
  bottom=260;top=91;width=244;changed();
  expect(values.get('--survival-hud-clearance')).toBe('177px');expect(values.get('--survival-hud-width')).toBe('244px');
  promptHeight=68;childChanged();expect(values.get('--survival-talk-height')).toBe('68px');expect(observe).toHaveBeenLastCalledWith(prompt);
  promptHeight=87.5;changed();expect(values.get('--survival-talk-height')).toBe('88px');
  promptHeight=0;childChanged();expect(values.get('--survival-talk-height')).toBe('44px');expect(unobserve).toHaveBeenCalledWith(prompt);
  stop();changed();childChanged();expect(values.size).toBe(0);expect(disconnect).toHaveBeenCalledOnce();expect(disconnectChildren).toHaveBeenCalledOnce();expect(removeEventListener).toHaveBeenCalledWith('resize',expect.any(Function));
});
