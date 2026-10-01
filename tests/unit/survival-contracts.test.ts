import {describe,it,expect} from 'vitest';
import {parseCommand} from '@third-space/contracts';
const meta={commandId:'12345678-abcd',worldRevision:1,lifeRevision:0,zoneRevision:0};
describe('survival commands',()=>{
 it('accepts only explicit server actions with life/area/world revisions',()=>{for(const action of [{type:'survival.equip',item:'knife'},{type:'survival.harvest',treeId:'tree-3-3'},{type:'survival.eat'},{type:'survival.pickup',backpackId:'knife-1'},{type:'survival.attack',targetId:'player-a'}])expect(parseCommand({...action,...meta})?.type).toBe(action.type);expect(parseCommand({type:'survival.pvp',enabled:false,commandId:meta.commandId,worldRevision:1})?.type).toBe('survival.pvp');});
 it('rejects missing/stale-format revisions, fake counts/damage, forged items and unknown fields',()=>{for(const command of [{type:'survival.attack',targetId:'player-a',...meta,damage:100},{type:'survival.equip',item:'gun',...meta},{type:'survival.eat',...meta,lifeRevision:-1},{type:'survival.harvest',treeId:'tree-1',...meta,health:100},{type:'survival.pickup',backpackId:'knife-1',commandId:meta.commandId}])expect(parseCommand(command)).toBeNull();});
});
