"use client";
import { useEffect, useState } from 'react';
import { api } from '../lib/types';
type Session = {
    homeId: string;
    name: string;
    world: string;
    players: number;
    capacity: number;
    full: boolean;
};
export default function LiveSessions({ onSelect }: {
    onSelect: (homeId: string) => void;
}) {
    const [sessions, setSessions] = useState<Session[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        const refresh = async () => { try {
            const result = await api<{
                sessions: Session[];
            }>('/live-sessions');
            if (active) {
                setSessions(result.sessions);
                setError('');
            }
        }
        catch {
            if (active)
                setError('Live sessions could not be loaded. You can still paste a home ID.');
        }
        finally {
            if (active)
                setLoading(false);
        } };
        void refresh();
        const timer = setInterval(() => void refresh(), 10000);
        return () => { active = false; clearInterval(timer); };
    }, []);
    return <section aria-label="Live sessions" style={{ display: 'grid', gap: 8, marginBlock: 12 }}><h3>Friends around the fire</h3><small>Active campsites · a room PIN is required. Updates every 10 seconds.</small>{loading ? <p role="status">Finding live sessions…</p> : error ? <p role="alert">{error}</p> : sessions.length === 0 ? <p>No live campsites yet. Ask a friend for their home ID and PIN.</p> : sessions.map(s => <button type="button" className="secondary" key={s.homeId} disabled={s.full} onClick={() => onSelect(s.homeId)} style={{ textAlign: 'left', whiteSpace: 'normal' }}><strong>{s.name}</strong><br />{s.world} · {s.players}/{s.capacity} friends{s.full ? ' · Full (including reconnecting friends)' : ' · Choose this campsite'}</button>)}<small>Availability can change while you join. Your PIN is checked by the server.</small></section>;
}
