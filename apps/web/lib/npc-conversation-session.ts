/** Correlates replies independently of rendering so dismissal cannot be undone by a delayed socket message. */
export class NPCConversationSession {
  private current:{commandId:string|null;npcId:string}|null=null;
  request(commandId:string,npcId:string){this.current={commandId,npcId:npcId.replace(/^npc:/,'')};}
  close(){this.current=null;}
  accept(reply:{commandId?:string;view:{npcId:string}},allowHelp=true){
    const npcId=reply.view.npcId.replace(/^npc:/,'');
    if(reply.commandId)return !!this.current&&this.current.commandId===reply.commandId&&this.current.npcId===npcId;
    if(!allowHelp||this.current)return false;
    this.current={commandId:null,npcId};return true;
  }
}
