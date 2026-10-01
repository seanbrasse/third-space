import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasVisiblePlayback, reportVisiblePlayback } from './watching-presence';
let doc: { hidden: boolean; dispatchEvent: ReturnType<typeof vi.fn> }, surface: HTMLElement;
beforeEach(()=>{doc={hidden:false,dispatchEvent:vi.fn()};vi.stubGlobal('document',doc);vi.stubGlobal('innerWidth',800);vi.stubGlobal('innerHeight',600);vi.stubGlobal('getComputedStyle',()=>({display:'block',visibility:'visible',opacity:'1'}));vi.stubGlobal('CustomEvent',class {constructor(public type:string,public options:unknown){}});surface={isConnected:true,hidden:false,parentElement:null,getBoundingClientRect:()=>({width:320,height:180,left:10,top:10,right:330,bottom:190})} as unknown as HTMLElement;});
afterEach(()=>vi.unstubAllGlobals());
describe('actual visible watching qualification',()=>{
 it('requires actual playing player and sends its playback identity',()=>{expect(hasVisiblePlayback(surface,false)).toBe(false);reportVisiblePlayback(surface,true,'id');expect(doc.dispatchEvent).toHaveBeenCalledOnce();});
 it('hidden document never emits even if decoder continues playing',()=>{doc.hidden=true;reportVisiblePlayback(surface,true,'id');expect(doc.dispatchEvent).not.toHaveBeenCalled();});
 it('outside viewport, hidden ancestors, detached or zero size players do not count',()=>{surface.getBoundingClientRect=()=>({width:320,height:180,left:10,top:610,right:330,bottom:790}) as DOMRect;expect(hasVisiblePlayback(surface,true)).toBe(false);surface.getBoundingClientRect=()=>({width:320,height:180,left:10,top:10,right:330,bottom:190}) as DOMRect;vi.stubGlobal('getComputedStyle',()=>({display:'block',visibility:'hidden',opacity:'1'}));expect(hasVisiblePlayback(surface,true)).toBe(false);});
 it('detached, zero-size and hidden-parent players cannot report activity',()=>{
   Object.assign(surface,{isConnected:false});expect(hasVisiblePlayback(surface,true)).toBe(false);
   Object.assign(surface,{isConnected:true});surface.getBoundingClientRect=()=>({width:0,height:0,left:10,top:10,right:10,bottom:10}) as DOMRect;expect(hasVisiblePlayback(surface,true)).toBe(false);
   surface.getBoundingClientRect=()=>({width:320,height:180,left:10,top:10,right:330,bottom:190}) as DOMRect;
   const parent={hidden:true,parentElement:null} as unknown as HTMLElement;Object.assign(surface,{parentElement:parent});expect(hasVisiblePlayback(surface,true)).toBe(false);
 });
 it('tab restore must observe current provider playing state, not cached room playback',()=>{
   doc.hidden=true;reportVisiblePlayback(surface,true,'id');doc.hidden=false;
   reportVisiblePlayback(surface,false,'id');expect(doc.dispatchEvent).not.toHaveBeenCalled();
   reportVisiblePlayback(surface,true,'id');expect(doc.dispatchEvent).toHaveBeenCalledOnce();
 });

});
