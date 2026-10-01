import { describe, it, expect } from 'vitest';
import { listLiveSessions } from '../../apps/game-server/src/live-sessions';
import { LocalStore } from '../../packages/data/src/index';
describe('live protected session discovery', () => {
    it('excludes unprotected, empty, disconnected and disposed rooms; lists no secrets', () => { const store = new LocalStore({ path: ':memory:' }); try {
        const owner = store.createIdentity({ name: 'Host' }).profile;
        const h = store.createHome(owner.id, { name: 'Pines', pin: '123456' });
        const plain = store.createHome(owner.id, { name: 'Invite only' });
        const rooms = [{ homeId: h.id, players: new Map([['host', { connected: true }], ['away', { connected: false }]]) }, { homeId: plain.id, players: new Map([['host', { connected: true }]]) }];
        const listed = listLiveSessions(rooms, store);
        expect(listed).toEqual([{ homeId: h.id, name: 'Pines', world: 'Midnight Pines', players: 1, capacity: 8, full: false }]);
        expect(JSON.stringify(listed)).not.toMatch(/123456|ownerId|verifier|ticket|token/);
        rooms[0]!.players.get('host')!.connected = false;
        expect(listLiveSessions(rooms, store)).toEqual([]);
        expect(listLiveSessions([], store)).toEqual([]);
    }
    finally {
        store.close();
    } });
    it('counts disconnected reservations toward full capacity', () => { const store = new LocalStore({ path: ':memory:' }); try {
        const owner = store.createIdentity({ name: 'Host' }).profile;
        const home = store.createHome(owner.id, { name: 'Full', pin: '123456' });
        const players = new Map(Array.from({ length: 8 }, (_, i) => [String(i), { connected: i === 0 }]));
        expect(listLiveSessions([{ homeId: home.id, players }], store)[0]).toMatchObject({ players: 1, full: true, capacity: 8 });
    }
    finally {
        store.close();
    } });
});
describe('live room lifecycle registry', () => {
    it('registers created authority and removes disposed authority', async () => {
        const { vi } = await import('vitest');
        const { PartyRoom } = await import('../../apps/game-server/src/PartyRoom');
        const store = new LocalStore({ path: ':memory:' });
        const room = new PartyRoom();
        const owner = store.createIdentity({ name: 'Host' }).profile;
        const home = store.createHome(owner.id, { name: 'Registry', pin: '123456' });
        PartyRoom.store = store;
        vi.spyOn(room, 'setMatchmaking').mockResolvedValue();
        vi.spyOn(room, 'setTimestep').mockImplementation(() => { });
        vi.spyOn(room, 'onMessage').mockImplementation(() => { });
        vi.spyOn(room.clock, 'setInterval').mockImplementation(() => ({} as ReturnType<typeof room.clock.setInterval>));
        try {
            room.onCreate({ homeId: home.id });
            expect(PartyRoom.liveRooms.get(home.id)).toBe(room);
            expect(listLiveSessions(PartyRoom.liveRooms.values(), store)).toEqual([]);
            room.onDispose();
            expect(PartyRoom.liveRooms.has(home.id)).toBe(false);
        }
        finally {
            room.clock.clear();
            store.close();
            vi.restoreAllMocks();
        }
    });
});
