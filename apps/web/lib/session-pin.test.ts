import { describe, it, expect } from 'vitest';
import { readSessionPin, rememberSessionPin, type PinStorage } from './session-pin';
function memory(): PinStorage { const values = new Map<string, string>(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }; }
describe('tab-local room PIN', () => {
    it('isolates profile/home and invalidates on rotation', () => { const s = memory(); rememberSessionPin(s, 'a', 'room', 1, '123456'); expect(readSessionPin(s, 'a', 'room', 1)).toBe('123456'); expect(readSessionPin(s, 'b', 'room', 1)).toBe(''); expect(readSessionPin(s, 'a', 'other', 1)).toBe(''); expect(readSessionPin(s, 'a', 'room', 2)).toBe(''); expect(readSessionPin(s, 'a', 'room', 1)).toBe(''); });
    it('ignores invalid/missing revision and tolerates unavailable storage', () => { const s = memory(); rememberSessionPin(s, 'a', 'room', undefined, '123456'); expect(readSessionPin(s, 'a', 'room', undefined)).toBe(''); rememberSessionPin(s, 'a', 'room', 1, 'bad'); expect(readSessionPin(s, 'a', 'room', 1)).toBe(''); expect(readSessionPin(null, 'a', 'room', 1)).toBe(''); });
    it('survives a reader refresh and rejects corrupt records', () => { const s = memory(); rememberSessionPin(s, 'a', 'room', 1, '654321'); expect(readSessionPin(s, 'a', 'room', 1)).toBe('654321'); s.setItem('third-space.room-pin.a.room', '{"revision":1,"pin":"bad"}'); expect(readSessionPin(s, 'a', 'room', 1)).toBe(''); });
});
