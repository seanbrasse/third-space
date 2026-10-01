import type { LocalStore } from '@third-space/data';
import { GAME_CONFIG } from '@third-space/config';
export type LiveSession = {
    homeId: string;
    joinAlias?: string;
    name: string;
    world: string;
    players: number;
    capacity: number;
    full: boolean;
};
/** Project only public metadata; disconnected grace slots still reserve capacity. */
export function listLiveSessions(rooms: Iterable<{
    homeId: string;
    players: Map<string, {
        connected: boolean;
    }>;
}>, store: Pick<LocalStore, 'getHome'>): LiveSession[] {
    const sessions: LiveSession[] = [];
    for (const room of rooms) {
        const home = store.getHome(room.homeId);
        const players = [...room.players.values()].filter(p => p.connected).length;
        if (!home?.pinEnabled || !players)
            continue;
        const capacity = Math.min(home.capacity, GAME_CONFIG.partyCapacity);
        sessions.push({ homeId: home.id, ...(home.joinAlias ? {joinAlias:home.joinAlias}:{}), name: home.name, world: 'Midnight Pines', players, capacity, full: room.players.size >= capacity });
    }
    return sessions.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);
}
