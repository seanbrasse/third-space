import {it,expect,vi} from 'vitest';
import {createGameServer} from '../../apps/game-server/src/server';
it('admits only configured production browser origins on matchmaking and keeps probes originless',async()=>{
 vi.stubEnv('NODE_ENV','production');const runtime=createGameServer({dataPath:':memory:',origins:['https://third-space.example']});
 try{await runtime.server.listen(0,'127.0.0.1');const address=runtime.httpServer.address();if(!address||typeof address==='string')throw new Error('No port');const base=`http://127.0.0.1:${address.port}`;
 expect((await fetch(base+'/health')).status).toBe(200);
 for(const origin of ['https://evil.example',null]){const response=await fetch(base+'/matchmake/joinOrCreate/party',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:'{}'});expect(response.status).toBe(403);expect((await response.json()).error).toContain('origin');expect(response.headers.get('access-control-allow-origin')).toBe('null');}
 const allowed=await fetch(base+'/matchmake/joinOrCreate/party',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://third-space.example'},body:'{}'});expect(allowed.headers.get('access-control-allow-origin')).toBe('https://third-space.example');expect((await allowed.json()).error).not.toContain('origin');
 const deniedApi=await fetch(base+'/api/identity',{headers:{Origin:'https://evil.example'}});expect(deniedApi.status).toBe(403);
 }finally{await runtime.server.gracefullyShutdown(false);runtime.store.close();vi.unstubAllEnvs();}
});
