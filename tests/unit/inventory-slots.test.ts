import { describe, it, expect } from 'vitest';
import { SurvivalInventory, type SurvivalActor } from '../../apps/game-server/src/survival-inventory';
import { CommandSchema } from '@third-space/contracts';
import { inventoryHotkey } from '../../apps/web/lib/game-keyboard';
const actor: SurvivalActor = {id:'a',x:20,y:20,vx:0,vy:0,connected:true,mode:'home'};
function fixture() { const s=new SurvivalInventory({random:()=>0,spawnPoints:[actor,{x:30,y:30}],trees:[{id:'tree',x:20,y:20}],safe:()=>false,walkable:()=>true,lineOfSight:()=>true});s.tick(0,[actor]);return s; }
const self=(s:SurvivalInventory)=>s.snapshot().players[0]!;
describe('five stable inventory slots',()=>{
 it('starts with one flashlight and four empty slots, allows putting items away',()=>{const s=fixture();expect(self(s).slots).toEqual(['flashlight',null,null,null,null]);expect(s.selectSlot('a',4).ok).toBe(true);expect(self(s)).toMatchObject({selectedSlot:4,equipped:null});for(const n of [-1,5,1.5,NaN])expect(s.selectSlot('a',n).ok).toBe(false);expect(self(s).selectedSlot).toBe(4);});
 it('fills the first empty slot in pickup order and stacks without moving other items',()=>{const s=fixture();const bag=s.snapshot().backpacks[0]!;s.pickup(actor,bag.id,0);s.harvest(actor,'tree',0);expect(self(s).slots).toEqual(['flashlight','knife','apple',null,null]);s.selectSlot('a',2);s.eat(actor,1);expect(self(s)).toMatchObject({equipped:null,selectedSlot:2,apples:0});expect(self(s).slots[1]).toBe('knife');s.harvest(actor,'tree',45000);expect(self(s)).toMatchObject({equipped:'apple',selectedSlot:2,apples:1});s.harvest(actor,'tree',90000);expect(self(s).slots.filter(i=>i==='apple')).toHaveLength(1);expect(self(s).apples).toBe(2);});
 it('does not consume fruit on full stacks or bags on full inventory, and snapshots cannot mutate slots',()=>{const s=fixture();s.grantApples('a',5,'reward');expect(s.harvest(actor,'tree',0).ok).toBe(false);expect(s.snapshot().appleTrees[0]!.readyAt).toBe(0);const copy=self(s);copy.slots.fill(null);expect(self(s).slots[0]).toBe('flashlight');
 // Exercise future item capacity without adding placeholder items to the product.
 const authority=(s as unknown as {players:Map<string,{slots:(string|null)[]}>}).players.get('a')!;authority.slots=['flashlight','apple','future-a','future-b','future-c'];
 const bag=s.snapshot().backpacks[0]!;expect(s.pickup(actor,bag.id,0)).toMatchObject({ok:false,reason:'Inventory full'});expect(s.snapshot().backpacks.some(b=>b.id===bag.id)).toBe(true);
 });
 it('resets slots and selection on respawn and validates transport bounds/context',()=>{const s=fixture();s.harvest(actor,'tree',0);s.selectSlot('a',1);s.respawn('a');expect(self(s)).toMatchObject({slots:['flashlight',null,null,null,null],selectedSlot:0,equipped:'flashlight'});const c={type:'survival.select',slot:4,commandId:'test-slot',worldRevision:0,lifeRevision:0,zoneRevision:0};expect(CommandSchema.safeParse(c).success).toBe(true);expect(CommandSchema.safeParse({...c,slot:5}).success).toBe(false);expect(CommandSchema.safeParse({...c,item:'knife'}).success).toBe(false);});
});
describe('inventory number focus ownership',()=>{
 const key=(code='Digit3',target:unknown=null)=>({key:'3',code,target:target as EventTarget,repeat:false,altKey:false,ctrlKey:false,metaKey:false,defaultPrevented:false});
 it('selects 1–5 and numpad only when gameplay owns the event',()=>{expect(inventoryHotkey(key(),false)).toBe(2);expect(inventoryHotkey(key('Numpad5'),false)).toBe(4);expect(inventoryHotkey(key('Digit6'),false)).toBeNull();expect(inventoryHotkey(key(),true)).toBeNull();for(const flag of ['repeat','altKey','ctrlKey','metaKey','defaultPrevented'])expect(inventoryHotkey({...key(),[flag]:true},false)).toBeNull();});
 it('leaves chat, inputs, dialogs and media controls alone',()=>{const target={closest:()=>({})};expect(inventoryHotkey(key('Digit3',target),false)).toBeNull();});
});
