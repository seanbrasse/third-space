import {it,expect} from 'vitest';
import {NPCConversationSession} from './npc-conversation-session';
it('keeps dismissed/replaced conversations closed when replies arrive late',()=>{
 const s=new NPCConversationSession();s.request('first','npc:mara');s.close();expect(s.accept({commandId:'first',view:{npcId:'mara'}})).toBe(false);
 s.request('second','npc:mara');expect(s.accept({commandId:'first',view:{npcId:'mara'}})).toBe(false);
 expect(s.accept({commandId:'second',view:{npcId:'orin'}})).toBe(false);expect(s.accept({commandId:'second',view:{npcId:'mara'}})).toBe(true);
 s.close();expect(s.accept({commandId:'second',view:{npcId:'mara'}})).toBe(false);
});
it('does not let unsolicited help replace an explicit request or interrupt a blocked UI',()=>{
 const s=new NPCConversationSession(),help={view:{npcId:'mara'}};expect(s.accept(help,false)).toBe(false);
 s.request('talk','npc:orin');expect(s.accept(help)).toBe(false);s.close();expect(s.accept(help)).toBe(true);expect(s.accept(help)).toBe(false);
});
