import {describe,it,expect,vi} from 'vitest';
import {createPlayer,stepHome} from '../../packages/simulation/src';
import {parseCommand} from '../../packages/contracts/src';
import {LivingEffectsPresentation} from '../../apps/web/lib/living-effects-presentation';
import type * as Phaser from 'phaser';
import {SurvivalInventory} from '../../apps/game-server/src/survival-inventory';
const map={id:'potion-fixture',width:30,height:30,spawn:{x:5,y:5},spawns:[{x:5,y:5}],furniture:[],seats:[],solids:[]};
const input={seq:1,axisX:1,axisY:0,jump:false};
describe('integrated potion movement, pockets and bounded presentation',()=>{
  it('applies the same speed deadline in prediction and authority without tunnelling through a wall',()=>{
    const player={...createPlayer('a','A'),x:5,y:5,potionEffects:[{kind:'speed' as const,startedAt:1000,expiresAt:21000}]};
    const plain=stepHome({...player,potionEffects:[]},input,.1,map,2000),boosted=stepHome(player,input,.1,map,2000);
    expect(boosted.x-player.x).toBeCloseTo((plain.x-player.x)*1.6);
    expect(stepHome(player,input,.1,map,21000).x).toBeCloseTo(plain.x);
    const blocked=stepHome(player,input,.25,{...map,solids:[{x:5.8,y:0,width:.3,height:30}]},2000);
    expect(blocked.x).toBeLessThan(5.8);
  });
  it('hydrates five pockets without minting bottles and preserves only existing doses on respawn',()=>{
    const inv=new SurvivalInventory({random:()=>0,spawnPoints:[],trees:[],safe:()=>false,walkable:()=>true,lineOfSight:()=>true});
    inv.ensure('a');expect(inv.restorePotions('a',{strength:2,speed:1})).toBe(true);inv.restoreApples('a',3);
    const snapshot=inv.snapshot();snapshot.players[0]!.potions!.strength=999;
    expect(inv.ensure('a').potions!.strength).toBe(2);
    expect(inv.restorePotions('a',{strength:3,speed:1})).toBe(false);
    inv.respawn('a');expect(inv.ensure('a').potions).toEqual({strength:2,speed:1});
    expect(inv.ensure('a').slots).toHaveLength(5);expect(inv.ensure('a').equipped).toBe('flashlight');
  });
  it('rejects client combat stats, duration, price, and inventory-capacity assertions',()=>{
    const base={commandId:'x',worldRevision:0,lifeRevision:0,zoneRevision:0};
    const use={...base,type:'living.use',potion:'speed',expectedInventoryRevision:1};
    expect(parseCommand(use)).toBeTruthy();
    for(const forged of [{duration:999},{speed:900},{damage:1000},{equipped:true},{potionSlotAvailable:true}])expect(parseCommand({...use,...forged})).toBeNull();
    const action={...base,type:'npc.action',npcId:'npc:wizard-orin-vale',targetLifeRevision:0,actionId:'offer',expectedInventoryRevision:1};
    expect(parseCommand(action)).toBeTruthy();expect(parseCommand({...action,appleCost:0})).toBeNull();
    expect(parseCommand({...base,type:'survival.finish',targetId:'b',targetLifeRevision:0,damage:100})).toBeNull();
  });
  it('caps speed trails to four marks per human and clears them for reduced motion and teleports',()=>{
    const g:any={};for(const method of ['setDepth','clear','fillStyle','fillEllipse','lineStyle','lineBetween','fillRect','fillCircle','destroy'])g[method]=vi.fn(()=>g);
    const scene={add:{graphics:()=>g}} as unknown as Phaser.Scene,presentation=new LivingEffectsPresentation(scene);
    const players=Array.from({length:8},(_,i)=>({...createPlayer(String(i),'Runner'),x:5+i*.1,y:5,vx:4,potionEffects:[{kind:'speed' as const,startedAt:0,expiresAt:20000}]}));
    for(let now=100;now<=2000;now+=40){g.fillEllipse.mockClear();presentation.update(players,[],players[0]!,now,32,false);expect(g.fillEllipse.mock.calls.length).toBeLessThanOrEqual(32);}
    g.fillEllipse.mockClear();presentation.update(players,[],players[0]!,2100,32,true);expect(g.fillEllipse).not.toHaveBeenCalled();
    const history=(presentation as unknown as {trails:Map<string,unknown>}).trails;expect(history.size).toBe(0);
    presentation.update(players,[],players[0]!,2200,32,false);players[0]!.x+=3;
    g.fillEllipse.mockClear();presentation.update([players[0]!],[],players[0]!,2300,32,false);expect(g.fillEllipse).toHaveBeenCalledTimes(1);
    presentation.destroy();expect(history.size).toBe(0);
  });
});
