import { describe, it, expect, vi, afterEach } from 'vitest';
import { gameSoundGain, clownStepInterval, gameSoundSamples } from './game-sound';
import { SoundboardAudio } from './audio';
import type { Snapshot } from './types';
afterEach(() => vi.unstubAllGlobals());
describe('quiet positional game sounds', () => {
    it('keeps peer movement below threats and fades to silence at range', () => { expect(gameSoundGain('player-step', 1, .5)).toBeLessThan(gameSoundGain('clown-step', 1, .5) / 3); for (const kind of ['player-step', 'clown-step', 'giggle', 'slash'] as const) {
        expect(gameSoundGain(kind, 2, .5)).toBeGreaterThan(gameSoundGain(kind, 6, .5));
        expect(gameSoundGain(kind, kind === 'clown-step' ? 16 : 12, 1)).toBe(0);
        expect(gameSoundGain(kind, 0, 0)).toBe(0);
    } expect(gameSoundGain('player-step', 8, 1)).toBe(0); });
    it('raises only movement source levels while preserving spatial cutoff and headroom', () => {
        const kinds=['player-step','clown-step','werewolf-step'] as const;
        const levels=[.07,.24,.22], ranges=[8,16,16];
        for(let i=0;i<kinds.length;i++) {
            const kind=kinds[i]!, range=ranges[i]!;
            expect(gameSoundGain(kind,0,1)).toBe(levels[i]);
            const values=[0,2,4,6,range,range+10].map(d=>gameSoundGain(kind,d,1));
            for(let n=1;n<values.length;n++)expect(values[n]).toBeLessThanOrEqual(values[n-1]!);
            expect(values.slice(-2)).toEqual([0,0]);expect(gameSoundGain(kind,0,0)).toBe(0);
        }
        expect(gameSoundGain('howl',0,1)).toBe(.20);expect(gameSoundGain('growl',0,1)).toBe(.18);
        expect(gameSoundGain('giggle',0,1)).toBe(.075);expect(gameSoundGain('slash',0,1)).toBe(.24);
        // Convex brown-noise filter stays within +/-1. Envelope <=1, so samples
        // are bounded by .55+.30 for player/clown and .40+.35 for wolf.
        // Eight simultaneous co-located avatars plus the single active creature
        // remain below full scale even without the own-player .45 attenuation.
        const conservativePeak=8*.07*.85+Math.max(.24*.85,.22*.75);
        expect(conservativePeak).toBeCloseTo(.68);
        expect(conservativePeak).toBeLessThan(1);
        let seed=19;vi.spyOn(Math,'random').mockImplementation(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;});
        for(const kind of kinds)expect(Math.max(...gameSoundSamples(kind,48000).map(Math.abs))).toBeLessThan(kind==='werewolf-step'?.75:.85);
    });
    it('speeds up heavy steps as the target gets closer', () => { expect(clownStepInterval(0)).toBe(220); expect(clownStepInterval(8)).toBe(520); expect(clownStepInterval(2)).toBeLessThan(clownStepInterval(6)); });
    it('creates finite short samples with headroom instead of clipping', () => { for (const kind of ['player-step', 'clown-step', 'giggle', 'slash'] as const) {
        const data = gameSoundSamples(kind, 8000);
        expect(data.length).toBeLessThanOrEqual(6400);
        expect([...data].every(Number.isFinite)).toBe(true);
        expect(Math.max(...data.map(Math.abs))).toBeLessThan(1);
        expect(data.some(x => Math.abs(x) > .05)).toBe(true);
    } });
    it('plays nearby movement once per cadence, deduplicates impacts, and mutes all new cues', async () => {
        const sources: any[] = [];
        const node = () => ({ connections: [] as any[], connect(to: any) { this.connections.push(to); }, disconnect: vi.fn() });
        class Context {
            state = 'running';
            currentTime = 0;
            sampleRate = 8000;
            destination = {};
            resume = vi.fn(async () => { });
            close = vi.fn(async () => { });
            createGain() { return { ...node(), gain: { value: 1 } }; }
            createStereoPanner() { return { ...node(), pan: { value: 0 } }; }
            createBuffer(_: number, length: number, sampleRate: number) { const a = new Float32Array(length); return { duration: length / sampleRate, getChannelData: () => a }; }
            createBufferSource() { const s = { ...node(), buffer: null as any, onended: null as any, start: vi.fn(), stop: vi.fn() }; sources.push(s); return s; }
        }
        vi.stubGlobal('AudioContext', Context);
        const audio = new SoundboardAudio();
        await audio.unlock();
        audio.setMix(1, {}, new Set());
        const snapshot = { instanceId: 'home', serverTime: 1000, worldId: 'living-room', players: [{ id: 'self', x: 0, y: 0, vx: 0, vy: 0, connected: true, mode: 'home' }, { id: 'peer', x: 1, y: 0, vx: 4, vy: 0, connected: true, mode: 'home' }] } as unknown as Snapshot;
        audio.setWorld(snapshot, 'self', .5);
        expect(sources).toHaveLength(1);
        const footGain = sources[0].connections[0].gain.value;
        audio.setWorld({ ...snapshot, serverTime: 1100 }, 'self', .5);
        expect(sources).toHaveLength(1);
        const hit = { id: 'hit', kind: 'slash' as const, x: 1, y: 0, createdAt: 1000, expiresAt: 2000 };
        audio.playWorld(hit, snapshot, 'self', .5);
        audio.playWorld(hit, snapshot, 'self', .5);
        expect(sources).toHaveLength(2);
        expect(sources[1].connections[0].gain.value).toBeGreaterThan(footGain);
        audio.playWorld({ ...hit, id: 'far', x: 20 }, snapshot, 'self', .5);
        audio.playWorld({ ...hit, id: 'expired', expiresAt: 900 }, snapshot, 'self', .5);
        expect(sources).toHaveLength(2);
        audio.setMix(1, {}, new Set(), true);
        const bus = sources[1].connections[0].connections[0].connections[0];
        expect(bus.gain.value).toBe(0);
        audio.playWorld({ ...hit, id: 'muted' }, snapshot, 'self', .5);
        expect(sources).toHaveLength(2);
        audio.setMix(1, {}, new Set(), false);
        expect(bus.gain.value).toBe(1);
        audio.playWorld({ ...hit, id: 'muted' }, snapshot, 'self', .5);
        expect(sources).toHaveLength(2);
        audio.dispose();
    });
    it('routes catch accents only to the fresh visible victim and honors mute, epoch and deduplication', async () => {
        const sources: any[]=[];
        const node=()=>({connect(to:any){(this as any).to=to;},disconnect(){}});
        class Context {
            state='running';currentTime=0;sampleRate=8000;destination={};
            async resume(){} async close(){}
            createGain(){return {...node(),gain:{value:1}};}
            createStereoPanner(){return {...node(),pan:{value:0}};}
            createBuffer(_:number,length:number,rate:number){const data=new Float32Array(length);return {duration:length/rate,getChannelData:()=>data};}
            createBufferSource(){const source={...node(),buffer:null,start(){},stop(){}};sources.push(source);return source;}
        }
        vi.stubGlobal('AudioContext',Context);vi.stubGlobal('document',{hidden:false,addEventListener(){},removeEventListener(){}});
        const audio=new SoundboardAudio();await audio.unlock();audio.setMix(1,{},new Set());
        const snapshot={instanceId:'room',epoch:'epoch',worldRevision:2,serverTime:1100,worldId:'forest',players:[{id:'self',x:0,y:0,connected:true,mode:'home'}]} as unknown as Snapshot;
        const hit={id:'fresh',kind:'slash' as const,x:1,y:0,victimId:'self',epoch:'epoch',worldRevision:2,createdAt:1000,expiresAt:2000};
        const play=(id:string,extra={},state=snapshot,reduced=false)=>audio.playWorld({...hit,id,...extra},state,'self',.5,reduced);
        play('fresh');expect(sources).toHaveLength(2); // positional impact + victim accent
        play('fresh');expect(sources).toHaveLength(2);
        play('observer',{victimId:'peer'});expect(sources).toHaveLength(3);
        play('reduced',{},snapshot,true);expect(sources).toHaveLength(4);
        vi.stubGlobal('document',{hidden:true,addEventListener(){},removeEventListener(){}});play('hidden');expect(sources).toHaveLength(5);
        vi.stubGlobal('document',{hidden:false,addEventListener(){},removeEventListener(){}});play('late',{}, {...snapshot,serverTime:1500});expect(sources).toHaveLength(6);
        play('wrong-epoch',{epoch:'old'});play('wrong-world',{worldRevision:1});play('expired',{expiresAt:900});expect(sources).toHaveLength(6);
        play('offline',{}, {...snapshot,players:[{...snapshot.players[0]!,connected:false}]});expect(sources).toHaveLength(6);
        audio.setMix(1,{},new Set(),true);play('muted');expect(sources).toHaveLength(6);
        audio.setMix(1,{},new Set(),false);play('muted');expect(sources).toHaveLength(6); // no replay after unmute
        play('unmuted',{},snapshot); // ordinary mix remains available after unmute
        expect(sources).toHaveLength(8);audio.dispose();
    });

});
