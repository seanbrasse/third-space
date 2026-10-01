import {describe,it,expect,vi,afterEach} from 'vitest';
import {acceptsOrigin,configuredOrigins} from '../../apps/game-server/src/origin-policy';
afterEach(()=>vi.unstubAllEnvs());
describe('production browser origin policy',()=>{
 it('requires an explicit exact HTTPS origin without paths or wildcard',()=>{vi.stubEnv('WEB_ORIGIN','');expect(()=>configuredOrigins(true)).toThrow();for(const origin of ['http://example.com','https://example.com/path','https://example.com/','*'])expect(()=>configuredOrigins(true,[origin])).toThrow();expect(configuredOrigins(true,['https://third-space.example'])).toEqual(['https://third-space.example']);});
 it('rejects denied and missing browser origins in production; dev keeps originless local SDK clients',()=>{const origins=['https://third-space.example'];expect(acceptsOrigin(origins[0],origins,true)).toBe(true);expect(acceptsOrigin('https://evil.example',origins,true)).toBe(false);expect(acceptsOrigin(null,origins,true)).toBe(false);expect(acceptsOrigin(undefined,origins,false)).toBe(true);});
});
