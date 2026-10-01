import { describe, expect, it } from "vitest";
import { ChatSubmissions, shouldOpenChatWithSlash } from "./chat-entry";
const key=()=>({key:"/",code:"Slash",target:null,repeat:false,defaultPrevented:false,isComposing:false,ctrlKey:false,metaKey:false,altKey:false});
describe("Slash chat shortcut",()=>{
 it("opens once from game without treating question mark as slash",()=>{
  expect(shouldOpenChatWithSlash(key(),false)).toBe(true);
  expect(shouldOpenChatWithSlash({...key(),key:"?"},false)).toBe(false);
 });
 it("respects editing/composite ownership, modifiers, composition, repeat and disabled",()=>{
  for(const name of ["repeat","defaultPrevented","isComposing","ctrlKey","metaKey","altKey"] as const)
   expect(shouldOpenChatWithSlash({...key(),[name]:true},false)).toBe(false);
  const editing={closest:()=>({}),isContentEditable:false} as unknown as EventTarget;
  expect(shouldOpenChatWithSlash({...key(),target:editing},false)).toBe(false);
  expect(shouldOpenChatWithSlash(key(),true)).toBe(false);
 });
});
describe("authoritative composer completion",()=>{
 const input={} as Element,other={} as Element;
 it("keeps one pending submission until own command acknowledgement then clears/focuses",()=>{
  const s=new ChatSubmissions();expect(s.begin("a"," hello ",1,[input])).toBe(true);
  expect(s.hasPending(1)).toBe(true);expect(s.begin("b"," hello ",1,[input])).toBe(false);
  expect(s.complete("a"," hello ",1,input)).toMatchObject({clear:true,focus:true});
  expect(s.hasPending(1)).toBe(false);expect(s.complete("a"," hello ",1,input).clear).toBe(false);
 });
 it("preserves text on failure and allows retry without inventing success",()=>{
  const s=new ChatSubmissions();s.begin("a","message",1,[input]);s.fail("a");
  expect(s.hasPending(1)).toBe(false);expect(s.begin("b","message",1,[input])).toBe(true);
  expect(s.complete("not-accepted","message",1,input)).toMatchObject({clear:false,focus:false});
 });
 it("does not clear a new draft or same text retyped after submission",()=>{
  for(const draft of ["new text","message"]){const s=new ChatSubmissions();s.begin("a","message",1,[input]);
   expect(s.complete("a",draft,2,input)).toMatchObject({clear:false,focus:false});}
 });
 it("does not steal focus after moving to another control while acknowledgement pending",()=>{
  const s=new ChatSubmissions();s.begin("a","message",1,[input]);
  expect(s.complete("a","message",1,other)).toMatchObject({clear:true,focus:false});
 });
 it("handles snapshot fallback and invalidates old room commands",()=>{
  const s=new ChatSubmissions();s.begin("a","message",1,[input]);s.clear();
  expect(s.complete("a","message",1,input)).toMatchObject({clear:false,focus:false});
 });
});
